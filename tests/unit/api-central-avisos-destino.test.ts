import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/v1/ai/inbox/route";
import { PATCH } from "@/app/api/v1/ai/inbox/[id]/route";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
const org = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
const item = { id, kind: "handoff", ref_kind: "conversation", ref_id: id, status: "open" };
const calls: string[][] = [];
function client(admin: boolean, readable = false) {
  return { from(table: string) {
    calls.push([admin ? "admin" : "authenticated", table]);
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (key: string, value: string) => { calls.push([key, value]); return chain; },
      in: () => chain, update: () => chain,
      maybeSingle: async () => ({ data: item, error: null }),
      then: (resolve: (data: unknown) => unknown) => Promise.resolve({ data: admin ? [item] : readable ? [{ id }] : [], error: null, count: 1 }).then(resolve),
    }; return chain;
  } };
}
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0;
  vi.mocked(requireRole).mockResolvedValue({ ok: true, org: { orgId: org, role: "agent", name: "Org" }, user: { id: "actor" } } as Awaited<ReturnType<typeof requireRole>>);
  vi.mocked(createAdminClient).mockReturnValue(client(true) as unknown as ReturnType<typeof createAdminClient>);
  vi.mocked(createClient).mockResolvedValue(client(false) as unknown as Awaited<ReturnType<typeof createClient>>);
});
describe("API Central projeta destinos com sessão", () => {
  it("admin lista, JWT autentica destino: zero linha RLS não herda existência do aviso", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/ai/inbox"));
    expect(response.status).toBe(200);
    expect((await response.json()).data.items[0].destination.estado).toBe("indisponivel");
    // Fila aberta: uma consulta por gravidade + a contagem de abertos.
    expect(calls.filter(c => c[0] === "admin")).toEqual(Array(4).fill(["admin", "agent_inbox_items"]));
    expect(calls).toContainEqual(["authenticated", "conversations"]);
    // 5 filtros de org (3 gravidades + contagem + destino) + os lotes de
    // contato da mesma request (conversas/contatos, só quando há referência
    // com pessoa). `>=` de propósito: o número cresce com cada caminho novo
    // que ganha nome na Central, e travar o exato transformaria este teste em
    // detector de diff.
    expect(calls.filter(c => c[0] === "organization_id").length).toBeGreaterThanOrEqual(5);
    expect(requireRole).toHaveBeenCalledWith("agent", expect.any(Object));
    expect(audit).not.toHaveBeenCalled();
  });
  it("controle positivo recebe URL apenas pela leitura autenticada", async () => {
    vi.mocked(createClient).mockResolvedValue(client(false, true) as unknown as Awaited<ReturnType<typeof createClient>>);
    const response = await GET(new NextRequest("http://localhost/api/v1/ai/inbox"));
    expect((await response.json()).data.items[0].destination.href).toBe(`/app/inbox/${id}`);
  });
  it.each([401, 403])("nega %i antes de consultar: cookie requerido e viewer não elevado", async status => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: new Response(null, { status }) } as Awaited<ReturnType<typeof requireRole>>);
    expect((await GET(new NextRequest("http://localhost/api/v1/ai/inbox", { headers: { Authorization: "Bearer dsk_fake" } }))).status).toBe(status);
    expect(createAdminClient).not.toHaveBeenCalled(); expect(createClient).not.toHaveBeenCalled();
  });
  it.each(["resolved", "open"])("PATCH %s continua filtrado e auditado", async status => {
    const response = await PATCH(new NextRequest(`http://localhost/api/v1/ai/inbox/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(calls).toContainEqual(["organization_id", org]);
    expect(audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: "ai.inbox_item_status_changed", organizationId: org, actorUserId: "actor", resourceId: id, metadata: { status } }));
  });
});

describe("Central: fila aberta por gravidade", () => {
  // Cada consulta devolve só as linhas da gravidade filtrada, em ordem de data
  // desc — o que o Postgres faria. A pergunta é o que a ROTA monta com isso.
  const linhas = [
    { id: "info-nova", severity: "info", created_at: "2026-09-26T10:00:00Z" },
    { id: "warn-nova", severity: "warn", created_at: "2026-09-26T09:00:00Z" },
    { id: "warn-velha", severity: "warn", created_at: "2026-09-20T09:00:00Z" },
    { id: "critico-velho", severity: "critical", created_at: "2026-09-01T09:00:00Z" },
  ].map(l => ({ ...l, kind: "handoff", ref_kind: null, ref_id: null, status: "open" }));
  const consultas: Record<string, string>[] = [];
  function banco() {
    return { from() {
      const filtros: Record<string, string> = {};
      let teto = Infinity;
      const chain = {
        select: () => chain, order: () => chain,
        limit: (n: number) => { teto = n; return chain; },
        eq: (k: string, v: string) => { filtros[k] = v; return chain; },
        in: () => chain,
        then: (resolve: (d: unknown) => unknown) => {
          consultas.push(filtros);
          const data = linhas.filter(l => !filtros.severity || l.severity === filtros.severity).slice(0, teto);
          return Promise.resolve({ data, error: null, count: linhas.length }).then(resolve);
        },
      }; return chain;
    } };
  }
  beforeEach(() => {
    consultas.length = 0;
    vi.mocked(createAdminClient).mockReturnValue(banco() as unknown as ReturnType<typeof createAdminClient>);
  });
  const ids = async (qs: string) =>
    ((await (await GET(new NextRequest(`http://localhost/api/v1/ai/inbox${qs}`))).json()).data.items as { id: string }[]).map(i => i.id);

  it("crítico antigo sai acima de aviso novo; entre iguais, o mais recente", async () => {
    expect(await ids("")).toEqual(["critico-velho", "warn-nova", "warn-velha", "info-nova"]);
  });
  it("o limite corta por baixo: o crítico mais antigo nunca fica de fora", async () => {
    expect(await ids("?limit=2")).toEqual(["critico-velho", "warn-nova"]);
  });
  it("resolvidos seguem histórico: uma consulta, mais recente primeiro, sem filtro de gravidade", async () => {
    await ids("?status=resolved");
    const daLista = consultas.filter(c => c.status === "resolved");
    expect(daLista).toHaveLength(1);
    expect(daLista[0]).not.toHaveProperty("severity");
  });
  it("filtro de gravidade: uma consulta só, com a gravidade pedida", async () => {
    expect(await ids("?severity=critical")).toEqual(["critico-velho"]);
    const comFiltro = consultas.filter(c => c.severity === "critical");
    expect(comFiltro).toHaveLength(1);
  });
  it("has_more acusa quando o excedente +1 volta; sem sobra, é falso", async () => {
    const poucas = await (await GET(new NextRequest("http://localhost/api/v1/ai/inbox?limit=2"))).json();
    expect(poucas.data.has_more).toBe(true);
    const todas = await (await GET(new NextRequest("http://localhost/api/v1/ai/inbox"))).json();
    expect(todas.data.has_more).toBe(false);
  });
});

describe("Central: contato do aviso em lote", () => {
  const CONV = "33333333-3333-4333-8333-333333333333", CONT = "44444444-4444-4434-8434-444444444444";
  const linhas = [
    { id: "aviso-com-pessoa", kind: "handoff", severity: "warn", ref_kind: "conversation", ref_id: CONV, status: "open", created_at: "2026-09-26T10:00:00Z" },
    { id: "aviso-sem-pessoa", kind: "qr_rescan", severity: "warn", ref_kind: "channel_session", ref_id: CONV, status: "open", created_at: "2026-09-26T09:00:00Z" },
  ];
  function banco() {
    return { from(tabela: string) {
      const filtros: Record<string, string> = {};
      let teto = Infinity;
      const chain = {
        select: () => chain, order: () => chain,
        limit: (n: number) => { teto = n; return chain; },
        eq: (k: string, v: string) => { filtros[k] = v; return chain; },
        in: () => chain, is: () => chain,
        then: (resolve: (d: unknown) => unknown) => {
          if (tabela === "agent_inbox_items") {
            const data = linhas.filter(l => !filtros.severity || l.severity === filtros.severity).slice(0, teto);
            return Promise.resolve({ data, error: null, count: linhas.length }).then(resolve);
          }
          if (tabela === "conversations") {
            return Promise.resolve({ data: [{ id: CONV, contact_id: CONT }], error: null }).then(resolve);
          }
          if (tabela === "contacts") {
            return Promise.resolve({ data: [{ id: CONT, display_name: "Apelido do Zap", name: "Maria Silva", phone_number: "+5511999990001" }], error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      }; return chain;
    } };
  }
  beforeEach(() => {
    vi.mocked(createAdminClient).mockReturnValue(banco() as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(createClient).mockResolvedValue(banco() as unknown as Awaited<ReturnType<typeof createClient>>);
  });
  it("conversa com contato: nome do cadastro + telefone; sem pessoa: null", async () => {
    const corpo = await (await GET(new NextRequest("http://localhost/api/v1/ai/inbox"))).json();
    const porId = Object.fromEntries((corpo.data.items as Array<{ id: string; contato: { nome: string | null; telefone: string | null } | null }>).map(i => [i.id, i.contato]));
    expect(porId["aviso-com-pessoa"]).toEqual({ nome: "Maria Silva", telefone: "+5511999990001" });
    expect(porId["aviso-sem-pessoa"]).toBeNull();
  });
});
