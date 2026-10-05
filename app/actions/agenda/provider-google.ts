"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { googleDeProfissionaisHabilitado } from "@/lib/agenda/providers";
import { desvinculoGoogleSchema, vinculoGoogleSchema } from "@/lib/agenda/provider-google";
import { podeAdministrarEmpresa } from "@/lib/auth/pode-administrar-empresa";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { supportWriteError } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export type VinculoGoogleResult =
  | { ok: true; calendar_id: string }
  | { ok: false; error: string };

export type DesvinculoGoogleResult =
  | { ok: true; desvinculado: boolean }
  | { ok: false; error: string };

/**
 * Vincula um profissional externo a uma agenda do Google da conta central
 * (manager+, migration 9013).
 *
 * A tabela `calendar_connection_calendars` só tem policy de SELECT — quem
 * escreve aqui é service role, com `organization_id` resolvido da sessão (nunca
 * do body). Exige as duas flags (`providers_enabled` + `providers_google_enabled`)
 * e um calendário elegível: da org, com conexão `healthy`, disponível, com
 * escrita (`writer`/`owner`) e contando para conflito. Um profissional = uma
 * agenda: vincular move (limpa o vínculo anterior dele); calendário já ligado a
 * OUTRO profissional é 409 — desfaz lá antes.
 */
export async function vincularGoogleDoProfissional(
  providerId: string,
  calendarId: string,
): Promise<VinculoGoogleResult> {
  const parsed = vinculoGoogleSchema.safeParse({ provider_id: providerId, calendar_id: calendarId });
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await requireAuth();
  if (supportWriteError(user.support)) {
    return { ok: false, error: "Acompanhamento somente leitura ou encerrado." };
  }
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return { ok: false, error: "Sem organização ativa." };
  if (!podeAdministrarEmpresa(user, activeOrg) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    return { ok: false, error: "Permissão insuficiente." };
  }

  const admin = createAdminClient();
  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  if (orgErr) return { ok: false, error: orgErr.message };
  if (!googleDeProfissionaisHabilitado((orgRow as { settings?: unknown } | null)?.settings)) {
    return { ok: false, error: "O Google por profissional está desligado para esta organização." };
  }

  const { data: profissional, error: provErr } = await admin
    .from("providers")
    .select("id")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", parsed.data.provider_id)
    .maybeSingle();
  if (provErr) return { ok: false, error: provErr.message };
  if (!profissional) return { ok: false, error: "Profissional não encontrado." };

  const { data: calendario, error: calErr } = await admin
    .from("calendar_connection_calendars")
    .select(
      "id, provider_id, available, access_role, counts_for_conflicts, calendar_connections!inner(status)",
    )
    .eq("organization_id", activeOrg.orgId)
    .eq("id", parsed.data.calendar_id)
    .maybeSingle();
  if (calErr) return { ok: false, error: calErr.message };
  if (!calendario) return { ok: false, error: "Agenda não encontrada." };
  // O embed `!inner` não está no tipo gerado da linha: lê via forma local.
  const cal = calendario as unknown as {
    provider_id: string | null;
    available: boolean;
    access_role: string | null;
    counts_for_conflicts: boolean;
    calendar_connections: { status: string } | { status: string }[] | null;
  };
  const conexao = Array.isArray(cal.calendar_connections)
    ? cal.calendar_connections[0]
    : cal.calendar_connections;
  const elegivel =
    cal.available === true &&
    ["writer", "owner"].includes(String(cal.access_role)) &&
    cal.counts_for_conflicts === true &&
    conexao?.status === "healthy";
  if (!elegivel) {
    return { ok: false, error: "Esta agenda não pode receber o vínculo (conexão, permissão ou leitura)." };
  }
  const outroDono = cal.provider_id;
  if (outroDono && outroDono !== parsed.data.provider_id) {
    return { ok: false, error: "Esta agenda já está ligada a outro profissional — desvincule lá antes." };
  }

  // Move: o vínculo anterior deste profissional sai antes do novo entrar. Sem
  // transação cruzada aqui porque são duas escritas de service role na mesma
  // tabela e a UNIQUE parcial barra o estado final inválido (409 vira erro
  // legível abaixo, nunca duas agendas para o mesmo profissional).
  const { error: limpaErr } = await admin
    .from("calendar_connection_calendars")
    .update({ provider_id: null })
    .eq("organization_id", activeOrg.orgId)
    .eq("provider_id", parsed.data.provider_id)
    .neq("id", parsed.data.calendar_id);
  if (limpaErr) return { ok: false, error: limpaErr.message };

  const { error: ligaErr } = await admin
    .from("calendar_connection_calendars")
    .update({ provider_id: parsed.data.provider_id })
    .eq("organization_id", activeOrg.orgId)
    .eq("id", parsed.data.calendar_id);
  if (ligaErr) {
    const repetido = (ligaErr as { code?: string }).code === "23505";
    return {
      ok: false,
      error: repetido
        ? "Este profissional já está ligado a outra agenda."
        : ligaErr.message,
    };
  }

  const cabecalhos = await headers();
  await audit({
    action: "agenda.provider_google_linked",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "provider",
    resourceId: parsed.data.provider_id,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    metadata: { calendar_id: parsed.data.calendar_id },
  });

  revalidatePath("/app/agenda/profissionais");
  return { ok: true, calendar_id: parsed.data.calendar_id };
}

/**
 * Desvincula o profissional da agenda do Google (manager+). Idempotente: sem
 * vínculo, volta `desvinculado: false` sem auditar (não houve mutação).
 */
export async function desvincularGoogleDoProfissional(
  providerId: string,
): Promise<DesvinculoGoogleResult> {
  const parsed = desvinculoGoogleSchema.safeParse({ provider_id: providerId });
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await requireAuth();
  if (supportWriteError(user.support)) {
    return { ok: false, error: "Acompanhamento somente leitura ou encerrado." };
  }
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return { ok: false, error: "Sem organização ativa." };
  if (!podeAdministrarEmpresa(user, activeOrg) && ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    return { ok: false, error: "Permissão insuficiente." };
  }

  const admin = createAdminClient();
  const { data: linhas, error: leErr } = await admin
    .from("calendar_connection_calendars")
    .select("id")
    .eq("organization_id", activeOrg.orgId)
    .eq("provider_id", parsed.data.provider_id);
  if (leErr) return { ok: false, error: leErr.message };
  if (!linhas || linhas.length === 0) return { ok: true, desvinculado: false };

  const { error: updErr } = await admin
    .from("calendar_connection_calendars")
    .update({ provider_id: null })
    .eq("organization_id", activeOrg.orgId)
    .eq("provider_id", parsed.data.provider_id);
  if (updErr) return { ok: false, error: updErr.message };

  const cabecalhos = await headers();
  await audit({
    action: "agenda.provider_google_unlinked",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "provider",
    resourceId: parsed.data.provider_id,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    metadata: { calendars: (linhas as { id: string }[]).map((l) => l.id) },
  });

  revalidatePath("/app/agenda/profissionais");
  return { ok: true, desvinculado: true };
}
