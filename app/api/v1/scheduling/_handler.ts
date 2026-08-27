/**
 * Scheduling handlers — providers, schedules, appointments.
 *
 * Pattern: receives (supabase, ctx, input), returns data or throws ApiError.
 * Every query filters by ctx.organization_id (tenancy via service-role).
 */
import { type SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import {
  computeAvailableSlots,
  timeToMinutes,
  type ScheduleWindow,
  type ExistingAppointment,
} from "@/lib/scheduling/availability";
import type {
  ProviderCreate,
  ProviderUpdate,
  ScheduleCreate,
  ScheduleBulk,
  AppointmentCreate,
  AppointmentUpdate,
  AppointmentListQuery,
  AvailabilityQuery,
} from "@/lib/schemas/scheduling";

interface HandlerCtx {
  organization_id: string;
  actor: { type: "user"; id: string } | { type: "ai_agent"; id: string };
  requestId: string;
}

// ── Providers ──────────────────────────────────────────────────────

export async function listProvidersHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  filters?: { specialty?: string; active?: boolean },
) {
  let q = supabase
    .from("providers")
    .select("*")
    .eq("organization_id", ctx.organization_id)
    .order("name");

  if (filters?.specialty) {
    q = q.contains("specialties", [filters.specialty]);
  }
  if (filters?.active !== undefined) {
    q = q.eq("active", filters.active);
  }

  const { data, error } = await q;
  if (error) throw new ApiError(500, "database_error", undefined, ctx.requestId, error.message);
  return data ?? [];
}

export async function getProviderHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  providerId: string,
) {
  const { data, error } = await supabase
    .from("providers")
    .select("*")
    .eq("organization_id", ctx.organization_id)
    .eq("id", providerId)
    .single();

  if (error || !data) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Provider não encontrado.");
  }
  return data;
}

export async function createProviderHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  input: ProviderCreate,
) {
  const { data, error } = await supabase
    .from("providers")
    .insert({
      organization_id: ctx.organization_id,
      name: input.name,
      specialties: input.specialties ?? [],
    })
    .select()
    .single();

  if (error) throw new ApiError(500, "database_error", undefined, ctx.requestId, error.message);

  await audit({
    action: "provider.created",
    actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
    organizationId: ctx.organization_id,
    resourceType: "provider",
    resourceId: data.id,
    requestId: ctx.requestId,
    metadata: { name: data.name },
  });

  return data;
}

export async function updateProviderHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  providerId: string,
  input: ProviderUpdate,
) {
  const { data: existing } = await supabase
    .from("providers")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("id", providerId)
    .single();

  if (!existing) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Provider não encontrado.");
  }

  const { data, error } = await supabase
    .from("providers")
    .update(input)
    .eq("organization_id", ctx.organization_id)
    .eq("id", providerId)
    .select()
    .single();

  if (error) throw new ApiError(500, "database_error", undefined, ctx.requestId, error.message);
  return data;
}

// ── Schedules ──────────────────────────────────────────────────────

export async function listSchedulesHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  providerId: string,
) {
  const { data, error } = await supabase
    .from("provider_schedules")
    .select("*")
    .eq("organization_id", ctx.organization_id)
    .eq("provider_id", providerId)
    .order("day_of_week")
    .order("start_time");

  if (error) throw new ApiError(500, "database_error", undefined, ctx.requestId, error.message);
  return data ?? [];
}

export async function upsertSchedulesBulkHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  input: ScheduleBulk,
) {
  // Verify provider exists
  const { data: provider } = await supabase
    .from("providers")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("id", input.provider_id)
    .single();

  if (!provider) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Provider não encontrado.");
  }

  // Delete existing schedules and insert new ones (atomic-ish)
  const { error: delErr } = await supabase
    .from("provider_schedules")
    .delete()
    .eq("organization_id", ctx.organization_id)
    .eq("provider_id", input.provider_id);

  if (delErr) throw new ApiError(500, "database_error", undefined, ctx.requestId, delErr.message);

  if (input.schedules.length === 0) return [];

  const rows = input.schedules.map((s) => ({
    organization_id: ctx.organization_id,
    provider_id: input.provider_id,
    day_of_week: s.dow,
    start_time: s.start_time,
    end_time: s.end_time,
    slot_duration_minutes: s.slot_minutes,
  }));

  const { data, error } = await supabase
    .from("provider_schedules")
    .insert(rows)
    .select();

  if (error) throw new ApiError(500, "database_error", undefined, ctx.requestId, error.message);

  await audit({
    action: "provider.updated",
    actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
    organizationId: ctx.organization_id,
    resourceType: "provider",
    resourceId: input.provider_id,
    requestId: ctx.requestId,
    metadata: { schedules_count: rows.length },
  });

  return data ?? [];
}

// ── Appointments ───────────────────────────────────────────────────

const APPT_COLS =
  "id, organization_id, provider_id, contact_id, start_time, end_time, status, reason, notes, reminder_sent, created_at";

export async function listAppointmentsHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  query: AppointmentListQuery,
) {
  let q = supabase
    .from("appointments")
    .select(`${APPT_COLS}, providers(name), contacts(name, phone_number)`)
    .eq("organization_id", ctx.organization_id)
    .order("start_time", { ascending: true })
    .limit(query.limit);

  if (query.provider_id) q = q.eq("provider_id", query.provider_id);
  if (query.contact_id) q = q.eq("contact_id", query.contact_id);
  if (query.status) q = q.eq("status", query.status);
  if (query.date_from) q = q.gte("start_time", `${query.date_from}T00:00:00Z`);
  if (query.date_to) q = q.lte("start_time", `${query.date_to}T23:59:59Z`);
  if (query.cursor) q = q.gt("start_time", query.cursor);

  const { data, error } = await q;
  if (error) throw new ApiError(500, "database_error", undefined, ctx.requestId, error.message);

  const rows = data ?? [];
  const has_more = rows.length === query.limit;
  const cursor = has_more ? rows[rows.length - 1]?.start_time : null;

  return { appointments: rows, cursor, has_more };
}

export async function createAppointmentHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  input: AppointmentCreate,
) {
  const startTime = new Date(input.start_time);
  const endTime = input.end_time
    ? new Date(input.end_time)
    : new Date(startTime.getTime() + 30 * 60_000);

  if (endTime <= startTime) {
    throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "Horário de término deve ser posterior ao início.");
  }

  // Check for conflicts
  const { data: existing } = await supabase
    .from("appointments")
    .select("id, start_time, end_time")
    .eq("organization_id", ctx.organization_id)
    .eq("provider_id", input.provider_id)
    .in("status", ["scheduled", "confirmed"])
    .lte("start_time", endTime.toISOString())
    .gte("end_time", startTime.toISOString());

  if (existing && existing.length > 0) {
    throw new ApiError(
      409,
      "conflict",
      undefined,
      ctx.requestId,
      "Conflito de horário com outra consulta.",
    );
  }

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      organization_id: ctx.organization_id,
      provider_id: input.provider_id,
      contact_id: input.contact_id,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      reason: input.reason,
      notes: input.notes,
    })
    .select()
    .single();

  if (error) throw new ApiError(500, "database_error", undefined, ctx.requestId, error.message);

  await audit({
    action: "appointment.created",
    actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
    organizationId: ctx.organization_id,
    resourceType: "appointment",
    resourceId: data.id,
    requestId: ctx.requestId,
    metadata: {
      provider_id: input.provider_id,
      contact_id: input.contact_id,
      start_time: startTime.toISOString(),
    },
  });

  return data;
}

export async function updateAppointmentHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  appointmentId: string,
  input: AppointmentUpdate,
) {
  const { data: existing } = await supabase
    .from("appointments")
    .select("id, status")
    .eq("organization_id", ctx.organization_id)
    .eq("id", appointmentId)
    .single();

  if (!existing) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Consulta não encontrada.");
  }

  if (existing.status === "cancelled") {
    throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "Não é possível alterar consulta cancelada.");
  }

  // Check conflicts if rescheduling
  if (input.start_time || input.end_time) {
    const { data: current } = await supabase
      .from("appointments")
      .select("start_time, end_time, provider_id")
      .eq("id", appointmentId)
      .single();

    if (current) {
      const currentData = current as { start_time: string; end_time: string | null; provider_id: string };
      const newStart = input.start_time ? new Date(input.start_time) : new Date(currentData.start_time);
      const newEnd = input.end_time
        ? new Date(input.end_time)
        : currentData.end_time
          ? new Date(currentData.end_time)
          : new Date(newStart.getTime() + 30 * 60_000);

      const { data: conflicts } = await supabase
        .from("appointments")
        .select("id")
        .eq("organization_id", ctx.organization_id)
        .eq("provider_id", currentData.provider_id)
        .in("status", ["scheduled", "confirmed"])
        .neq("id", appointmentId)
        .lte("start_time", newEnd.toISOString())
        .gte("end_time", newStart.toISOString());

      if (conflicts && conflicts.length > 0) {
        throw new ApiError(409, "conflict", undefined, ctx.requestId, "Conflito de horário com outra consulta.");
      }
    }
  }

  const { data, error } = await supabase
    .from("appointments")
    .update(input)
    .eq("organization_id", ctx.organization_id)
    .eq("id", appointmentId)
    .select()
    .single();

  if (error) throw new ApiError(500, "database_error", undefined, ctx.requestId, error.message);

  const action = input.status === "confirmed"
    ? "appointment.confirmed"
    : input.status === "cancelled"
      ? "appointment.cancelled"
      : "appointment.updated";

  await audit({
    action,
    actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
    organizationId: ctx.organization_id,
    resourceType: "appointment",
    resourceId: appointmentId,
    requestId: ctx.requestId,
    metadata: { ...input },
  });

  return data;
}

export async function cancelAppointmentHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  appointmentId: string,
) {
  return updateAppointmentHandler(supabase, ctx, appointmentId, { status: "cancelled" });
}

export async function confirmAppointmentHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  appointmentId: string,
) {
  return updateAppointmentHandler(supabase, ctx, appointmentId, { status: "confirmed" });
}

// ── Availability ───────────────────────────────────────────────────

export async function getAvailabilityHandler(
  supabase: SupabaseClient,
  ctx: HandlerCtx,
  query: AvailabilityQuery,
) {
  const { data: provider } = await supabase
    .from("providers")
    .select("id, active")
    .eq("organization_id", ctx.organization_id)
    .eq("id", query.provider_id)
    .single();

  if (!provider) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Provider não encontrado.");
  }

  if (!provider.active) {
    throw new ApiError(422, "validation_failed", undefined, ctx.requestId, "Provider está inativo.");
  }

  // Get schedules for this day of week
  const date = new Date(`${query.date}T12:00:00Z`);
  const dow = date.getUTCDay();

  const { data: schedules } = await supabase
    .from("provider_schedules")
    .select("start_time, end_time, slot_duration_minutes")
    .eq("organization_id", ctx.organization_id)
    .eq("provider_id", query.provider_id)
    .eq("day_of_week", dow);

  if (!schedules || schedules.length === 0) {
    return { slots: [], message: "Sem agenda neste dia." };
  }

  // Get existing appointments for this day
  const dayStart = `${query.date}T00:00:00Z`;
  const dayEnd = `${query.date}T23:59:59Z`;

  const { data: appointments } = await supabase
    .from("appointments")
    .select("start_time, end_time")
    .eq("organization_id", ctx.organization_id)
    .eq("provider_id", query.provider_id)
    .in("status", ["scheduled", "confirmed"])
    .gte("start_time", dayStart)
    .lte("end_time", dayEnd);

  const booked: ExistingAppointment[] = (appointments ?? []).map((a) => ({
    startMinutes: timeToMinutes(new Date(a.start_time).toISOString().slice(11, 16)),
    endMinutes: timeToMinutes(new Date(a.end_time).toISOString().slice(11, 16)),
    status: "scheduled",
  }));

  // Compute slots for each schedule window
  const allSlots = schedules.flatMap((s) => {
    const window: ScheduleWindow = {
      dayOfWeek: dow,
      startTime: s.start_time,
      endTime: s.end_time,
      slotDurationMinutes: s.slot_duration_minutes,
      active: true,
    };
    return computeAvailableSlots(window, booked, dow);
  });

  // Sort and deduplicate
  const sorted = allSlots
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .filter((slot, i, arr) => i === 0 || slot.startMinutes !== arr[i - 1]!.startMinutes);

  return { slots: sorted };
}
