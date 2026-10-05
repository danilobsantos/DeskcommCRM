import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: deps.audit }));

/**
 * EDIÇÃO DE COMPROMISSOS (9015) — título, observação, paciente, conversa e
 * tipo gravam pelo PATCH, e a criação sem título usa o nome do cliente.
 *
 * O molde é o de `agenda-criacao-com-o-responsavel-do-corpo.test.ts`: a grade
 * e a ocupação são dado (mock de `consulta`), o cliente falso registra o
 * patch que chegou ao `fn_appointment_change`, e é nele que a decisão aparece.
 */
const consulta = vi.hoisted(() => ({
  horarios: vi.fn(async () => ({
    ok: true,
    publicouHorarios: true,
    fusoDaRegra: "America/Sao_Paulo",
    slots: [{ inicio: new Date(INICIO), fim: new Date("2026-09-21T14:00:00.000Z") }],
  })),
  ocupacao: vi.fn(async () => ({ ok: true, ocupados: [] })),
}));
vi.mock("@/lib/agenda/consulta", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  horariosLivresDaOrg: consulta.horarios,
  coletaOQueOcupa: consulta.ocupacao,
}));

import {
  alterarAgendamentoHandler,
  marcarAgendamentoHandler,
} from "@/app/api/v1/agenda/agendamentos/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const ORG = "00000000-0000-4000-8000-000000000001";
const DONO = "00000000-0000-4000-8000-0000000000aa";
const TIPO = "00000000-0000-4000-8000-0000000000dd";
const TIPO_LONGO = "00000000-0000-4000-8000-0000000000dc";
const APPT = "00000000-0000-4000-8000-0000000000ee";
const PACIENTE_A = "00000000-0000-4000-8000-000000000a01";
const PACIENTE_B = "00000000-0000-4000-8000-000000000a02";
const PACIENTE_FORA = "00000000-0000-4000-8000-000000000a03";
const INICIO = "2026-09-21T13:00:00.000Z";

const tipoDe = (id: string, duracao: number) => ({
  id,
  name: id === TIPO ? "Consulta" : "Sessão longa",
  is_active: true,
  duration_minutes: duracao,
  default_owner_user_id: DONO,
  requires_confirmation: false,
  location_kind: "none",
  location_details: null,
});

const atualDe = (contato: string | null = PACIENTE_A) => ({
  id: APPT,
  revision: 3,
  event_type_id: TIPO,
  owner_user_id: DONO,
  provider_id: null,
  contact_id: contato,
  title: "Consulta",
  description: null,
  starts_at: INICIO,
  ends_at: "2026-09-21T13:30:00.000Z",
  status: "confirmed",
  time_zone: "America/Sao_Paulo",
});

const contatoDe = (id: string) => ({
  id,
  // `name` primeiro, como `nomeDoContato` manda: é o nome do cadastro, e o
  // `display_name` é o pushName da ingestão.
  display_name: id === PACIENTE_A ? "Mah" : "Jão",
  name: id === PACIENTE_A ? "Maria Silva" : "João Souza",
});

/**
 * O cliente falso: `atual`/`tipo`/`contato` por tabela, `patches` com o que
 * chegou ao `fn_appointment_change`, `inseridos` com o que foi criado.
 */
function sbDeTeste(opcoes: {
  atual?: Record<string, unknown> | null;
  tipos?: Record<string, Record<string, unknown>>;
  contatos?: Record<string, Record<string, unknown>>;
  patches: Record<string, unknown>[];
  inseridos: Record<string, unknown>[];
}) {
  const salvo = {
    id: APPT,
    starts_at: INICIO,
    ends_at: "2026-09-21T13:30:00.000Z",
    status: "confirmed",
    time_zone: "America/Sao_Paulo",
    revision: 4,
    confirmation_next_at: null,
    outcome_source_kind: null,
    outcome_message_id: null,
    meeting_state: "none",
    meeting_url: null,
  };
  const api = {
    from(tabela: string) {
      const filtros: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (coluna: string, valor: unknown) => {
          filtros[coluna] = valor;
          return q;
        },
        is: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          if (tabela === "calendar_appointments") return { data: opcoes.atual ?? null, error: null };
          if (tabela === "calendar_event_types") {
            const tipo = (opcoes.tipos ?? {})[filtros.id as string];
            return { data: tipo ?? null, error: null };
          }
          if (tabela === "contacts") {
            const contato = (opcoes.contatos ?? {})[filtros.id as string];
            return { data: contato ?? null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => ({ data: salvo, error: null }),
        insert: (linha: Record<string, unknown>) => {
          opcoes.inseridos.push(linha);
          return q;
        },
        update: () => q,
        delete: () => q,
      };
      return q;
    },
    async rpc(nome: string, args?: Record<string, unknown>) {
      if (nome === "fn_colegas_podem_mexer_na_agenda") return { data: true, error: null };
      if (nome === "fn_appointment_change") {
        opcoes.patches.push((args as { p_patch: Record<string, unknown> }).p_patch);
        return { data: salvo, error: null };
      }
      return { data: null, error: null };
    },
  };
  return api as unknown as SupabaseClient;
}

const ctxDe = (papel = "agent", quem = DONO): HandlerCtx =>
  ({
    organization_id: ORG,
    requestId: "req-9015",
    actor: { type: "user", id: quem, role: papel },
  }) as unknown as HandlerCtx;

const TIPOS = { [TIPO]: tipoDe(TIPO, 30), [TIPO_LONGO]: tipoDe(TIPO_LONGO, 60) };
const CONTATOS = { [PACIENTE_A]: contatoDe(PACIENTE_A), [PACIENTE_B]: contatoDe(PACIENTE_B) };

beforeEach(() => {
  vi.resetAllMocks();
  consulta.horarios.mockResolvedValue({
    ok: true,
    publicouHorarios: true,
    fusoDaRegra: "America/Sao_Paulo",
    slots: [{ inicio: new Date(INICIO), fim: new Date("2026-09-21T14:00:00.000Z") }],
  });
  consulta.ocupacao.mockResolvedValue({ ok: true, ocupados: [] });
});

describe("PATCH title/description/contact_id/conversation_id/event_type_id", () => {
  it("título e observação gravam direto, sem transição e sem mexer no horário", async () => {
    const patches: Record<string, unknown>[] = [];
    const inseridos: Record<string, unknown>[] = [];
    const sb = sbDeTeste({ atual: atualDe(), tipos: TIPOS, contatos: CONTATOS, patches, inseridos });

    await alterarAgendamentoHandler(sb, ctxDe(), {
      id: APPT,
      revision: 3,
      title: "Maria Silva",
      description: "Retorno de 6 meses",
    });

    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ title: "Maria Silva", description: "Retorno de 6 meses" });
    expect(patches[0]).not.toHaveProperty("starts_at");
    expect(patches[0]).not.toHaveProperty("ends_at");
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "agenda.appointment_updated" }),
    );
  });

  it("observação vazia limpa (vira null, como na criação)", async () => {
    const patches: Record<string, unknown>[] = [];
    const inseridos: Record<string, unknown>[] = [];
    const sb = sbDeTeste({
      atual: { ...atualDe(), description: "Alguma nota" },
      tipos: TIPOS,
      contatos: CONTATOS,
      patches,
      inseridos,
    });

    await alterarAgendamentoHandler(sb, ctxDe(), { id: APPT, revision: 3, description: "   " });

    expect(patches[0]).toMatchObject({ description: null });
  });

  it("troca de paciente resolve o vínculo na org e solta a conversa junto", async () => {
    const patches: Record<string, unknown>[] = [];
    const inseridos: Record<string, unknown>[] = [];
    const sb = sbDeTeste({ atual: atualDe(PACIENTE_A), tipos: TIPOS, contatos: CONTATOS, patches, inseridos });

    await alterarAgendamentoHandler(sb, ctxDe(), { id: APPT, revision: 3, contact_id: PACIENTE_B });

    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ contact_id: PACIENTE_B, conversation_id: null });
    // Rastreabilidade: quem trocou, de quem para quem.
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "agenda.appointment_updated",
        metadata: expect.objectContaining({
          contact_id_anterior: PACIENTE_A,
          contact_id_novo: PACIENTE_B,
        }),
      }),
    );
  });

  it("paciente de outra organização: 404 SEM escrita", async () => {
    const patches: Record<string, unknown>[] = [];
    const inseridos: Record<string, unknown>[] = [];
    const sb = sbDeTeste({ atual: atualDe(PACIENTE_A), tipos: TIPOS, contatos: CONTATOS, patches, inseridos });

    await expect(
      alterarAgendamentoHandler(sb, ctxDe(), { id: APPT, revision: 3, contact_id: PACIENTE_FORA }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });

    expect(patches).toHaveLength(0);
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it("desvincular o paciente (null) passa e solta a conversa", async () => {
    const patches: Record<string, unknown>[] = [];
    const inseridos: Record<string, unknown>[] = [];
    const sb = sbDeTeste({ atual: atualDe(PACIENTE_A), tipos: TIPOS, contatos: CONTATOS, patches, inseridos });

    await alterarAgendamentoHandler(sb, ctxDe(), { id: APPT, revision: 3, contact_id: null });

    expect(patches[0]).toMatchObject({ contact_id: null, conversation_id: null });
  });

  it("troca de tipo recalcula o fim pela nova duração e revalida a grade", async () => {
    const patches: Record<string, unknown>[] = [];
    const inseridos: Record<string, unknown>[] = [];
    const sb = sbDeTeste({ atual: atualDe(null), tipos: TIPOS, contatos: CONTATOS, patches, inseridos });

    await alterarAgendamentoHandler(sb, ctxDe(), { id: APPT, revision: 3, event_type_id: TIPO_LONGO });

    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      event_type_id: TIPO_LONGO,
      starts_at: INICIO,
      // 30min → 60min, mesmo início.
      ends_at: "2026-09-21T14:00:00.000Z",
    });
    expect(consulta.horarios).toHaveBeenCalled();
    expect(deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "agenda.appointment_rescheduled" }),
    );
  });

  it("tipo para um tipo desativado: recusa SEM escrita", async () => {
    const patches: Record<string, unknown>[] = [];
    const inseridos: Record<string, unknown>[] = [];
    const tipos = { ...TIPOS, [TIPO_LONGO]: { ...tipoDe(TIPO_LONGO, 60), is_active: false } };
    const sb = sbDeTeste({ atual: atualDe(null), tipos, contatos: CONTATOS, patches, inseridos });

    await expect(
      alterarAgendamentoHandler(sb, ctxDe(), { id: APPT, revision: 3, event_type_id: TIPO_LONGO }),
    ).rejects.toMatchObject({ status: 422, code: "agenda_tipo_desativado" });

    expect(patches).toHaveLength(0);
  });

  it("título igual ao atual: devolve inalterado SEM escrita", async () => {
    const patches: Record<string, unknown>[] = [];
    const inseridos: Record<string, unknown>[] = [];
    const sb = sbDeTeste(
      { atual: atualDe(), tipos: TIPOS, contatos: CONTATOS, patches, inseridos },
    );

    const r = await alterarAgendamentoHandler(sb, ctxDe(), {
      id: APPT,
      revision: 3,
      title: "Consulta",
    });

    expect(r).toMatchObject({ id: APPT });
    expect(patches).toHaveLength(0);
  });
});

describe("criação sem título usa o nome do cliente", () => {
  const pedido = { event_type_id: TIPO, starts_at: INICIO } as const;

  it("com paciente e sem título: o título é o nome do contato", async () => {
    const patches: Record<string, unknown>[] = [];
    const inseridos: Record<string, unknown>[] = [];
    const sb = sbDeTeste({ tipos: TIPOS, contatos: CONTATOS, patches, inseridos });

    await marcarAgendamentoHandler(sb, ctxDe(), { ...pedido, contact_id: PACIENTE_A });

    expect(inseridos).toHaveLength(1);
    expect(inseridos[0]).toMatchObject({ title: "Maria Silva", contact_id: PACIENTE_A });
  });

  it("título explícito vence o nome do contato", async () => {
    const patches: Record<string, unknown>[] = [];
    const inseridos: Record<string, unknown>[] = [];
    const sb = sbDeTeste({ tipos: TIPOS, contatos: CONTATOS, patches, inseridos });

    await marcarAgendamentoHandler(sb, ctxDe(), {
      ...pedido,
      contact_id: PACIENTE_A,
      title: "Avaliação inicial",
    });

    expect(inseridos[0]).toMatchObject({ title: "Avaliação inicial" });
  });

  it("sem paciente: continua o nome do tipo", async () => {
    const patches: Record<string, unknown>[] = [];
    const inseridos: Record<string, unknown>[] = [];
    const sb = sbDeTeste({ tipos: TIPOS, contatos: CONTATOS, patches, inseridos });

    await marcarAgendamentoHandler(sb, ctxDe(), pedido);

    expect(inseridos[0]).toMatchObject({ title: "Consulta" });
  });
});

describe("migration 9015 e baseline aplicam as mesmas colunas", () => {
  const RAIZ = join(__dirname, "..", "..");
  const CHAVES = ["p_patch?'title'", "p_patch?'description'", "p_patch?'contact_id'", "p_patch?'conversation_id'", "p_patch?'event_type_id'"];
  const STAMP = "new.contact_id)";

  it("o SET do núcleo e o carimbo do Google existem nos dois artefatos", () => {
    const migracao = readFileSync(
      join(RAIZ, "supabase/migrations/20261005140000_9015_edicao_de_compromisso.sql"),
      "utf8",
    );
    const baseline = readFileSync(join(RAIZ, "supabase/baseline.sql"), "utf8");
    for (const chave of CHAVES) {
      expect(migracao, `migration sem ${chave}`).toContain(chave);
      expect(baseline, `baseline sem ${chave}`).toContain(chave);
    }
    // O carimbo do Google vigia o paciente nos dois.
    expect(migracao).toContain(STAMP);
    expect(baseline).toContain(STAMP);
  });
});
