import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { availabilityQuerySchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { getAvailabilityHandler } from "../_handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "scheduling" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const qsParsed = availabilityQuerySchema.safeParse({
    provider_id: url.searchParams.get("provider_id"),
    date: url.searchParams.get("date"),
  });

  if (!qsParsed.success) {
    return fail("validation_failed", "Query inválida.", 422, {
      details: qsParsed.error.flatten().fieldErrors,
      requestId,
    });
  }

  const supabase = await createClient();

  try {
    const result = await getAvailabilityHandler(
      supabase,
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
      },
      qsParsed.data,
    );
    return ok(result, { requestId });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId });
    throw err;
  }
}
