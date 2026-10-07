import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type * as AgendaConsulta from "@/lib/agenda/consulta";
import type { ResultadoDaConsulta } from "@/lib/agenda/consulta";
import type { McpContext } from "@/lib/mcp/types";

/**
 * `crm_find_and_book_appointment` COM PROFISSIONAL (9017) — o dono viaja junto.
 *
 * O `api_audit_log` mediu em produção (2026-10-07): 20/20 consultas sem dono e
 * zero marcações em 1h, porque a cadeia caía na agenda do atendente padrão. A
 * ferramenta "preferida" (é o que a própria `description` diz) nem ACEITAVA
 * `provider_id`: consultar e marcar com profissional era impossível por ela.
 */
vi.mock("@/app/api/v1/agenda/agendamentos/_handler", () => ({
  marcarAgendamentoHandler: vi.fn(),
  alterarAgendamentoHandler: vi.fn(),
  cancelarAgendamentoHandler: vi.fn(),
}));

vi.mock("@/lib/agenda/consulta", async (original) => {
  const real = await original<typeof AgendaConsulta>();
  return { ...real, horariosLivresDaOrg: vi.fn(), listaAgendamentos: vi.fn(), idDoTipoPorSlug: vi.fn() };
});

const { horariosLivresDaOrg, idDoTipoPorSlug } = await import("@/lib/agenda/consulta");
const { crmFindAndBookAppointment } = await import("@/lib/mcp/tools/agendamento");
const handlers = await import("@/app/api/v1/agenda/agendamentos/_handler");

const ctx: McpContext = {
  organizationId: "org-1",
  role: "agent",
  actor: { type: "ai_agent", id: "ag-1", role: "ai_operator" },
  apiTokenId: "tok-1",
  requestId: "req-1",
  supabase: {} as unknown as SupabaseClient,
};

const PROVIDER = "11111111-1111-4111-8111-111111111111";
const CONTATO = "22222222-2222-4222-8222-222222222222";

const SUCESSO: ResultadoDaConsulta = {
  ok: true,
  slots: [{ inicio: new Date("2026-10-20T14:00:00Z"), fim: new Date("2026-10-20T14:30:00Z") }],
  fusoDaRegra: "America/Sao_Paulo",
  publicouHorarios: true,
  fusoSuposto: false,
  fontesDefasadas: [],
  agendaExternaNuncaLida: false,
  googleCoberturaParcial: false,
};

const pedidoCom = (extra: Record<string, unknown> = {}) => ({
  event_type_slug: "limpeza",
  dia: "2026-10-20",
  horario: "11:00",
  contact_id: CONTATO,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(horariosLivresDaOrg).mockResolvedValue(SUCESSO);
  vi.mocked(idDoTipoPorSlug).mockResolvedValue({ id: "t-1", nome: "Limpeza" });
  vi.mocked(handlers.marcarAgendamentoHandler).mockResolvedValue({ id: "appt-1" });
});

describe("find_and_book com profissional", () => {
  it("consulta leva ownerProviderId e zera ownerUserId (exclusividade)", async () => {
    await crmFindAndBookAppointment.handler(pedidoCom({ provider_id: PROVIDER }), ctx);

    const params = vi.mocked(horariosLivresDaOrg).mock.calls[0]![2];
    expect(params.ownerProviderId).toBe(PROVIDER);
    expect(params.ownerUserId).toBeNull();
  });

  it("a marcação recebe provider_id (não cai no atendente padrão)", async () => {
    await crmFindAndBookAppointment.handler(pedidoCom({ provider_id: PROVIDER }), ctx);

    expect(handlers.marcarAgendamentoHandler).toHaveBeenCalledOnce();
    const input = vi.mocked(handlers.marcarAgendamentoHandler).mock.calls[0]![2];
    expect(input).toMatchObject({ provider_id: PROVIDER });
    expect(input).not.toHaveProperty("owner_user_id");
  });

  it("sem provider_id, o caminho do atendente continua igual", async () => {
    await crmFindAndBookAppointment.handler(pedidoCom({ owner_user_id: "u-1" }), ctx);

    const params = vi.mocked(horariosLivresDaOrg).mock.calls[0]![2];
    expect(params.ownerUserId).toBe("u-1");
    expect(params.ownerProviderId).toBeNull();
    const input = vi.mocked(handlers.marcarAgendamentoHandler).mock.calls[0]![2];
    expect(input).toMatchObject({ owner_user_id: "u-1" });
    expect(input).not.toHaveProperty("provider_id");
  });

  it("dia fechado do profissional: nada marcado, e a lista do dia volta", async () => {
    vi.mocked(horariosLivresDaOrg).mockResolvedValue({ ...SUCESSO, slots: [] });

    const r = (await crmFindAndBookAppointment.handler(pedidoCom({ provider_id: PROVIDER }), ctx)) as {
      marcado: boolean;
    };

    expect(r.marcado).toBe(false);
    expect(handlers.marcarAgendamentoHandler).not.toHaveBeenCalled();
  });
});
