/**
 * Tools MCP de agendamento — as mãos do agente sobre a agenda.
 *
 * Sete capacidades: listar profissionais, listar consultas, checar
 * disponibilidade, criar, reagendar, cancelar e confirmar compromissos.
 *
 * ⚠️ FACCHADA FINA: nenhuma regra de negócio nasce aqui.
 *   - Disponibilidade: lib/scheduling/availability.ts
 *   - Conflitos: detectados pelo computeAvailableSlots / validateAppointmentSlot
 *   - Escrita: direta no banco via ctx.supabase (service role)
 *
 * ⚠️ TENANT: ctx.organizationId em toda query. Service role bypassa RLS.
 *
 * ⚠️ ROLES: read usa agent; write usa ai_operator (mesmo padrão de retenção).
 * Agendar não é criar conversa — é comprometer horário de um profissional.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import type { McpContext, McpToolDefinition } from "../types";
import {
  timeToMinutes,
  minutesToTime,
  computeAvailableSlots,
  validateAppointmentSlot,
  type ScheduleWindow,
  type ExistingAppointment,
} from "@/lib/scheduling";

function actorAudit(ctx: McpContext): {
  actorUserId: string | null;
  metadataActor: Record<string, unknown>;
} {
  if (ctx.actor.type === "user") {
    return { actorUserId: ctx.actor.id, metadataActor: { actor_type: "user" } };
  }
  return {
    actorUserId: null,
    metadataActor: { actor_type: ctx.actor.type, actor_id: ctx.actor.id },
  };
}

// ---------------------------------------------------------------------------
// scheduling_list_providers
// ---------------------------------------------------------------------------

const listProvidersShape = {
  specialty: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(100).default(20),
};

export const schedulingListProviders: McpToolDefinition<typeof listProvidersShape> = {
  name: "scheduling_list_providers",
  description:
    "Lista profissionais da organização. Filtre por especialidade para encontrar " +
    "quem atende um tipo específico de problema (ex.: 'ortodontia', 'implantodontia').",
  inputSchema: listProvidersShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("providers")
      .select("id, name, specialties, active")
      .eq("organization_id", ctx.organizationId)
      .eq("active", true)
      .order("name")
      .limit(input.limit);

    if (input.specialty) {
      query = query.contains("specialties", [input.specialty]);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return {
      providers: data ?? [],
      total: data?.length ?? 0,
    };
  },
};

// ---------------------------------------------------------------------------
// scheduling_list_appointments
// ---------------------------------------------------------------------------

const listAppointmentsShape = {
  provider_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  status: z
    .enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"])
    .optional(),
  limit: z.number().int().min(1).max(100).default(20),
};

export const schedulingListAppointments: McpToolDefinition<typeof listAppointmentsShape> = {
  name: "scheduling_list_appointments",
  description:
    "Lista consultas da organização. Filtre por profissional, paciente, período ou " +
    "status para ver a agenda completa.",
  inputSchema: listAppointmentsShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("appointments")
      .select("*, providers!inner(name, specialties)")
      .eq("organization_id", ctx.organizationId)
      .order("start_time")
      .limit(input.limit);

    if (input.provider_id) query = query.eq("provider_id", input.provider_id);
    if (input.contact_id) query = query.eq("contact_id", input.contact_id);
    if (input.status) query = query.eq("status", input.status);
    if (input.date_from) query = query.gte("start_time", input.date_from);
    if (input.date_to) query = query.lte("start_time", input.date_to);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return {
      appointments: data ?? [],
      total: data?.length ?? 0,
    };
  },
};

// ---------------------------------------------------------------------------
// scheduling_check_availability
// ---------------------------------------------------------------------------

const checkAvailabilityShape = {
  provider_id: z.string().uuid(),
  /** Data no formato ISO 8601 (só a parte da data é usada). */
  date: z.string().min(10).max(10),
};

export const schedulingCheckAvailability: McpToolDefinition<typeof checkAvailabilityShape> = {
  name: "scheduling_check_availability",
  description:
    "Retorna os horários disponíveis de um profissional numa data específica. " +
    "Use para oferecer opções concretas ao paciente — nunca invente disponibilidade.",
  inputSchema: checkAvailabilityShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    // Buscar provider
    const { data: provider, error: provErr } = await ctx.supabase
      .from("providers")
      .select("id, name")
      .eq("id", input.provider_id)
      .eq("organization_id", ctx.organizationId)
      .eq("active", true)
      .maybeSingle();

    if (provErr) throw new Error(provErr.message);
    if (!provider) {
      return {
        available: false,
        motivo: "provider_not_found",
        mensagem: "Profissional não encontrado ou inativo nesta organização.",
      };
    }

    // Converter data para dia da semana (0-6) usando timezone da org
    const { data: org } = await ctx.supabase
      .from("organizations")
      .select("timezone")
      .eq("id", ctx.organizationId)
      .maybeSingle();

    const tz = org?.timezone ?? "America/Sao_Paulo";
    const dateObj = new Date(`${input.date}T12:00:00Z`);
    const dayOfWeek = new Date(
      dateObj.toLocaleString("en-US", { timeZone: tz }),
    ).getDay();

    // Buscar janelas de disponibilidade
    const { data: schedules, error: schedErr } = await ctx.supabase
      .from("provider_schedules")
      .select("day_of_week, start_time, end_time, slot_duration_minutes, active")
      .eq("organization_id", ctx.organizationId)
      .eq("provider_id", input.provider_id)
      .eq("active", true);

    if (schedErr) throw new Error(schedErr.message);

    const windows: ScheduleWindow[] = (schedules ?? []).map((s) => ({
      dayOfWeek: s.day_of_week,
      startTime: s.start_time.slice(0, 5), // "HH:MM:SS" → "HH:MM"
      endTime: s.end_time.slice(0, 5),
      slotDurationMinutes: s.slot_duration_minutes,
      active: s.active,
    }));

    // Buscar consultas existentes na data
    const dayStart = `${input.date}T00:00:00Z`;
    const dayEnd = `${input.date}T23:59:59Z`;

    const { data: appointments, error: apptErr } = await ctx.supabase
      .from("appointments")
      .select("start_time, end_time, status")
      .eq("organization_id", ctx.organizationId)
      .eq("provider_id", input.provider_id)
      .gte("start_time", dayStart)
      .lte("start_time", dayEnd)
      .in("status", ["scheduled", "confirmed"]);

    if (apptErr) throw new Error(apptErr.message);

    // Converter appointments para minutos (no timezone do provider)
    const existing: ExistingAppointment[] = (appointments ?? []).map((a) => {
      const start = new Date(a.start_time);
      const end = new Date(a.end_time);
      const startLocal = new Date(start.toLocaleString("en-US", { timeZone: tz }));
      const endLocal = new Date(end.toLocaleString("en-US", { timeZone: tz }));
      return {
        startMinutes: startLocal.getHours() * 60 + startLocal.getMinutes(),
        endMinutes: endLocal.getHours() * 60 + endLocal.getMinutes(),
        status: a.status,
      };
    });

    // Calcular slots disponíveis (usar primeira janela do dia)
    const windowForDay = windows.find((w) => w.dayOfWeek === dayOfWeek);
    if (!windowForDay) {
      return {
        provider: provider.name,
        date: input.date,
        available: false,
        motivo: "no_schedule",
        mensagem: "Profissional não possui agenda configurada para este dia.",
        slots: [],
      };
    }

    const slots = computeAvailableSlots(windowForDay, existing, dayOfWeek);

    return {
      provider: provider.name,
      date: input.date,
      available: slots.length > 0,
      slots: slots.map((s) => ({
        start: minutesToTime(s.startMinutes),
        end: minutesToTime(s.endMinutes),
      })),
      mensagem:
        slots.length === 0
          ? "Nenhum horário disponível nesta data. Tente outro dia."
          : undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// scheduling_create_appointment
// ---------------------------------------------------------------------------

const createAppointmentShape = {
  provider_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  /** ISO 8601 completo com timezone. */
  start_time: z.string().datetime(),
  reason: z.string().min(1).max(500).optional(),
  notes: z.string().max(2000).optional(),
};

export const schedulingCreateAppointment: McpToolDefinition<typeof createAppointmentShape> = {
  name: "scheduling_create_appointment",
  description:
    "Cria uma consulta com um profissional. Antes de agendar, sempre verifique " +
    "disponibilidade com scheduling_check_availability. Informe motivo/reason para " +
    "o profissional saber o que esperar.",
  inputSchema: createAppointmentShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    // Buscar provider para obter slot_duration_minutes
    const { data: provider, error: provErr } = await ctx.supabase
      .from("providers")
      .select("id, name")
      .eq("id", input.provider_id)
      .eq("organization_id", ctx.organizationId)
      .eq("active", true)
      .maybeSingle();

    if (provErr) throw new Error(provErr.message);
    if (!provider) {
      return {
        created: false,
        motivo: "provider_not_found",
        mensagem: "Profissional não encontrado ou inativo.",
      };
    }

    // Buscar schedule do dia para calcular duração
    const startDate = new Date(input.start_time);
    const { data: org } = await ctx.supabase
      .from("organizations")
      .select("timezone")
      .eq("id", ctx.organizationId)
      .maybeSingle();

    const tz = org?.timezone ?? "America/Sao_Paulo";
    const dayOfWeek = new Date(
      startDate.toLocaleString("en-US", { timeZone: tz }),
    ).getDay();

    const { data: schedule } = await ctx.supabase
      .from("provider_schedules")
      .select("slot_duration_minutes")
      .eq("organization_id", ctx.organizationId)
      .eq("provider_id", input.provider_id)
      .eq("day_of_week", dayOfWeek)
      .eq("active", true)
      .maybeSingle();

    const slotDuration = schedule?.slot_duration_minutes ?? 30;
    const endDate = new Date(startDate.getTime() + slotDuration * 60_000);

    // Validar conflito
    const { data: conflicts } = await ctx.supabase
      .from("appointments")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("provider_id", input.provider_id)
      .in("status", ["scheduled", "confirmed"])
      .lt("start_time", endDate.toISOString())
      .gt("end_time", startDate.toISOString());

    if (conflicts && conflicts.length > 0) {
      return {
        created: false,
        motivo: "conflict",
        mensagem:
          "Este horário conflita com uma consulta já agendada. " +
          "Use scheduling_check_availability para ver horários livres.",
      };
    }

    // Criar consulta
    const { data: appointment, error: apptErr } = await ctx.supabase
      .from("appointments")
      .insert({
        organization_id: ctx.organizationId,
        provider_id: input.provider_id,
        contact_id: input.contact_id,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        status: "scheduled",
        reason: input.reason ?? null,
        notes: input.notes ?? null,
      })
      .select("id, start_time, end_time, status")
      .single();

    if (apptErr) throw new Error(apptErr.message);

    const a = actorAudit(ctx);
    await audit({
      action: "appointment.created",
      actorUserId: a.actorUserId,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "appointment",
      resourceId: appointment.id,
      requestId: ctx.requestId,
      metadata: {
        ...a.metadataActor,
        via: "mcp",
        provider_id: input.provider_id,
        provider_name: provider.name,
        contact_id: input.contact_id,
        start_time: appointment.start_time,
        reason: input.reason ?? null,
      },
    });

    return {
      created: true,
      appointment_id: appointment.id,
      provider: provider.name,
      start_time: appointment.start_time,
      end_time: appointment.end_time,
      status: appointment.status,
      mensagem: `Consulta agendada com ${provider.name} para ${new Date(appointment.start_time).toLocaleString("pt-BR", { timeZone: tz })}. Confirme por escrito com o paciente.`,
    };
  },
};

// ---------------------------------------------------------------------------
// scheduling_update_appointment
// ---------------------------------------------------------------------------

const updateAppointmentShape = {
  appointment_id: z.string().uuid(),
  /** Novo horário de início (ISO 8601). Se fornecido, end_time é recalculado. */
  start_time: z.string().datetime().optional(),
  reason: z.string().min(1).max(500).optional(),
  notes: z.string().max(2000).optional(),
};

export const schedulingUpdateAppointment: McpToolDefinition<typeof updateAppointmentShape> = {
  name: "scheduling_update_appointment",
  description:
    "Reagenda ou edita uma consulta existente. Para reagendar, informe o novo " +
    "start_time — o end_time será recalculado automaticamente. " +
    "Verifique disponibilidade antes de reagendar.",
  inputSchema: updateAppointmentShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    // Buscar consulta existente
    const { data: existing, error: findErr } = await ctx.supabase
      .from("appointments")
      .select("id, provider_id, start_time, end_time, status")
      .eq("id", input.appointment_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (findErr) throw new Error(findErr.message);
    if (!existing) {
      return {
        updated: false,
        motivo: "not_found",
        mensagem: "Consulta não encontrada nesta organização.",
      };
    }

    if (existing.status === "cancelled" || existing.status === "completed") {
      return {
        updated: false,
        motivo: "invalid_status",
        mensagem: `Consulta já está com status "${existing.status}" e não pode ser alterada.`,
      };
    }

    const updates: Record<string, unknown> = {};
    if (input.reason !== undefined) updates.reason = input.reason;
    if (input.notes !== undefined) updates.notes = input.notes;

    if (input.start_time) {
      const newStart = new Date(input.start_time);

      // Buscar slot duration
      const { data: org } = await ctx.supabase
        .from("organizations")
        .select("timezone")
        .eq("id", ctx.organizationId)
        .maybeSingle();

      const tz = org?.timezone ?? "America/Sao_Paulo";
      const dayOfWeek = new Date(
        newStart.toLocaleString("en-US", { timeZone: tz }),
      ).getDay();

      const { data: schedule } = await ctx.supabase
        .from("provider_schedules")
        .select("slot_duration_minutes")
        .eq("organization_id", ctx.organizationId)
        .eq("provider_id", existing.provider_id)
        .eq("day_of_week", dayOfWeek)
        .eq("active", true)
        .maybeSingle();

      const slotDuration = schedule?.slot_duration_minutes ?? 30;
      const newEnd = new Date(newStart.getTime() + slotDuration * 60_000);

      // Verificar conflito (excluindo a própria consulta)
      const { data: conflicts } = await ctx.supabase
        .from("appointments")
        .select("id")
        .eq("organization_id", ctx.organizationId)
        .eq("provider_id", existing.provider_id)
        .in("status", ["scheduled", "confirmed"])
        .neq("id", input.appointment_id)
        .lt("start_time", newEnd.toISOString())
        .gt("end_time", newStart.toISOString());

      if (conflicts && conflicts.length > 0) {
        return {
          updated: false,
          motivo: "conflict",
          mensagem:
            "O novo horário conflita com outra consulta. " +
            "Use scheduling_check_availability para ver horários livres.",
        };
      }

      updates.start_time = newStart.toISOString();
      updates.end_time = newEnd.toISOString();
    }

    const { data: updated, error: updErr } = await ctx.supabase
      .from("appointments")
      .update(updates)
      .eq("id", input.appointment_id)
      .eq("organization_id", ctx.organizationId)
      .select("id, start_time, end_time, status")
      .maybeSingle();

    if (updErr) throw new Error(updErr.message);

    const a = actorAudit(ctx);
    await audit({
      action: "appointment.updated",
      actorUserId: a.actorUserId,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "appointment",
      resourceId: input.appointment_id,
      requestId: ctx.requestId,
      metadata: {
        ...a.metadataActor,
        via: "mcp",
        old_start: existing.start_time,
        new_start: updated?.start_time,
      },
    });

    const { data: org } = await ctx.supabase
      .from("organizations")
      .select("timezone")
      .eq("id", ctx.organizationId)
      .maybeSingle();

    const tz = org?.timezone ?? "America/Sao_Paulo";

    return {
      updated: true,
      appointment_id: updated?.id,
      start_time: updated?.start_time,
      end_time: updated?.end_time,
      mensagem: `Consulta reagendada para ${new Date(updated?.start_time ?? "").toLocaleString("pt-BR", { timeZone: tz })}.`,
    };
  },
};

// ---------------------------------------------------------------------------
// scheduling_cancel_appointment
// ---------------------------------------------------------------------------

const cancelAppointmentShape = {
  appointment_id: z.string().uuid(),
  reason: z.string().max(500).optional(),
};

export const schedulingCancelAppointment: McpToolDefinition<typeof cancelAppointmentShape> = {
  name: "scheduling_cancel_appointment",
  description:
    "Cancela uma consulta agendada. Informe o motivo do cancelamento. " +
    "A consulta fica com status 'cancelled' e o horário volta a ficar disponível.",
  inputSchema: cancelAppointmentShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data: existing, error: findErr } = await ctx.supabase
      .from("appointments")
      .select("id, status, provider_id, start_time")
      .eq("id", input.appointment_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (findErr) throw new Error(findErr.message);
    if (!existing) {
      return {
        cancelled: false,
        motivo: "not_found",
        mensagem: "Consulta não encontrada nesta organização.",
      };
    }

    if (existing.status === "cancelled") {
      return {
        cancelled: false,
        motivo: "already_cancelled",
        mensagem: "Esta consulta já foi cancelada.",
      };
    }

    if (existing.status === "completed") {
      return {
        cancelled: false,
        motivo: "already_completed",
        mensagem: "Consulta já realizada não pode ser cancelada.",
      };
    }

    const { error: updErr } = await ctx.supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", input.appointment_id)
      .eq("organization_id", ctx.organizationId);

    if (updErr) throw new Error(updErr.message);

    const a = actorAudit(ctx);
    await audit({
      action: "appointment.cancelled",
      actorUserId: a.actorUserId,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "appointment",
      resourceId: input.appointment_id,
      requestId: ctx.requestId,
      metadata: {
        ...a.metadataActor,
        via: "mcp",
        provider_id: existing.provider_id,
        start_time: existing.start_time,
        cancel_reason: input.reason ?? null,
      },
    });

    return {
      cancelled: true,
      appointment_id: existing.id,
      mensagem: "Consulta cancelada. O horário ficou disponível para novo agendamento.",
    };
  },
};

// ---------------------------------------------------------------------------
// scheduling_confirm_appointment
// ---------------------------------------------------------------------------

const confirmAppointmentShape = {
  appointment_id: z.string().uuid(),
};

export const schedulingConfirmAppointment: McpToolDefinition<typeof confirmAppointmentShape> = {
  name: "scheduling_confirm_appointment",
  description:
    "Marca uma consulta como confirmada pelo paciente. Use quando o paciente " +
    "responder positivamente ao lembrete ou confirmar por outro canal.",
  inputSchema: confirmAppointmentShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data: existing, error: findErr } = await ctx.supabase
      .from("appointments")
      .select("id, status")
      .eq("id", input.appointment_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();

    if (findErr) throw new Error(findErr.message);
    if (!existing) {
      return {
        confirmed: false,
        motivo: "not_found",
        mensagem: "Consulta não encontrada nesta organização.",
      };
    }

    if (existing.status !== "scheduled") {
      return {
        confirmed: false,
        motivo: "invalid_status",
        mensagem: `Consulta com status "${existing.status}" não pode ser confirmada.`,
      };
    }

    const { error: updErr } = await ctx.supabase
      .from("appointments")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", input.appointment_id)
      .eq("organization_id", ctx.organizationId);

    if (updErr) throw new Error(updErr.message);

    const a = actorAudit(ctx);
    await audit({
      action: "appointment.confirmed",
      actorUserId: a.actorUserId,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "appointment",
      resourceId: input.appointment_id,
      requestId: ctx.requestId,
      metadata: {
        ...a.metadataActor,
        via: "mcp",
      },
    });

    return {
      confirmed: true,
      appointment_id: existing.id,
      mensagem: "Consulta confirmada pelo paciente.",
    };
  },
};
