import { redirect } from "next/navigation";

import { providersHabilitados } from "@/lib/agenda/providers";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import type { ScheduleWindow } from "@/lib/schemas/routing";
import { createClient } from "@/lib/supabase/server";

import { ProfissionaisClient } from "./_client";

export const dynamic = "force-dynamic";

/**
 * Profissionais externos — a secretária gerencia as agendas dos dentistas que
 * não têm conta no sistema (migration 9003).
 *
 * Gate: a feature é por tenant (`settings.scheduling.providers_enabled`, OFF
 * por default). Desligada, a página redireciona para a Agenda — o base
 * (atendentes + IA) não é tocado.
 */
export default async function ProfissionaisPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const supabase = await createClient();
  const { data: orgRow } = await supabase
    .from("organizations")
    .select("settings")
    .eq("id", activeOrg.orgId)
    .maybeSingle();

  if (!providersHabilitados(orgRow?.settings)) redirect("/app/agenda");

  const { data: profissionais } = await supabase
    .from("providers")
    .select("id, name, specialties, active, schedule")
    .eq("organization_id", activeOrg.orgId)
    .order("name");

  const { data: contagens } = await supabase
    .from("calendar_appointments")
    .select("provider_id")
    .eq("organization_id", activeOrg.orgId)
    .neq("provider_id", null)
    .gte("starts_at", new Date().toISOString());

  const porProfissional = new Map<string, number>();
  for (const linha of contagens ?? []) {
    const pid = linha.provider_id as string | null;
    if (pid) porProfissional.set(pid, (porProfissional.get(pid) ?? 0) + 1);
  }

  return (
    <ProfissionaisClient
      canWrite={user.is_platform_admin || activeOrg.role === "manager" || activeOrg.role === "admin"}
      iniciais={(profissionais ?? []).map((p) => {
        const s = (p.schedule as { timezone?: string; windows?: unknown[] } | null) ?? {};
        return {
          id: p.id,
          nome: p.name,
          especialidades: Array.isArray(p.specialties) ? p.specialties.map(String) : [],
          ativo: Boolean(p.active),
          proximas: porProfissional.get(p.id) ?? 0,
          schedule: {
            timezone: s.timezone || "America/Sao_Paulo",
            windows: Array.isArray(s.windows) ? (s.windows as ScheduleWindow[]) : [],
          },
        };
      })}
    />
  );
}