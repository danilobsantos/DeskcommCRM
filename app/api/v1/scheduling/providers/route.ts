import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { validateRequest, providerCreateSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { listProvidersHandler, createProviderHandler } from "../_handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "scheduling" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const specialty = url.searchParams.get("specialty") ?? undefined;
  const active = url.searchParams.get("active");

  const supabase = await createClient();

  try {
    const providers = await listProvidersHandler(
      supabase,
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
      },
      {
        specialty,
        active: active !== null ? active === "true" : undefined,
      },
    );
    return ok(providers, { requestId });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId });
    throw err;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "scheduling" });
  if (!authz.ok) return authz.response;

  let input;
  try {
    input = await validateRequest(providerCreateSchema, req);
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
    const result = await createProviderHandler(
      await createClient(),
      {
        organization_id: authz.org.orgId,
        actor: { type: "user", id: authz.user.id },
        requestId,
      },
      input,
    );
    return ok(result, { status: 201, requestId });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.code, err.message, err.status, { requestId });
    throw err;
  }
}
