"use server";

import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

export type UpdateProvidersFeatureResult =
  | { ok: true; providers_enabled: boolean }
  | { ok: false; error: string };

/**
 * Liga/desliga a feature de PROFISSIONAIS EXTERNOS de um tenant (migration
 * 9003), do painel da plataforma em `/admin/tenants/:id/funcionalidades`.
 *
 * A flag mora em `organizations.settings.scheduling.providers_enabled` (default
 * OFF) — o MESMO jsonb que já guarda routing, visibility_mode e branding. O
 * toggle é PLATFORM ADMIN de propósito: é decisão de quem responde pela
 * instalação, não do operador do tenant (mesmo argumento de updateGoogleOAuth).
 */
export async function updateProvidersFeature(
  organizationId: string,
  enabled: boolean,
): Promise<UpdateProvidersFeatureResult> {
  const { user: authUser } = await requirePlatformAdmin();

  const admin = createAdminClient();
  const { data: orgRow, error: readErr } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!orgRow) return { ok: false, error: "organização não encontrada." };

  const current = (orgRow.settings as Record<string, unknown> | null) ?? {};
  // Merge não-destrutivo em DOIS níveis: preserva as demais chaves de settings e
  // as demais chaves de settings.scheduling.
  const scheduling = (current.scheduling as Record<string, unknown> | null) ?? {};
  const nextSettings = {
    ...current,
    scheduling: { ...scheduling, providers_enabled: enabled },
  };

  const { error: updErr } = await admin
    .from("organizations")
    .update({ settings: nextSettings })
    .eq("id", organizationId);
  if (updErr) return { ok: false, error: updErr.message };

  const cabecalhos = await headers();
  await audit({
    action: "platform.tenant_feature_changed",
    actorUserId: authUser.id,
    organizationId,
    resourceType: "organization",
    resourceId: organizationId,
    requestId: cabecalhos.get("x-request-id") ?? undefined,
    ip: cabecalhos.get("x-forwarded-for") ?? undefined,
    userAgent: cabecalhos.get("user-agent") ?? undefined,
    actingAsPlatformAdmin: true,
    metadata: { feature: "providers_enabled", enabled },
  });

  return { ok: true, providers_enabled: enabled };
}