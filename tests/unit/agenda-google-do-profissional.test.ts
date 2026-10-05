/**
 * GOOGLE POR PROFISSIONAL EXTERNO (migration 9013) — sub-flag por tenant e
 * ocupação via vínculo.
 *
 * Três guardas, e as três são o tipo de bug silencioso que este repo mede:
 *
 * 1. `providers_google_enabled` é OPT-IN e OFF por default — e só vale COM
 *    `providers_enabled`. Default errado = leitura do Google vazando para
 *    tenants que nunca ligaram o módulo.
 *
 * 2. Sem vínculo (`calendar_connection_calendars.provider_id`), a coleta volta
 *    vazia sem chamar RPC nenhum — exatamente o comportamento de antes da 9013.
 *    É o que mantém o teste-irmão
 *    (`agenda-profissionais-externos.test.ts`, "NÃO consulta o Google") verde
 *    sem ser tocado.
 *
 * 3. Com vínculo + sub-flag ON, o evento do Google ocupa o horário: a IA e a
 *    tela deixam de oferecer o slot que o dentista já tem tomado lá fora.
 */
import { describe, expect, it } from "vitest";

import { googleDeProfissionaisHabilitado } from "@/lib/agenda/providers";
import { horariosLivresDaOrg } from "@/lib/agenda/consulta";
import { partesNoFuso } from "@/lib/agenda/fuso";

// ── sub-flag ─────────────────────────────────────────────────────────
describe("googleDeProfissionaisHabilitado", () => {
  it("default OFF quando settings não existe", () => {
    expect(googleDeProfissionaisHabilitado(null)).toBe(false);
    expect(googleDeProfissionaisHabilitado(undefined)).toBe(false);
    expect(googleDeProfissionaisHabilitado({})).toBe(false);
  });

  it("só ON com as DUAS flags exatamente true", () => {
    const on = { scheduling: { providers_enabled: true, providers_google_enabled: true } };
    expect(googleDeProfissionaisHabilitado(on)).toBe(true);
    expect(
      googleDeProfissionaisHabilitado({ scheduling: { providers_enabled: true } }),
    ).toBe(false);
    expect(
      googleDeProfissionaisHabilitado({
        scheduling: { providers_enabled: false, providers_google_enabled: true },
      }),
    ).toBe(false);
    expect(
      googleDeProfissionaisHabilitado({
        scheduling: { providers_enabled: true, providers_google_enabled: "true" },
      }),
    ).toBe(false);
  });
});

// ── coleta com vínculo ────────────────────────────────────────────────
//
// Mock que segue o molde do teste-irmão: `.from(tabela)` devolve cadeia que
// retorna o configurado, `await` de cadeia sem `then` resolve nela mesma (uso
// para listas vazias), e `rpc` grava as chamadas.
function mockSupabase(config: Record<string, unknown>, googleRows: unknown[] = []) {
  const rpcChamadas: string[] = [];
  const tabelasConsultadas: string[] = [];
  return {
    _rpcChamadas: rpcChamadas,
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
        Array.isArray(resultados)
          ? { data: resultados[0] ?? null, error: null }
          : { data: resultados ?? null, error: null };
      return eu;
    },
    rpc: async (nome: string) => {
      rpcChamadas.push(nome);
      return { data: googleRows, error: null };
    },
  };
}

const TIPO = {
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
};

const JORNADA_SEG_9_AS_10 = {
  schedule: {
    timezone: "America/Sao_Paulo",
    windows: [{ dow: 1, start: "09:00", end: "10:00" }],
  },
  active: true,
};

function horasEmSP(slots: { inicio: Date }[]): string[] {
  return slots.map((s) => {
    const p = partesNoFuso(s.inicio, "America/Sao_Paulo");
    return `${String(p.hora).padStart(2, "0")}:${String(p.minuto).padStart(2, "0")}`;
  });
}

describe("horariosLivresDaOrg com vínculo Google do profissional", () => {
  const de = new Date("2026-03-09T00:00:00Z"); // segunda (dow 1)
  const ate = new Date("2026-03-10T00:00:00Z");

  it("sem vínculo: não chama RPC e oferece os dois slots (comportamento da 9003)", async () => {
    const supabase = mockSupabase({
      calendar_event_types: TIPO,
      providers: JORNADA_SEG_9_AS_10,
      organizations: { settings: { scheduling: { providers_enabled: true } } },
    });
    const r = await horariosLivresDaOrg(supabase as never, "org-1", {
      eventTypeSlug: "consulta",
      ownerProviderId: "prov-1",
      de,
      ate,
      agora: de,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(horasEmSP(r.slots)).toEqual(["09:00", "09:30"]);
    }
    expect(
      (supabase as unknown as { _rpcChamadas: string[] })._rpcChamadas,
    ).toEqual([]);
  });

  it("com vínculo + sub-flag ON: o evento do Google ocupa o slot das 09:00", async () => {
    const supabase = mockSupabase(
      {
        calendar_event_types: TIPO,
        providers: JORNADA_SEG_9_AS_10,
        calendar_connection_calendars: { connection_id: "conn-1" },
        organizations: {
          settings: { scheduling: { providers_enabled: true, providers_google_enabled: true } },
        },
      },
      [
        {
          starts_at: "2026-03-09T12:00:00Z", // 09:00 em SP
          ends_at: "2026-03-09T12:30:00Z",
          transparency: "opaque",
          status: "confirmed",
          connection_status: "healthy",
        },
      ],
    );
    const r = await horariosLivresDaOrg(supabase as never, "org-1", {
      eventTypeSlug: "consulta",
      ownerProviderId: "prov-1",
      de,
      ate,
      agora: de,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 09:00 cruza o evento externo; 09:30 encosta no fim (não ocupa).
      expect(horasEmSP(r.slots)).toEqual(["09:30"]);
    }
    expect(
      (supabase as unknown as { _rpcChamadas: string[] })._rpcChamadas,
    ).toContain("fn_agenda_ocupacao_google_do_profissional");
  });

  it("com vínculo + sub-flag OFF: ignora o Google (desligar pausa, não apaga)", async () => {
    const supabase = mockSupabase(
      {
        calendar_event_types: TIPO,
        providers: JORNADA_SEG_9_AS_10,
        calendar_connection_calendars: { connection_id: "conn-1" },
        organizations: {
          settings: { scheduling: { providers_enabled: true, providers_google_enabled: false } },
        },
      },
      [
        {
          starts_at: "2026-03-09T12:00:00Z",
          ends_at: "2026-03-09T12:30:00Z",
          transparency: "opaque",
          status: "confirmed",
          connection_status: "healthy",
        },
      ],
    );
    const r = await horariosLivresDaOrg(supabase as never, "org-1", {
      eventTypeSlug: "consulta",
      ownerProviderId: "prov-1",
      de,
      ate,
      agora: de,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(horasEmSP(r.slots)).toEqual(["09:00", "09:30"]);
    }
    expect(
      (supabase as unknown as { _rpcChamadas: string[] })._rpcChamadas,
    ).toEqual([]);
  });
});
