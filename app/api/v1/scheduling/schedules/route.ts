import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { validateRequest, scheduleBulkSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { listSchedulesHandler, upsertSchedulesBulkHandler } from "../_handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "scheduling" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const providerId = url.searchParams.get("provider_id");

  if (!providerId) {
    return fail("validation_failed", "Parâmetro provider_id é obrigatório.", 422, {
      requestId,
    });
  }

  const supabase = await createClient();

  try {
    const schedules = await listSchedulesHandler(
      supabase,
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
      },
      providerId,
    );
    return ok(schedules, { requestId });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId });
    throw err;
  }
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "scheduling" });
  if (!authz.ok) return authz.response;

  let input;
  try {
    input = await validateRequest(scheduleBulkSchema, req);
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
    const result = await upsertSchedulesBulkHandler(
      await createClient(),
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
      },
      input,
    );
    return ok(result, { requestId });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId });
    throw err;
  }
}
