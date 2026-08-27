"use server";

import { headers } from "next/headers";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { audit } from "@/lib/audit";
import {
  providerCreateSchema,
  providerUpdateSchema,
  scheduleBulkSchema,
  appointmentCreateSchema,
  appointmentUpdateSchema,
} from "@/lib/schemas";
import { validateBody } from "@/lib/schemas/_validate";

// ── Result types ───────────────────────────────────────────────────

export type ActionResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; details?: unknown };

// ── Helpers ────────────────────────────────────────────────────────

async function getAuthContext() {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return null;

  const authUser = await loadAuthUser();
  const org = authUser ? await resolveActiveOrg(authUser) : null;

  return { supabase, user, orgId: org?.orgId ?? null };
}

function getRequestMetadata(awaitHeaders: Awaited<ReturnType<typeof headers>>) {
  return {
    requestId: randomUUID(),
    ip: awaitHeaders.get("x-forwarded-for") ?? awaitHeaders.get("x-real-ip") ?? "unknown",
    userAgent: awaitHeaders.get("user-agent") ?? "unknown",
  };
}

// ── Providers ──────────────────────────────────────────────────────

export async function createProvider(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx || !ctx.orgId) return { ok: false, error: "unauthenticated" };

  const input = validateBody(providerCreateSchema, {
    name: formData.get("name") as string,
    specialties: formData.get("specialties") ? JSON.parse(formData.get("specialties") as string) : undefined,
  });

  const { data, error } = await ctx.supabase
    .from("providers")
    .insert({
      organization_id: ctx.orgId,
      name: input.name,
      specialties: input.specialties ?? [],
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  const h = await headers();
  const meta = getRequestMetadata(h);

  await audit({
    action: "provider.created",
    actorUserId: ctx.user.id,
    organizationId: ctx.orgId,
    resourceType: "provider",
    resourceId: data.id,
    requestId: meta.requestId,
    metadata: { name: data.name },
  });

  revalidatePath("/app/scheduling");
  return { ok: true, data };
}

export async function updateProvider(
  providerId: string,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx || !ctx.orgId) return { ok: false, error: "unauthenticated" };

  const input = validateBody(providerUpdateSchema, {
    name: formData.get("name") as string | undefined,
    specialties: formData.get("specialties")
      ? JSON.parse(formData.get("specialties") as string)
      : undefined,
    active: formData.get("active") !== null ? formData.get("active") === "true" : undefined,
  });

  const { data, error } = await ctx.supabase
    .from("providers")
    .update(input)
    .eq("organization_id", ctx.orgId)
    .eq("id", providerId)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  const h = await headers();
  const meta = getRequestMetadata(h);

  await audit({
    action: "provider.updated",
    actorUserId: ctx.user.id,
    organizationId: ctx.orgId,
    resourceType: "provider",
    resourceId: providerId,
    requestId: meta.requestId,
    metadata: { fields_changed: Object.keys(input) },
  });

  revalidatePath("/app/scheduling");
  revalidatePath(`/app/scheduling/${providerId}`);
  return { ok: true, data };
}

// ── Schedules ──────────────────────────────────────────────────────

export async function upsertSchedules(
  providerId: string,
  schedules: Array<{
    dow: number;
    start_time: string;
    end_time: string;
    slot_minutes?: number;
  }>,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx || !ctx.orgId) return { ok: false, error: "unauthenticated" };

  const input = validateBody(scheduleBulkSchema, {
    provider_id: providerId,
    schedules,
  });

  // Delete existing
  const { error: delErr } = await ctx.supabase
    .from("provider_schedules")
    .delete()
    .eq("organization_id", ctx.orgId)
    .eq("provider_id", providerId);

  if (delErr) return { ok: false, error: delErr.message };

  if (input.schedules.length === 0) {
    revalidatePath(`/app/scheduling/${providerId}`);
    return { ok: true };
  }

  // Insert new
  const rows = input.schedules.map((s) => ({
    organization_id: ctx.orgId!,
    provider_id: providerId,
    dow: s.dow,
    start_time: s.start_time,
    end_time: s.end_time,
    slot_minutes: s.slot_minutes,
  }));

  const { data, error } = await ctx.supabase
    .from("provider_schedules")
    .insert(rows)
    .select();

  if (error) return { ok: false, error: error.message };

  const h = await headers();
  const meta = getRequestMetadata(h);

  await audit({
    action: "provider.updated",
    actorUserId: ctx.user.id,
    organizationId: ctx.orgId,
    resourceType: "provider",
    resourceId: providerId,
    requestId: meta.requestId,
    metadata: { schedules_count: rows.length },
  });

  revalidatePath(`/app/scheduling/${providerId}`);
  return { ok: true, data };
}

// ── Appointments ───────────────────────────────────────────────────

export async function createAppointment(formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx || !ctx.orgId) return { ok: false, error: "unauthenticated" };

  const input = validateBody(appointmentCreateSchema, {
    provider_id: formData.get("provider_id") as string,
    contact_id: formData.get("contact_id") as string,
    start_time: formData.get("start_time") as string,
    end_time: formData.get("end_time") as string | undefined,
    reason: formData.get("reason") as string | undefined,
    notes: formData.get("notes") as string | undefined,
  });

  const { data, error } = await ctx.supabase
    .from("appointments")
    .insert({
      organization_id: ctx.orgId,
      provider_id: input.provider_id,
      contact_id: input.contact_id,
      start_time: input.start_time,
      end_time: input.end_time,
      reason: input.reason,
      notes: input.notes,
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  const h = await headers();
  const meta = getRequestMetadata(h);

  await audit({
    action: "appointment.created",
    actorUserId: ctx.user.id,
    organizationId: ctx.orgId,
    resourceType: "appointment",
    resourceId: data.id,
    requestId: meta.requestId,
    metadata: {
      provider_id: input.provider_id,
      contact_id: input.contact_id,
      start_time: input.start_time,
    },
  });

  revalidatePath("/app/scheduling");
  revalidatePath(`/app/scheduling/${input.provider_id}`);
  return { ok: true, data };
}

export async function updateAppointment(
  appointmentId: string,
  input: {
    start_time?: string;
    end_time?: string;
    reason?: string;
    notes?: string;
    status?: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  },
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx || !ctx.orgId) return { ok: false, error: "unauthenticated" };

  const parsed = validateBody(appointmentUpdateSchema, input);

  const { data, error } = await ctx.supabase
    .from("appointments")
    .update(parsed)
    .eq("organization_id", ctx.orgId)
    .eq("id", appointmentId)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };

  const h = await headers();
  const meta = getRequestMetadata(h);

  const action = parsed.status === "confirmed"
    ? "appointment.confirmed"
    : parsed.status === "cancelled"
      ? "appointment.cancelled"
      : "appointment.updated";

  await audit({
    action,
    actorUserId: ctx.user.id,
    organizationId: ctx.orgId,
    resourceType: "appointment",
    resourceId: appointmentId,
    requestId: meta.requestId,
    metadata: { fields_changed: Object.keys(parsed) },
  });

  revalidatePath("/app/scheduling");
  if (data?.provider_id) revalidatePath(`/app/scheduling/${data.provider_id}`);
  return { ok: true, data };
}

export async function cancelAppointment(appointmentId: string): Promise<ActionResult> {
  return updateAppointment(appointmentId, { status: "cancelled" });
}

export async function confirmAppointment(appointmentId: string): Promise<ActionResult> {
  return updateAppointment(appointmentId, { status: "confirmed" });
}
