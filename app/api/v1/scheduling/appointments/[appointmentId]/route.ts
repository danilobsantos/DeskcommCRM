import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/types";
import { ok, fail, noContent } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { validateRequest, appointmentUpdateSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { updateAppointmentHandler, cancelAppointmentHandler, confirmAppointmentHandler } from "../../_handler";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { appointmentId } = await params;

  const authz = await requireRole("agent", { requestId, resource: "scheduling" });
  if (!authz.ok) return authz.response;

  let input;
  try {
    input = await validateRequest(appointmentUpdateSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  try {
    const result = await updateAppointmentHandler(
      await createClient(),
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
      },
      appointmentId,
      input,
    );
    return ok(result, { requestId });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId });
    throw err;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ appointmentId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { appointmentId } = await params;

  const authz = await requireRole("agent", { requestId, resource: "scheduling" });
  if (!authz.ok) return authz.response;

  try {
    await cancelAppointmentHandler(
      await createClient(),
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
      },
      appointmentId,
    );
    return noContent(requestId);
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId });
    throw err;
  }
}
