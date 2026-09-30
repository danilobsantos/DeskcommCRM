/**
 * EXCLUIR PROFISSIONAL — o bloqueio antes do banco.
 *
 * O Postgres deixaria (`SET NULL` nos compromissos), mas a linha viraria órfã
 * sem dono: some dos filtros por profissional e o histórico fica sem
 * responsável. Por isso a action CONTA as futuras antes e recusa com o número
 * — quem exclui transfere ou cancela antes. O que cada caso guarda:
 *
 * 1. Com futura, nem o DELETE sai (só a contagem) e o erro traz a quantidade.
 * 2. Sem futura, apaga com o filtro de org, audita `agenda.provider_deleted`
 *    e volta ok.
 * 3. Linha de outra org (ou inexistente) vira "não encontrado", não ok.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { headers } from "next/headers";

import { audit } from "@/lib/audit";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { supportWriteError } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

import { excluirProfissional } from "./providers";

vi.mock("@/lib/auth/server", () => ({
  requireAuth: vi.fn(),
  resolveActiveOrg: vi.fn(),
}));
vi.mock("@/lib/impersonate/support", () => ({ supportWriteError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

/** Cadeia `.from(tabela)` que grava as chamadas e devolve o configurado. */
function mockSupabase(futuras: number, removido: unknown) {
  const chamadas: Array<{ tabela: string; metodo: string }> = [];
  const contagem = { count: futuras, error: null };
  const deleteChain: Record<string, unknown> = {};
  deleteChain.delete = () => {
    chamadas.push({ tabela: "calendar_appointments", metodo: "noop" });
    return deleteChain;
  };
  return {
    chamadas,
    supabase: {
      from: (tabela: string) => {
        if (tabela === "calendar_appointments") {
          const q: Record<string, unknown> = {};
          q.select = () => q;
          q.eq = () => q;
          q.in = () => q;
          q.gte = async () => contagem;
          return q;
        }
        // providers: .delete().eq(org).eq(id).select().maybeSingle()
        const q: Record<string, unknown> = {};
        q.delete = () => {
          chamadas.push({ tabela, metodo: "delete" });
          return q;
        };
        q.eq = () => q;
        q.select = () => q;
        q.maybeSingle = async () => ({ data: removido, error: null });
        return q;
      },
    },
  };
}

function sessaoDeManager() {
  vi.mocked(requireAuth).mockResolvedValue({
    id: "user-1",
    is_platform_admin: false,
    support: null,
  } as never);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: "org-1", role: "manager" } as never);
  vi.mocked(supportWriteError).mockReturnValue(null);
  vi.mocked(headers).mockResolvedValue(new Headers());
}

describe("excluirProfissional", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessaoDeManager();
  });

  it("com consulta futura, recusa com o número e nem tenta apagar", async () => {
    const { chamadas, supabase } = mockSupabase(2, null);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const r = await excluirProfissional("prov-1");

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("2 consulta(s) futura(s)");
    expect(chamadas.some((c) => c.metodo === "delete")).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it("sem futura, apaga, audita e volta ok", async () => {
    const { chamadas, supabase } = mockSupabase(0, { id: "prov-1", name: "Dra. Ana" });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const r = await excluirProfissional("prov-1");

    expect(r).toEqual({ ok: true });
    expect(chamadas.some((c) => c.metodo === "delete")).toBe(true);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "agenda.provider_deleted" }));
  });

  it("linha de outra org vira não-encontrado", async () => {
    const { supabase } = mockSupabase(0, null);
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const r = await excluirProfissional("prov-outra-org");

    expect(r.ok).toBe(false);
  });

  it("sem papel de gestão, nem conta", async () => {
    vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: "org-1", role: "agent" } as never);
    const { chamadas, supabase } = mockSupabase(0, { id: "prov-1", name: "Dra. Ana" });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const r = await excluirProfissional("prov-1");

    expect(r.ok).toBe(false);
    expect(chamadas.some((c) => c.metodo === "delete")).toBe(false);
  });
});
