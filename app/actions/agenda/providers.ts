"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { providerCreateSchema } from "@/lib/agenda/providers";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export type ProviderActionResult =
  | { ok: true }
  | { ok: false; error: string };

/** Cria um profissional externo (manager+). */
export async function criarProfissional(input: {
  name: string;
  specialties?: string[];
}): Promise<ProviderActionResult> {
  const user = await requireAuth();
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

/** Liga/desliga um profissional (manager+). */
export async function alternarProfissionalAtivo(
  providerId: string,
  active: boolean,
): Promise<ProviderActionResult> {
  const user = await requireAuth();
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