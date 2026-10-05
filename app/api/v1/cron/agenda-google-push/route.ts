import { NextResponse, type NextRequest } from "next/server";
import { googlePushCandidates } from "@/lib/agenda/google/candidates";
import { apenasDeMembrosAtivos, apenasDeVinculosAtivos } from "@/lib/agenda/google/membros";
import { reconcileAppointment } from "@/lib/agenda/google/sync-executor";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizaCron } from "@/lib/auth/cron-auth";
export const dynamic = "force-dynamic";
async function executar(req: NextRequest) {
  if (!autorizaCron(req))
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "cron secret inválido" } },
      { status: 401 },
    );
  const db = createAdminClient();
  const { data, error } = await googlePushCandidates(db);
  if (error)
    return NextResponse.json(
      { error: { code: "internal_error", message: "Não foi possível ler a pendência Google." } },
      { status: 500 },
    );
  const effects = new Map<string, { processados: number; falhas: number }>();
  // Candidatos de dono-usuário passam pelo filtro de membro ativo; candidatos
  // de profissional (9014, `user_id` nulo) passam pelo filtro de vínculo — são
  // perguntas diferentes sobre autoridades diferentes, então são duas listas.
  const linhas = (data ?? []) as { id: string; organization_id: string; user_id: string | null; provider_id: string | null }[];
  const [deUsuarios, deProfissionais] = await Promise.all([
    apenasDeMembrosAtivos(
      db,
      linhas.filter(
        (l): l is (typeof linhas)[number] & { user_id: string } => l.user_id !== null,
      ),
    ),
    apenasDeVinculosAtivos(
      db,
      linhas
        .filter((l) => l.user_id === null && l.provider_id !== null)
        .map((l) => ({
          id: l.id,
          organization_id: l.organization_id,
          provider_id: l.provider_id as string,
        })),
    ),
  ]);
  const porId = new Map<string, (typeof linhas)[number]>(
    deUsuarios.map((l) => [l.id, l]),
  );
  for (const l of deProfissionais) porId.set(l.id, l as (typeof linhas)[number]);
  const active = linhas.filter((l) => porId.has(l.id));
  for (const item of active) {
    let result: string;
    try {
      result = await reconcileAppointment(db, item.organization_id, item.id);
    } catch {
      result = "failed";
    }
    if (result === "busy" || result === "unchanged" || result === "terminal") continue;
    const summary = effects.get(item.organization_id) ?? { processados: 0, falhas: 0 };
    if (result === "processed") summary.processados++;
    else summary.falhas++;
    effects.set(item.organization_id, summary);
  }
  for (const [organizationId, summary] of effects) {
    if (summary.processados > 0 || summary.falhas > 0)
      await audit({
        action: "agenda.google.sync_executado",
        organizationId,
        metadata: { direcao: "ida", ...summary },
      });
  }
  return NextResponse.json({ data: { candidatos: data?.length ?? 0, organizacoes: effects.size } });
}
export const GET = executar;
export const POST = executar;
