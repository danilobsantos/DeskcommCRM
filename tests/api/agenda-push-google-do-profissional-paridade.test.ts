import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PARIDADE 9019 — o push Google do profissional (9014) republicado com o idle
 * da 0578.
 *
 * O defeito: a 0578 reescreveu `fn_google_appointment` a partir do corpo
 * pré-9014 e apagou os 4 ramos de provider — todo compromisso de profissional
 * externo morria no claim com `google_owner_unavailable`, e o invariante
 * `agenda-google-push-do-profissional` (que roda contra o baseline) ficou
 * vermelho. Este gate trava os DOIS artefatos na forma republicada, lendo a
 * ÚLTIMA definição (é ela que o banco executa).
 */
const RAIZ = join(__dirname, "..", "..");
const MIGRACAO = "supabase/migrations/20261008010000_9019_push_google_do_profissional_republicado.sql";

function ultimaDefinicao(sql: string): string {
  const marcador = "create or replace function public.fn_google_appointment(";
  return sql.slice(sql.lastIndexOf(marcador));
}

describe("9019 republica o push do profissional nos dois artefatos", () => {
  const migracao = readFileSync(join(RAIZ, MIGRACAO), "utf8");
  const baseline = readFileSync(join(RAIZ, "supabase/baseline.sql"), "utf8");

  it.each([
    "a.provider_id is not null",
    "Ligue este profissional a uma agenda do Google",
    "google_sync_error=null",
  ])("a última definição contém %s (migration e baseline)", (trecho) => {
    expect(ultimaDefinicao(migracao), `9019 sem ${trecho}`).toContain(trecho);
    expect(ultimaDefinicao(baseline), `baseline sem ${trecho}`).toContain(trecho);
  });
});
