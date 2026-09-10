/**
 * GET /api/v1/cron/attendant-heartbeat — AT-08 auto-offline.
 *
 * Marca `is_available=false` todo atendente online que não emite heartbeat há
 * mais que HEARTBEAT_TIMEOUT_MINUTES (defesa contra aba fechada sem beforeunload,
 * spec 04 §8.2). Trigger NUNCA faz HTTP — este é um cron TS que faz UPDATE via
 * admin client (varredura system-wide, não tenant-scoped). Mesmo contrato de auth
 * dos demais crons (Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET, fail-closed).
 *
 * O cutoff (now − timeout) e o predicado de "velho" são lógica pura em
 * lib/routing/eligibility.ts (isHeartbeatStale), testada com clock mockado — a
 * regra dos 15min é constante NOMEADA única, não número mágico espalhado.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { HEARTBEAT_TIMEOUT_MINUTES } from "@/lib/routing/eligibility";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const cutoff = new Date(Date.now() - HEARTBEAT_TIMEOUT_MINUTES * 60_000).toISOString();

  const supabaseAdmin = createAdminClient();

  // 1. Identifica atendentes online cujo heartbeat expirou (ou nunca foi enviado).
  // Separamos em SELECT + UPDATE porque o PostgREST qualifica colunas em filtros
  // .or() durante mutations (PATCH), gerando SQL que o PostgreSQL rejeita com erro 42703
  // ("column attendant_availability.last_heartbeat_at does not exist").
  const { data: staleAttendants, error: selectError } = await supabaseAdmin
    .from("attendant_availability")
    .select("id, user_id")
    .eq("is_available", true)
    .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${cutoff}`);

  if (selectError) {
    if (selectError.message.includes("last_heartbeat_at")) {
      logger.warn(
        "[attendant-heartbeat] coluna last_heartbeat_at ausente em attendant_availability — cron suspenso até execução da migration 9004",
        { error: selectError.message, requestId },
      );
      return ok(
        { swept: 0, skipped: true, reason: "column_last_heartbeat_at_missing" },
        { requestId },
      );
    }
    logger.error("[attendant-heartbeat] sweep failed (select)", {
      error: selectError.message,
      requestId,
    });
    return fail("internal_error", "Failed to sweep stale heartbeats.", 500, { requestId });
  }

  const staleIds = (staleAttendants ?? [])
    .map((row) => (row as { id?: string; user_id?: string }).id ?? row.user_id)
    .filter(Boolean);
  if (staleIds.length === 0) {
    return ok({ swept: 0, cutoff }, { requestId });
  }

  // 2. Atualiza apenas os registros identificados.
  const { data, error: updateError } = await supabaseAdmin
    .from("attendant_availability")
    .update({ is_available: false, updated_at: new Date().toISOString() })
    .in("id", staleIds)
    .select("user_id");

  if (updateError) {
    logger.error("[attendant-heartbeat] sweep failed (update)", {
      error: updateError.message,
      requestId,
    });
    return fail("internal_error", "Failed to sweep stale heartbeats.", 500, { requestId });
  }

  const swept = data?.length ?? staleIds.length;
  // Varredura que não derrubou ninguém não é mutação e não ocupa linha de
  // auditoria (mesmo critério do snooze-watcher e do recover-stuck-messages).
  // Esta rota roda 1×/5min: auditar incondicionalmente gravava 8.640 linhas/mês
  // numa instalação sem atendente algum, numa tabela append-only com retenção de
  // anos. O caso de erro do UPDATE já sai por `fail(...)` acima, com log — não é
  // este `if` que o esconde.
  if (swept > 0) {
    void audit({
      action: "attendant.heartbeat_swept",
      requestId,
      bypassedRls: true,
      metadata: { swept, timeout_minutes: HEARTBEAT_TIMEOUT_MINUTES, cutoff },
    });
  }

  return ok({ swept, cutoff }, { requestId });
}
