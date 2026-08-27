import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { availabilityQuerySchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { getAvailabilityHandler } from "../_handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return fail("unauthenticated", "Auth required.", 401, { requestId });

  const authUser = await loadAuthUser();
  const orgId = authUser ? (await resolveActiveOrg(authUser))?.orgId : undefined;

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

  try {
    const result = await getAvailabilityHandler(
      supabase,
      {
        organization_id: orgId ?? "",
        actor: { type: "user", id: user.id },
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
