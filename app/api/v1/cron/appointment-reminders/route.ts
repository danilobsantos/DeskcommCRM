/**
 * GET /api/v1/cron/appointment-reminders — lembrete D-day de consultas.
 *
 * Roda diariamente (8h da manhã, agendado no scheduler). Para cada organização
 * com consultas pendentes no dia:
 * 1. Busca consultas com status 'scheduled' e reminder_sent=false
 * 2. Para cada uma, monta mensagem de lembrete
 * 3. Envia via canal ativo da organização (se disponível)
 * 4. Marca reminder_sent=true
 *
 * Auth: Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET (mesmo padrão dos crons).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAdapter,
  resolveSessionRef,
  CHANNEL_SESSION_REF_COLUMNS,
  type ChannelSessionRef,
  type ChannelProvider,
} from "@/lib/channels";

export const dynamic = "force-dynamic";

interface AppointmentReminder {
  id: string;
  organization_id: string;
  provider_id: string;
  contact_id: string;
  start_time: string;
  reason: string | null;
  providers: { name: string }[] | { name: string } | null;
  contacts: { name: string | null; phone_number: string | null; wa_lid: string | null }[] | { name: string | null; phone_number: string | null; wa_lid: string | null } | null;
}

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

  const supabase = createAdminClient();
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  // Buscar todas as consultas pendentes de lembrete no dia
  const { data: appointments, error: fetchErr } = await supabase
    .from("appointments")
    .select(`
      id, organization_id, provider_id, contact_id, start_time, reason,
      providers!inner(name),
      contacts!inner(name, phone_number, wa_lid)
    `)
    .eq("status", "scheduled")
    .eq("reminder_sent", false)
    .gte("start_time", todayStart.toISOString())
    .lte("start_time", todayEnd.toISOString());

  if (fetchErr) {
    return fail("internal_error", "Failed to fetch appointments.", 500, { requestId });
  }

  if (!appointments || appointments.length === 0) {
    return ok({ sent: 0, message: "No pending reminders for today." }, { requestId });
  }

  let sent = 0;
  let failed = 0;

  // Agrupar por organização para minimizar queries de channel_session
  const byOrg = new Map<string, AppointmentReminder[]>();
  for (const appt of appointments as AppointmentReminder[]) {
    const list = byOrg.get(appt.organization_id) ?? [];
    list.push(appt);
    byOrg.set(appt.organization_id, list);
  }

  for (const [orgId, orgAppointments] of byOrg) {
    // Buscar sessão de canal ativa da organização
    const { data: sessions } = await supabase
      .from("channel_sessions")
      .select(`id, status, ${CHANNEL_SESSION_REF_COLUMNS}`)
      .eq("organization_id", orgId)
      .eq("status", "connected")
      .limit(1);

    const session = sessions?.[0] as (ChannelSessionRef & { id: string; status: string }) | undefined;

    // Buscar timezone da organização
    const { data: org } = await supabase
      .from("organizations")
      .select("timezone")
      .eq("id", orgId)
      .maybeSingle();

    const tz = org?.timezone ?? "America/Sao_Paulo";

    let adapter = null;
    let sessionRef: string | null = null;
    if (session) {
      try {
        adapter = getAdapter(session.provider as ChannelProvider);
        sessionRef = resolveSessionRef(session);
      } catch {
        adapter = null;
      }
    }

    for (const appt of orgAppointments) {
      const providerName = (appt.providers as unknown as { name: string })?.name ?? "profissional";
      const contactName =
        (appt.contacts as unknown as { name: string | null })?.name ?? "paciente";
      const contactPhone =
        (appt.contacts as unknown as { phone_number: string | null })?.phone_number;
      const contactLid =
        (appt.contacts as unknown as { wa_lid: string | null })?.wa_lid;

      const startTime = new Date(appt.start_time);
      const timeStr = startTime.toLocaleString("pt-BR", {
        timeZone: tz,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const reasonText = appt.reason ? `Motivo: ${appt.reason}. ` : "";
      const message =
        `Olá ${contactName}, este é um lembrete da sua consulta com ` +
        `${providerName} marcada para ${timeStr}. ${reasonText}` +
        `Pode confirmar sua presença? Responda "sim" para confirmar.`;

      // Enviar via adapter do canal
      if (adapter && sessionRef && adapter.isConfigured()) {
        const recipient = adapter.resolveRecipient({
          isGroup: false,
          groupChatId: null,
          phoneNumber: contactPhone,
          waIdentity: null,
          waLid: contactLid,
        });

        if (recipient) {
          try {
            await adapter.send({
              organizationId: orgId,
              sessionRef,
              to: recipient,
              kind: "text",
              body: message,
            });
            sent++;
          } catch {
            failed++;
          }
        } else {
          sent++;
        }
      } else {
        // Sem canal configurado — marcar como enviado (noop seguro)
        sent++;
      }

      // Marcar reminder como enviado
      await supabase
        .from("appointments")
        .update({ reminder_sent: true })
        .eq("id", appt.id);
    }
  }

  if (sent > 0) {
    await audit({
      action: "appointment.reminders_sent",
      bypassedRls: true,
      organizationId: null,
      requestId,
      metadata: { sent, failed, total: sent + failed },
    });
  }

  return ok({ sent, failed }, { requestId });
}
