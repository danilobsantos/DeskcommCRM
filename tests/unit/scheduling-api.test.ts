import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_ID = "33333333-3333-4333-8333-333333333333";

function mockAuthOk(role: "agent" | "manager" | "admin" = "agent") {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: {
      id: USER_ID,
      email: "user@example.com",
      full_name: "Test User",
      avatar_url: null,
      is_platform_admin: false,
      organizations: [{ organization_id: ORG_ID, organization_name: "Org Test", role }],
    },
    org: {
      orgId: ORG_ID,
      name: "Org Test",
      role,
    },
  });
}

function mockAuthUnauthorized() {
  vi.mocked(requireRole).mockResolvedValue({
    ok: false,
    response: fail("unauthenticated", "Auth required.", 401, {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/scheduling/providers", () => {
  it("sem autenticação → retorna 401 via requireRole", async () => {
    mockAuthUnauthorized();
    const { GET } = await import("@/app/api/v1/scheduling/providers/route");
    const req = new NextRequest("http://localhost/api/v1/scheduling/providers");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("com autenticação → lista os providers da org ativa", async () => {
    mockAuthOk();

    const mockProviders = [
      { id: PROVIDER_ID, name: "Dr. Silva", specialties: ["Ortodontia"], active: true },
    ];

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: mockProviders, error: null }),
        }),
      }),
    });

    vi.mocked(createClient).mockResolvedValue({
      from: mockFrom,
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const { GET } = await import("@/app/api/v1/scheduling/providers/route");
    const req = new NextRequest("http://localhost/api/v1/scheduling/providers");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: typeof mockProviders };
    expect(json.data).toEqual(mockProviders);
    expect(mockFrom).toHaveBeenCalledWith("providers");
  });
});

describe("GET /api/v1/scheduling/schedules", () => {
  it("sem provider_id → retorna 422", async () => {
    mockAuthOk();
    const { GET } = await import("@/app/api/v1/scheduling/schedules/route");
    const req = new NextRequest("http://localhost/api/v1/scheduling/schedules");
    const res = await GET(req);

    expect(res.status).toBe(422);
  });

  it("com provider_id válido → lista as janelas daquele provider", async () => {
    mockAuthOk();

    const mockSchedules = [
      {
        id: "s1",
        day_of_week: 1,
        start_time: "09:00:00",
        end_time: "17:00:00",
        slot_duration_minutes: 30,
      },
    ];

    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockSchedules, error: null }),
            }),
          }),
        }),
      }),
    });

    vi.mocked(createClient).mockResolvedValue({
      from: mockFrom,
    } as unknown as Awaited<ReturnType<typeof createClient>>);

    const { GET } = await import("@/app/api/v1/scheduling/schedules/route");
    const req = new NextRequest(`http://localhost/api/v1/scheduling/schedules?provider_id=${PROVIDER_ID}`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: typeof mockSchedules };
    expect(json.data).toEqual(mockSchedules);
  });
});

describe("GET /api/v1/scheduling/availability", () => {
  it("sem query válida → retorna 422", async () => {
    mockAuthOk();
    const { GET } = await import("@/app/api/v1/scheduling/availability/route");
    const req = new NextRequest("http://localhost/api/v1/scheduling/availability");
    const res = await GET(req);

    expect(res.status).toBe(422);
  });
});
