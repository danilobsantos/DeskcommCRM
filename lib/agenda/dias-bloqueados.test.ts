/**
 * O MAPA DE DIAS FECHADOS — o que a grade desenha como selo "Fechado".
 *
 * A exceção é POR DONO e tem DOIS sentidos (`is_unavailable`) e DUAS formas
 * (dia inteiro `0..1440` ou faixa). O mapa só leva dia inteiro FECHADO do dono
 * pedido — o resto já aparece nos slots (a faixa some, o dia aberto nasce), e
 * marcá-lo de novo seria redundância competindo com a verdade. O que cada
 * caso prende:
 *
 * 1. Sem dono conhecido, vazio — selo sem dono seria mentira com selo.
 * 2. Dono profissional: só as linhas dele, inteiras e fechadas; a do colega,
 *    a de usuário e a parcial ficam de fora.
 * 3. Dono usuário: só as linhas dele; as de profissional ficam de fora.
 * 4. Motivos: distintos, sem vazio — vão ao `title`, nunca ao layout.
 */
import { describe, expect, it } from "vitest";

import { mapaDeDiasBloqueados, type ExcecaoDaAgenda } from "./dias-bloqueados";

const INTEIRO_FECHADO: Pick<ExcecaoDaAgenda, "is_unavailable" | "start_minute" | "end_minute"> = {
  is_unavailable: true,
  start_minute: 0,
  end_minute: 1440,
};

function linha(
  sobre: Partial<ExcecaoDaAgenda> & { exception_date: string },
): ExcecaoDaAgenda {
  return {
    user_id: null,
    provider_id: null,
    is_unavailable: true,
    start_minute: 0,
    end_minute: 1440,
    reason: null,
    ...sobre,
  };
}

describe("mapaDeDiasBloqueados", () => {
  it("sem dono, vazio", () => {
    expect(
      mapaDeDiasBloqueados([linha({ exception_date: "2026-10-05", ...INTEIRO_FECHADO })], null),
    ).toEqual({});
    expect(
      mapaDeDiasBloqueados(
        [linha({ exception_date: "2026-10-05", ...INTEIRO_FECHADO })],
        {},
      ),
    ).toEqual({});
  });

  it("profissional: só o dia inteiro fechado dele", () => {
    const r = mapaDeDiasBloqueados(
      [
        linha({ exception_date: "2026-10-05", provider_id: "prov-ana", reason: "feriado" }),
        // Parcial não marca — os slots já refletem.
        linha({
          exception_date: "2026-10-06",
          provider_id: "prov-ana",
          start_minute: 480,
          end_minute: 720,
        }),
        // Dia ABERTO não marca.
        linha({ exception_date: "2026-10-07", provider_id: "prov-ana", is_unavailable: false }),
        // Do colega não marca.
        linha({ exception_date: "2026-10-08", provider_id: "prov-bia" }),
        // De usuário não marca para profissional.
        linha({ exception_date: "2026-10-09", user_id: "user-1" }),
      ],
      { provider_id: "prov-ana" },
    );
    expect(Object.keys(r)).toEqual(["2026-10-05"]);
    expect(r["2026-10-05"]).toEqual({ diaTodo: true, motivos: ["feriado"] });
  });

  it("usuário: só as linhas dele, sem as de profissional", () => {
    const r = mapaDeDiasBloqueados(
      [
        linha({ exception_date: "2026-10-05", user_id: "user-1", reason: "viagem" }),
        linha({ exception_date: "2026-10-05", user_id: "user-2" }),
        linha({ exception_date: "2026-10-06", provider_id: "prov-ana" }),
      ],
      { owner_user_id: "user-1" },
    );
    expect(Object.keys(r)).toEqual(["2026-10-05"]);
    expect(r["2026-10-05"]).toEqual({ diaTodo: true, motivos: ["viagem"] });
  });

  it("motivos distintos, sem vazio nem repetido", () => {
    const r = mapaDeDiasBloqueados(
      [
        linha({ exception_date: "2026-10-05", provider_id: "p", reason: "feriado" }),
        linha({ exception_date: "2026-10-05", provider_id: "p", reason: "feriado" }),
        linha({ exception_date: "2026-10-05", provider_id: "p", reason: "  " }),
        linha({ exception_date: "2026-10-05", provider_id: "p", reason: null }),
        linha({ exception_date: "2026-10-05", provider_id: "p", reason: "congresso" }),
      ],
      { provider_id: "p" },
    );
    expect(r["2026-10-05"]?.motivos).toEqual(["feriado", "congresso"]);
  });
});
