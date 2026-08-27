import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { validateRequest, providerUpdateSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { getProviderHandler, updateProviderHandler } from "../../_handler";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ providerId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { providerId } = await params;

  const authz = await requireRole("agent", { requestId, resource: "scheduling" });
  if (!authz.ok) return authz.response;

  try {
    const provider = await getProviderHandler(
      await createClient(),
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
      },
      providerId,
    );
    return ok(provider, { requestId });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId });
    throw err;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ providerId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { providerId } = await params;

  const authz = await requireRole("agent", { requestId, resource: "scheduling" });
  if (!authz.ok) return authz.response;

  let input;
  try {
    input = await validateRequest(providerUpdateSchema, req);
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
    const result = await updateProviderHandler(
      await createClient(),
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
      },
      providerId,
      input,
    );
    return ok(result, { requestId });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId });
    throw err;
  }
}
