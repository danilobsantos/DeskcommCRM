"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { z } from "zod";

import { audit } from "@/lib/audit";
import { providerCreateSchema, providerUpdateSchema } from "@/lib/agenda/providers";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { supportWriteError } from "@/lib/impersonate/support";
import { availabilityScheduleSchema } from "@/lib/schemas/routing";
import { createClient } from "@/lib/supabase/server";

const jornadaSchema = availabilityScheduleSchema;

export type ProviderActionResult =
  | { ok: true }
  | { ok: false; error: string };

/** Cria um profissional externo (manager+). */
export async function criarProfissional(input: {
  name: string;
  specialties?: string[];
}): Promise<ProviderActionResult> {
  const user = await requireAuth();
  if (supportWriteError(user.support)) {
    return { ok: false, error: "Acompanhamento somente leitura ou encerrado." };
  }
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return { ok: false, error: "Sem organização ativa." };
  if (!user.is_platform_admin && !(activeOrg.role === "manager" || activeOrg.role === "admin")) {
    return { ok: false, error: "Permissão insuficiente." };
  }

  const parsed = providerCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("providers")
    .insert({
      organization_id: activeOrg.orgId,
      name: parsed.data.name,
      specialties: parsed.data.specialties,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const cabecalhos = await headers();
  await audit({
    action: "agenda.provider_created",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "provider",
    resourceId: data.id,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    metadata: { name: parsed.data.name },
  });

  revalidatePath("/app/agenda/profissionais");
  return { ok: true };
}

const editarSchema = providerUpdateSchema.pick({ name: true, specialties: true });

/** Edita nome e especialidades de um profissional (manager+). */
export async function atualizarProfissional(
  providerId: string,
  input: { name?: string; specialties?: string[] },
): Promise<ProviderActionResult> {
  const user = await requireAuth();
  if (supportWriteError(user.support)) {
    return { ok: false, error: "Acompanhamento somente leitura ou encerrado." };
  }
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return { ok: false, error: "Sem organização ativa." };
  if (!user.is_platform_admin && !(activeOrg.role === "manager" || activeOrg.role === "admin")) {
    return { ok: false, error: "Permissão insuficiente." };
  }

  const parsed = editarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  // Só o que veio: mandar `undefined` ao update apagaria o campo no banco.
  const patch: { name?: string; specialties?: string[] } = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.specialties !== undefined) patch.specialties = parsed.data.specialties;
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nada para atualizar." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("providers")
    .update(patch)
    .eq("organization_id", activeOrg.orgId)
    .eq("id", providerId);
  if (error) return { ok: false, error: error.message };

  const cabecalhos = await headers();
  await audit({
    action: "agenda.provider_updated",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "provider",
    resourceId: providerId,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    metadata: { edicao: true, ...patch },
  });

  revalidatePath("/app/agenda/profissionais");
  return { ok: true };
}

/**
 * Exclui um profissional (manager+). Barrado quando há consulta futura: o
 * banco deixaria (`SET NULL` nos compromissos), mas a linha viraria órfã sem
 * dono — some dos filtros por profissional e o histórico fica sem
 * responsável. Quem exclui transfere ou cancela antes, e o card já mostra
 * quantas futuras existem. O passado some junto da linha; os bloqueios
 * ("Dias fora da rotina") vão em CASCADE sem trilha própria.
 */
export async function excluirProfissional(providerId: string): Promise<ProviderActionResult> {
  const user = await requireAuth();
  if (supportWriteError(user.support)) {
    return { ok: false, error: "Acompanhamento somente leitura ou encerrado." };
  }
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return { ok: false, error: "Sem organização ativa." };
  if (!user.is_platform_admin && !(activeOrg.role === "manager" || activeOrg.role === "admin")) {
    return { ok: false, error: "Permissão insuficiente." };
  }

  if (typeof providerId !== "string" || providerId.length === 0) {
    return { ok: false, error: "Dados inválidos." };
  }

  const supabase = await createClient();
  // Só o que ainda vai acontecer barra: cancelado/não-compareceu são estado
  // terminal — contar eles travaria a exclusão para sempre depois de um
  // cancelamento (medido na e2e: cancelar e excluir em sequência).
  const { count, error: erroContagem } = await supabase
    .from("calendar_appointments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", activeOrg.orgId)
    .eq("provider_id", providerId)
    .in("status", ["pending", "confirmed"])
    .gte("starts_at", new Date().toISOString());
  if (erroContagem) return { ok: false, error: erroContagem.message };
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `Este profissional tem ${count} consulta(s) futura(s). Transfira ou cancele antes de excluir.`,
    };
  }

  const { data: removido, error } = await supabase
    .from("providers")
    .delete()
    .eq("organization_id", activeOrg.orgId)
    .eq("id", providerId)
    .select("id, name")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!removido) return { ok: false, error: "Profissional não encontrado." };

  const cabecalhos = await headers();
  await audit({
    action: "agenda.provider_deleted",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "provider",
    resourceId: providerId,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    metadata: { name: (removido as { name: string }).name },
  });

  revalidatePath("/app/agenda/profissionais");
  return { ok: true };
}

/** Liga/desliga um profissional (manager+). */
export async function alternarProfissionalAtivo(
  providerId: string,
  active: boolean,
): Promise<ProviderActionResult> {
  const user = await requireAuth();
  if (supportWriteError(user.support)) {
    return { ok: false, error: "Acompanhamento somente leitura ou encerrado." };
  }
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return { ok: false, error: "Sem organização ativa." };
  if (!user.is_platform_admin && !(activeOrg.role === "manager" || activeOrg.role === "admin")) {
    return { ok: false, error: "Permissão insuficiente." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("providers")
    .update({ active })
    .eq("organization_id", activeOrg.orgId)
    .eq("id", providerId);
  if (error) return { ok: false, error: error.message };

  const cabecalhos = await headers();
  await audit({
    action: "agenda.provider_updated",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "provider",
    resourceId: providerId,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    metadata: { active },
  });

  revalidatePath("/app/agenda/profissionais");
  return { ok: true };
}

/** Grava a jornada semanal de um profissional (manager+). */
export async function salvarJornadaProfissional(
  providerId: string,
  schedule: z.infer<typeof jornadaSchema>,
): Promise<ProviderActionResult> {
  const user = await requireAuth();
  if (supportWriteError(user.support)) {
    return { ok: false, error: "Acompanhamento somente leitura ou encerrado." };
  }
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return { ok: false, error: "Sem organização ativa." };
  if (!user.is_platform_admin && !(activeOrg.role === "manager" || activeOrg.role === "admin")) {
    return { ok: false, error: "Permissão insuficiente." };
  }

  const parsed = jornadaSchema.safeParse(schedule);
  if (!parsed.success) return { ok: false, error: "Jornada inválida." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("providers")
    .update({ schedule: parsed.data })
    .eq("organization_id", activeOrg.orgId)
    .eq("id", providerId);
  if (error) return { ok: false, error: error.message };

  const cabecalhos = await headers();
  await audit({
    action: "agenda.provider_updated",
    actorUserId: user.id,
    organizationId: activeOrg.orgId,
    resourceType: "provider",
    resourceId: providerId,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    metadata: { jornada: true },
  });

  revalidatePath("/app/agenda/profissionais");
  return { ok: true };
}