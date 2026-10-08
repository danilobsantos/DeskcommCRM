/**
 * Épico Operação Visível (F1) — central de avisos do agente.
 * GET → agent_inbox_items da org (default: abertos). Abertos: os mais graves
 * primeiro e, entre iguais, os mais recentes; resolvidos/todos: mais recente
 * primeiro (é histórico, não fila).
 * Itens de plataforma (organization_id null) são do operador do sistema, não
 * do tenant — nunca entram aqui.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolverDestinosDosAvisos } from "@/lib/ai/inbox-destino";
import { anexarLinkDePagamento } from "@/lib/cobranca/central";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

/** Ordem da fila aberta: a camada de cima sai inteira antes da seguinte. */
const GRAVIDADES = ["critical", "warn", "info"] as const;

const querySchema = z.object({
  status: z.enum(["open", "ack", "resolved", "all"]).default("open"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Filtro de gravidade: ausente = todas (a ordem por camadas continua). */
  severity: z.enum(["info", "warn", "critical"]).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "agent_inbox_items" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { org } = authz;

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams.entries()),
  );
  if (!parsed.success) {
    return fail("validation_failed", t("Query inválida."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const { status, limit, severity } = parsed.data;

  const admin = createAdminClient();
  // `+1`: o excedente prova `has_more` sem segunda consulta. A tela usa limite
  // cumulativo ("Carregar mais" aumenta o `limit`), então a ordem por camadas
  // nunca é quebrada por deslocamento.
  const take = limit + 1;
  const buscar = (gravidade?: (typeof GRAVIDADES)[number]) => {
    let query = admin
      .from("agent_inbox_items")
      .select("id, kind, severity, title, body, ref_kind, ref_id, status, created_at")
      .eq("organization_id", org.orgId)
      .order("created_at", { ascending: false })
      .limit(take);
    if (status !== "all") query = query.eq("status", status);
    if (gravidade) query = query.eq("severity", gravidade);
    return query;
  };
  // Ordenar em memória os N mais recentes esconderia um crítico mais antigo
  // que não coube nos N: a fila aberta é buscada POR CAMADA de gravidade.
  // ponytail: até 3×limit linhas lidas para devolver `limit`; consulta
  // sequencial que para quando enche, se um dia pesar.
  // Com filtro de gravidade, uma consulta só — o fan-out é só para ordenar as
  // camadas entre si quando todas estão na tela.
  const camadas = status === "open" && !severity ? GRAVIDADES.map((g) => buscar(g)) : [buscar(severity)];
  const resultados = await Promise.all(camadas);
  if (resultados.some((r) => r.error)) {
    return fail("internal_error", t("Falha ao carregar os avisos."), 500, { requestId });
  }
  const todas = resultados.flatMap((r) => r.data ?? []);
  const data = todas.slice(0, limit);
  const hasMore = todas.length > limit;

  const { count: openCount } = await admin
    .from("agent_inbox_items")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.orgId)
    .eq("status", "open");

  const comDestino = await resolverDestinosDosAvisos(await createClient(), org.orgId, org.role, data);
  const items = await anexarLinkDePagamento(admin, org.orgId, org.role, comDestino);
  return ok({ items, open_count: openCount ?? 0, has_more: hasMore }, { requestId });
}
