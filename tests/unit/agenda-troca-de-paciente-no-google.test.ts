import { describe, expect, it } from "vitest";

import {
  compare,
  comConviteDaFicha,
  delta,
  trocaDePaciente,
  type Base,
  type Projection,
} from "@/lib/agenda/google/sync-model";

/**
 * TROCA DE PACIENTE NO GOOGLE (9015) — o executor republica os convidados
 * quando o paciente troca, e remove o antigo da lista.
 *
 * Sem isto a troca convergia em silêncio (`compare` não enxerga e-mail de
 * ficha, que mora em `contacts`) e o ex-paciente seguia recebendo cada
 * atualização do horário de outra pessoa.
 */

const projecaoDe = (guest: string): Projection => ({
  shared: {
    starts_at: "2026-10-06T12:00:00Z",
    ends_at: "2026-10-06T12:30:00Z",
    time_zone: "America/Sao_Paulo",
    cancelled: false,
  },
  outbound: { title: "t", description: "d", location: "l", guest },
});

const baseDe = (guest: string): Base => ({
  shared: projecaoDe(guest).shared,
  local: { ...projecaoDe(guest).outbound },
  remote: { ...projecaoDe(guest).outbound },
});

const eventoCom = (emails: string[]) => ({
  summary: "Consulta",
  start: { dateTime: "2026-10-06T12:00:00Z", timeZone: "America/Sao_Paulo" },
  end: { dateTime: "2026-10-06T12:30:00Z", timeZone: "America/Sao_Paulo" },
  attendees: emails.map((email) => ({ email })),
});

const agendamentoBase = {
  id: "00000000-0000-4000-8000-0000000000ee",
  organization_id: "00000000-0000-4000-8000-000000000001",
  title: "Consulta",
  description: null,
  starts_at: "2026-10-06T12:00:00Z",
  ends_at: "2026-10-06T12:30:00Z",
  time_zone: "America/Sao_Paulo",
  status: "confirmed",
  location_kind: "in_person",
  location_details: null,
} as const;

describe("trocaDePaciente", () => {
  it("converged + troca vira publish só do grupo guest", () => {
    const base = baseDe("g");
    const decision = trocaDePaciente(compare(base, projecaoDe("g"), projecaoDe("g")), {
      trocou: true,
    });
    expect(decision).toMatchObject({ kind: "publish", groups: ["guest"] });
  });

  it("converged sem troca continua converged (compromisso antigo intocado)", () => {
    const base = baseDe("g");
    const decision = trocaDePaciente(compare(base, projecaoDe("g"), projecaoDe("g")), {
      trocou: false,
    });
    expect(decision.kind).toBe("converged");
  });

  it("publish existente não é rebaixado nem duplicado", () => {
    const base = baseDe("g");
    const jaPublicando = compare(base, projecaoDe("novo"), projecaoDe("g"));
    expect(jaPublicando.kind).toBe("publish");
    const decision = trocaDePaciente(jaPublicando, { trocou: true });
    expect(decision.kind).toBe("publish");
  });

  it("o executor consome pela mesma regra (assinatura que o guarda fixa)", () => {
    // `agenda-convite-da-ficha-nao-e-retroativo.test.ts` fixa o formato da
    // chamada no executor: a troca entra como campo da ficha, não como
    // condição própria por lá.
    const base = baseDe("g");
    const viaRegra = comConviteDaFicha(compare(base, projecaoDe("g"), projecaoDe("g")), {
      temEmail: true,
      eventoJaTemOEmail: false,
      cancelado: false,
      trocouPaciente: true,
    });
    expect(viaRegra).toMatchObject({ kind: "publish", groups: ["guest"] });
  });
});

describe("delta com removerDesconhecidos", () => {
  it("troca A→B: B entra, A sai, acompanhante e organizador ficam", () => {
    const patch = delta(
      { ...agendamentoBase, guest_email: "mae@email.com", contact_email: "b@email.com", contact_nome: "B" },
      {
        ...eventoCom(["a@email.com", "mae@email.com"]),
        attendees: [
          { email: "dono@clinica.com", organizer: true },
          { email: "a@email.com" },
          { email: "mae@email.com" },
        ],
      } as never,
      baseDe("g"),
      ["guest"],
      false,
      true,
    );
    const emails = (
      (patch.attendees ?? []) as Array<{ email: string; displayName?: string }>
    ).map((p) => p.email);
    expect(emails).toContain("dono@clinica.com");
    expect(emails).toContain("mae@email.com");
    expect(emails).toContain("b@email.com");
    expect(emails).not.toContain("a@email.com");
  });

  it("sem a flag, o comportamento incremental continua (nada é removido)", () => {
    const patch = delta(
      { ...agendamentoBase, guest_email: "mae@email.com", contact_email: "b@email.com", contact_nome: "B" },
      eventoCom(["a@email.com", "mae@email.com"]) as never,
      baseDe("g"),
      ["guest"],
      false,
      false,
    );
    const emails = ((patch.attendees ?? []) as Array<{ email: string }>).map((p) => p.email);
    expect(emails).toContain("a@email.com");
    expect(emails).toContain("b@email.com");
  });

  it("desvincular (sem e-mail novo) remove o antigo e não convida ninguém", () => {
    const patch = delta(
      { ...agendamentoBase, guest_email: null, contact_email: null, contact_nome: null },
      eventoCom(["a@email.com"]) as never,
      baseDe("g"),
      ["guest"],
      false,
      true,
    );
    expect(patch.attendees).toEqual([]);
  });
});
