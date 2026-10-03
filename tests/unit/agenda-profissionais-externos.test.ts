/**
 * PROFISSIONAIS EXTERNOS (migration 9003) — a flag por tenant e o ramo de
 * provider do motor de horários.
 *
 * Duas coisas precisam de guarda aqui, e as duas são o tipo de bug silencioso
 * que este repo mede:
 *
 * 1. A flag `settings.scheduling.providers_enabled` é OPT-IN e OFF por default —
 *    a agenda do base (atendentes + IA) não pode mudar de comportamento sem
 *    alguém ligar. Default errado = feature vazando para todos os tenants.
 *
 * 2. O ramo `ownerProviderId` de `horariosLivresDaOrg` LÊ a jornada de
 *    `providers.schedule` (não `attendant_availability`), filtra exceções e
 *    compromissos por `provider_id`, e PULA o Google — que só existe para
 *    usuários. Esquecer qualquer um dos três faz a IA oferecer horário errado.
 */
import { describe, expect, it } from "vitest";

import { providersHabilitados } from "@/lib/agenda/providers";
import { horariosLivresDaOrg, listaAgendamentos, listaProfissionais } from "@/lib/agenda/consulta";
import { partesNoFuso } from "@/lib/agenda/fuso";
import { sidebarGroups } from "@/lib/navigation/registry";

// ── flag ──────────────────────────────────────────────────────────────
describe("providersHabilitados", () => {
  it("default OFF quando settings não existe", () => {
    expect(providersHabilitados(null)).toBe(false);
    expect(providersHabilitados(undefined)).toBe(false);
    expect(providersHabilitados({})).toBe(false);
  });

  it("ON só quando settings.scheduling.providers_enabled é exatamente true", () => {
    expect(providersHabilitados({ scheduling: { providers_enabled: true } })).toBe(true);
    expect(providersHabilitados({ scheduling: { providers_enabled: false } })).toBe(false);
    expect(providersHabilitados({ scheduling: {} })).toBe(false);
    expect(providersHabilitados({ scheduling: { providers_enabled: "true" } })).toBe(false);
  });

  it("não confunde ausência com decisão de desligar", () => {
    // `scheduling` presente mas sem a chave = também desligado, porém o caminho
    // do código (e a tela) tratam "ausente" e "false" como o mesmo estado OFF.
    expect(providersHabilitados({ scheduling: { routing: {} } })).toBe(false);
  });
});

// ── o ramo de provider do motor ───────────────────────────────────────
//
// Mock mínimo de supabase: `.from(tabela)` devolve uma cadeia que retorna o
// que foi configurado para aquela tabela, e registra as tabelas consultadas.
function mockSupabase(config: Record<string, unknown>) {
  const tabelasConsultadas: string[] = [];
  // Não é trivial tipar a cadeia completa (maybeSingle, Promise.all…); o teste
  // foca no que importa: a escolha da TABELA e o valor que volta.
  return {
    _tabelasConsultadas: tabelasConsultadas,
    from: (tabela: string) => {
      tabelasConsultadas.push(tabela);
      const resultados = config[tabela];
      const eu: Record<string, unknown> = {};
      eu.select = () => eu;
      eu.eq = () => eu;
      eu.gte = () => eu;
      eu.lte = () => eu;
      eu.lt = () => eu;
      eu.gt = () => eu;
      eu.order = () => eu;
      eu.limit = () => eu;
      eu.maybeSingle = async () =>
        Array.isArray(resultados) ? { data: resultados[0] ?? null, error: null } : { data: resultados ?? null, error: null };
      return eu;
    },
  };
}

describe("horariosLivresDaOrg com ownerProviderId", () => {
  it("lê a jornada de providers e NÃO consulta o Google (só usuário tem Google)", async () => {
    const supabase = mockSupabase({
      calendar_event_types: {
        id: "tipo-1",
        name: "Consulta",
        is_active: true,
        duration_minutes: 30,
        buffer_before_minutes: 0,
        buffer_after_minutes: 0,
        minimum_notice_minutes: 0,
        slot_interval_minutes: null,
        booking_window_days: 60,
        default_owner_user_id: null,
      },
      providers: {
        schedule: { timezone: "America/Sao_Paulo", windows: [{ dow: 1, start: "09:00", end: "10:00" }] },
        active: true,
      },
    });

    const de = new Date("2026-03-09T00:00:00Z");
    const ate = new Date("2026-03-10T00:00:00Z");
    const r = await horariosLivresDaOrg(
      supabase as never,
      "org-1",
      { eventTypeSlug: "consulta", ownerProviderId: "prov-1", de, ate, agora: de },
    );

    expect(r.ok).toBe(true);
    // A jornada é de segunda (dow 1), 09:00–10:00, duração 30min → 09:00 e 09:30.
    // Leitura no FUSO DA JORNADA (SP), não em UTC — o teste não pode depender
    // do fuso da máquina.
    if (r.ok) {
      const horasLocais = r.slots.map((s) => {
        const p = partesNoFuso(s.inicio, "America/Sao_Paulo");
        return `${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
      });
      expect(horasLocais).toContain("09:00");
      expect(horasLocais).toContain("09:30");
    }
    // Google NÃO é consultado para provider — sem `calendar_connections`/
    // `calendar_external_events` na lista de tabelas tocadas.
    const tocadas = (supabase as unknown as { _tabelasConsultadas: string[] })._tabelasConsultadas;
    expect(tocadas).not.toContain("calendar_connections");
    expect(tocadas).not.toContain("calendar_external_events");
    expect(tocadas).toContain("providers");
    expect(tocadas).not.toContain("attendant_availability");
  });

  it("recusa quando o provider não existe (sem_responsavel)", async () => {
    const supabase = mockSupabase({
      calendar_event_types: {
        id: "tipo-1",
        name: "Consulta",
        is_active: true,
        duration_minutes: 30,
        buffer_before_minutes: 0,
        buffer_after_minutes: 0,
        minimum_notice_minutes: 0,
        slot_interval_minutes: null,
        booking_window_days: 60,
        default_owner_user_id: null,
      },
      providers: null,
    });
    const de = new Date("2026-03-09T00:00:00Z");
    const r = await horariosLivresDaOrg(
      supabase as never,
      "org-1",
      { eventTypeSlug: "consulta", ownerProviderId: "prov-inexistente", de, ate: new Date("2026-03-10T00:00:00Z"), agora: de },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("sem_responsavel");
  });
});
// ── nav gated pela flag ──────────────────────────────────────────────
describe("sidebarGroups + providersRequired", () => {
  const grupo = (providersEnabled: boolean) =>
    sidebarGroups(false, "manager", undefined, providersEnabled)
      .flatMap((g) => g.items)
      .map((i) => i.href);

  it("esconde /app/agenda/profissionais com a feature OFF", () => {
    expect(grupo(false)).not.toContain("/app/agenda/profissionais");
  });

  it("mostra /app/agenda/profissionais com a feature ON", () => {
    expect(grupo(true)).toContain("/app/agenda/profissionais");
  });
});

// ── listaProfissionais ────────────────────────────────────────────────
//
// A IA só pode ver ATIVOS (`crm_list_providers` passa `apenasAtivos`): um
// inabilitado que continua na lista vira oferta que a escrita recusa —
// promessa quebrada no WhatsApp. A tela de gestão usa o default (todos, com
// o flag), então o filtro é opt-in, não mudança de default.
describe("listaProfissionais", () => {
  /** Mock que GRAVA os filtros `.eq()` — o mock da seção acima não grava. */
  function mockComFiltros(linhas: Record<string, unknown>[]) {
    const filtros: Array<[string, unknown]> = [];
    const eu: Record<string, unknown> = {};
    eu.select = () => eu;
    eu.eq = (col: string, val: unknown) => {
      filtros.push([col, val]);
      return eu;
    };
    eu.order = async () => ({ data: linhas, error: null });
    return { supabase: { from: () => eu }, filtros };
  }

  it("sem opts devolve todos, com o flag ativo/inativo", async () => {
    const { supabase } = mockComFiltros([
      { id: "a", name: "Dra. Ana", specialties: ["clínico"], active: true },
      { id: "b", name: "Dr. Bia", specialties: [], active: false },
    ]);
    const r = await listaProfissionais(supabase as never, "org-1");
    expect(r).toEqual([
      { id: "a", nome: "Dra. Ana", especialidades: ["clínico"], ativo: true },
      { id: "b", nome: "Dr. Bia", especialidades: [], ativo: false },
    ]);
  });

  it("com apenasAtivos filtra active=true no banco", async () => {
    const { supabase, filtros } = mockComFiltros([
      { id: "a", name: "Dra. Ana", specialties: ["clínico"], active: true },
    ]);
    const r = await listaProfissionais(supabase as never, "org-1", { apenasAtivos: true });
    expect(filtros).toContainEqual(["active", true]);
    expect(r).toEqual([
      { id: "a", nome: "Dra. Ana", especialidades: ["clínico"], ativo: true },
    ]);
    expect(r.some((p) => !p.ativo)).toBe(false);
  });
});

describe("listaAgendamentos com providerId", () => {
  it("reconhece providerId como alvo válido sem exigir contactId ou de+ate", async () => {
    const supabase = mockSupabase({
      calendar_appointments: [],
    });
    const r = await listaAgendamentos(supabase as never, "org-1", {
      providerId: "prov-1",
      contactId: null,
      leadId: null,
      ownerUserId: null,
      dia: null,
      de: null,
      ate: null,
      situacao: null,
      limite: 20,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.agendamentos).toEqual([]);
    }
  });
});

