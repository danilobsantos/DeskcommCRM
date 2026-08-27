/**
 * Zod schemas for `/api/v1/scheduling/*` endpoints.
 */
import { z } from "zod";

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── Providers ──────────────────────────────────────────────────────

export const providerCreateSchema = z.object({
  name: z.string().min(1).max(200),
  specialties: z.array(z.string().min(1).max(100)).optional(),
});

export const providerUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  specialties: z.array(z.string().min(1).max(100)).optional(),
  active: z.boolean().optional(),
});

// ── Schedules (janelas de disponibilidade) ─────────────────────────

export const scheduleCreateSchema = z.object({
  provider_id: z.string().uuid(),
  dow: z.number().int().min(0).max(6), // 0=dom, 6=sab
  start_time: z.string().regex(TIME_REGEX, "Horário no formato HH:MM"),
  end_time: z.string().regex(TIME_REGEX, "Horário no formato HH:MM"),
  slot_minutes: z.number().int().min(15).max(480).default(30),
});

export const scheduleUpdateSchema = z.object({
  dow: z.number().int().min(0).max(6).optional(),
  start_time: z.string().regex(TIME_REGEX, "Horário no formato HH:MM").optional(),
  end_time: z.string().regex(TIME_REGEX, "Horário no formato HH:MM").optional(),
  slot_minutes: z.number().int().min(15).max(480).optional(),
});

export const scheduleBulkSchema = z.object({
  provider_id: z.string().uuid(),
  schedules: z.array(
    z.object({
      dow: z.number().int().min(0).max(6),
      start_time: z.string().regex(TIME_REGEX),
      end_time: z.string().regex(TIME_REGEX),
      slot_minutes: z.number().int().min(15).max(480).default(30),
    }),
  ),
});

// ── Appointments ───────────────────────────────────────────────────

export const appointmentCreateSchema = z.object({
  provider_id: z.string().uuid(),
  contact_id: z.string().uuid(),
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }).optional(),
  reason: z.string().min(1).max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export const appointmentUpdateSchema = z.object({
  start_time: z.string().datetime({ offset: true }).optional(),
  end_time: z.string().datetime({ offset: true }).optional(),
  reason: z.string().min(1).max(500).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]).optional(),
});

export const appointmentListQuerySchema = z.object({
  provider_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Availability query ─────────────────────────────────────────────

export const availabilityQuerySchema = z.object({
  provider_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no formato YYYY-MM-DD"),
});

// ── Types ──────────────────────────────────────────────────────────

export type ProviderCreate = z.infer<typeof providerCreateSchema>;
export type ProviderUpdate = z.infer<typeof providerUpdateSchema>;
export type ScheduleCreate = z.infer<typeof scheduleCreateSchema>;
export type ScheduleBulk = z.infer<typeof scheduleBulkSchema>;
export type AppointmentCreate = z.infer<typeof appointmentCreateSchema>;
export type AppointmentUpdate = z.infer<typeof appointmentUpdateSchema>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
