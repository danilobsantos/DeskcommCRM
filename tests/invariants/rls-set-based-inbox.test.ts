import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * A VISIBILIDADE DO INBOX, DA AGENDA E DAS TAREFAS É AVALIADA EM CONJUNTO.
 *
 * ─── O defeito ──────────────────────────────────────────────────────────────
 *
 * As policies de leitura chamavam `fn_can_view_conversation(organization_id,
 * assigned_to_user_id)`, `fn_can_view_appointment(organization_id,
 * owner_user_id)` e `fn_can_view_task(organization_id, assigned_to, created_by)`
 * — todas `stable security definer` — PARA CADA LINHA. A decisão não depende da
 * linha: depende do usuário, do papel e do `visibility_mode` da organização.
 * Numa inbox com 1.470 conversas o custo é 1.470 execuções por SELECT, e o
 * Realtime reavalia a policy a cada change.
 *
 * ─── O que este arquivo vigia ───────────────────────────────────────────────
 *
 * Que a policy PERGUNTE o conjunto — `organization_id in (select fn_orgs_...)` —
 * e não chame a função por linha. Os invariantes de comportamento (gov-5,
 * visibilidade-na-agenda-e-nas-tarefas) provam o resultado; este prova a FORMA,
 * que é o que diferencia uma consulta que escala de uma que não.
 *
 * ⚠️ Sem este caso, voltar a `fn_can_view_*` por linha continuaria verde em toda
 * a suíte de comportamento — o defeito de performance só reaparece na VPS.
 */

const POLICIES = [
  ["conversations", "conversations_select"],
  ["conversations", "conversations_agent_insert"],
  ["conversations", "conversations_agent_update"],
  ["conversations", "conversations_agent_delete"],
  ["calendar_appointments", "calendar_appointments_select"],
  ["calendar_appointments", "calendar_appointments_write"],
  ["crm_tasks", "crm_tasks_select"],
  ["crm_tasks", "crm_tasks_write"],
] as const;

/** `qual` + `with_check` da policy viva, direto do catálogo — não do arquivo. */
function expressao(tabela: string, policy: string): string {
  const out = sql(`
    select coalesce(qual, '') || E'\\t' || coalesce(with_check, '')
      from pg_policies
     where schemaname = 'public'
       and tablename = '${tabela}'
       and policyname = '${policy}';
  `);
  if (out === "") throw new Error(`policy ausente no banco: ${tabela}.${policy}`);
  return out;
}

/** A assinatura por linha que esta migration aposenta nestas três tabelas. */
const POR_LINHA =
  /fn_can_view_(conversation|appointment|task)|fn_role_at_least\s*\(\s*organization_id|fn_colegas_podem_mexer_na_agenda\s*\(\s*organization_id/;

describe("RLS set-based — inbox, agenda e tarefas", () => {
  it("CONTROLE: as oito policies existem e citam um conjunto `fn_orgs_`", () => {
    for (const [tabela, policy] of POLICIES) {
      const expr = expressao(tabela, policy);
      expect(expr, `${tabela}.${policy} não usa conjunto`).toMatch(/fn_orgs_/);
    }
  });

  it("nenhuma policy chama a função de visibilidade por linha", () => {
    const acusadas = POLICIES.filter(([t, p]) => POR_LINHA.test(expressao(t, p))).map(
      ([t, p]) => `${t}.${p}`,
    );
    expect(
      acusadas,
      "policy voltou a avaliar visibilidade por linha (fn_can_view_*, " +
        "fn_role_at_least(organization_id, ...) ou fn_colegas...(organization_id)) — a decisão " +
        "depende do usuário/papel/visibility_mode, não da linha; use organization_id in " +
        "(select fn_orgs_...) para o planner resolver uma vez por consulta",
    ).toEqual([]);
  });

  it("a leitura de conversas usa o total e o próprio/sem-dono", () => {
    const expr = expressao("conversations", "conversations_select");
    expect(expr).toContain("fn_orgs_visao_total");
    expect(expr).toContain("fn_orgs_visao_propria_nao_atribuida");
  });

  it("a leitura da agenda e das tarefas usa o total da agenda (a opção #978 entra nele)", () => {
    for (const tabela of ["calendar_appointments", "crm_tasks"] as const) {
      const expr = expressao(tabela, `${tabela}_select`);
      expect(expr, `${tabela}: total da agenda`).toContain("fn_orgs_agenda_total");
      expect(expr, `${tabela}: próprio/sem dono`).toContain(
        "fn_orgs_visao_propria_nao_atribuida",
      );
    }
  });

  it("a escrita exige papel agent+ em conjunto", () => {
    for (const [tabela, policy] of POLICIES.filter(([, p]) => /write|insert|update|delete/.test(p))) {
      const expr = expressao(tabela, policy);
      expect(expr, `${tabela}.${policy}`).toContain("fn_orgs_com_papel");
      expect(expr, `${tabela}.${policy}`).toContain("fn_is_platform_admin_full");
    }
  });
});
