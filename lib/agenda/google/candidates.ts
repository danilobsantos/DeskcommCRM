import type { SupabaseClient } from "@supabase/supabase-js";
/** Seleção comum do cron e da prova PostgREST; associação antiga também é relida. */
export function googlePushCandidates(db: SupabaseClient, now = new Date()) {
  return db
    .from("calendar_google_reconcilable_appointments")
    // Dono-usuário (`user_id`) OU profissional externo (`provider_id`, 9014):
    // a constraint de dono único garante que um dos dois vem preenchido.
    .select("id,organization_id,user_id:owner_user_id,provider_id")
    .or(
      "needs_google_push.eq.true,and(google_event_id.not.is.null,google_conflict.is.null),google_conflict->resolution.not.is.null",
    )
    .lte("google_next_attempt_at", now.toISOString())
    .or("owner_user_id.not.is.null,provider_id.not.is.null")
    .order("google_next_attempt_at")
    .limit(50);
}
