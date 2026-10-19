/**
 * O BUG DO PostgREST ≤14.3 `or=` + RETURNING — a varredura que impede o renascimento.
 *
 * Na produção (pin v12.2.11 do Supabase), uma MUTAÇÃO que combina filtro `or=`
 * com `select=` (RETURNING na mesma requisição) devolve 42703 "column
 * <tabela>.<coluna> does not exist" para coluna que EXISTE — derrubou "Marcar
 * resolvido" na Central e travou em silêncio o claim do export LGPD, o claim do
 * follow-up, o compare-and-set da cobrança e o retrato do orçamento. Corrigido
 * upstream só no 14.4; quem instala num Supabase self-host em v12 não pode
 * depender de upgrade.
 *
 * O conserto da casa: a visibilidade/competição fica no UPDATE como cadeias
 * disjuntas (`.is`/`.eq`/`.lt`) ou sem RETURNING, e a leitura de volta é um GET
 * separado (GET com `or` funciona em qualquer versão). Este arquivo reprova
 * qualquer `.update()`/`.delete()` cuja cadeia traga `.or()` E `.select()`
 * juntos, reconhecendo as formas certas na mesma hora.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const RAIZES = ["app", "lib", "workers", "hooks"];
const IGNORADOS = new Set(["node_modules", ".next", "graphify-out"]);

function* arquivos(dir: string): Generator<string> {
  for (const nome of readdirSync(dir)) {
    if (IGNORADOS.has(nome)) continue;
    const caminho = join(dir, nome);
    const estat = statSync(caminho);
    if (estat.isDirectory()) yield* arquivos(caminho);
    else if (/\.(ts|tsx)$/.test(nome) && !/\.(test|spec)\.(ts|tsx)$/.test(nome)) yield caminho;
  }
}

/** Os nomes de método da cadeia inteira, descendo pelos receptores da chamada. */
function cadeiaDa(chamada: ts.CallExpression): string[] {
  const nomes: string[] = [];
  let no: ts.Expression | undefined = chamada;
  while (no !== undefined && ts.isCallExpression(no)) {
    const acesso: ts.PropertyAccessExpression | null = ts.isPropertyAccessExpression(no.expression) ? no.expression : null;
    nomes.push(acesso ? acesso.name.text : "«receptor»");
    no = acesso?.expression;
  }
  return nomes;
}

function verificar(codigo: string): string[] {
  const fonte = ts.createSourceFile("dubla.ts", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const achados: string[] = [];
  const percorrer = (no: ts.Node): void => {
    if (ts.isCallExpression(no)) {
      const nomes = cadeiaDa(no);
      const muta = nomes.some((n) => n === "update" || n === "delete");
      if (muta && nomes.includes("update") && nomes.includes("or") && nomes.includes("select")) {
        achados.push(nomes.join("."));
      }
    }
    no.forEachChild(percorrer);
  };
  fonte.forEachChild(percorrer);
  return achados;
}

describe("PostgREST ≤14.3: mutação não combina or= com RETURNING", () => {
  it("tais cadeias não existem em app|lib|workers|hooks", () => {
    const achados: string[] = [];
    for (const raiz of RAIZES) {
      for (const arquivo of arquivos(join(process.cwd(), raiz))) {
        for (const problema of verificar(readFileSync(arquivo, "utf8"))) {
          achados.push(`${arquivo}: ${problema}`);
        }
      }
    }
    expect(achados).toEqual([]);
  });

  it("reconhece o combo proibido e absolve as formas do conserto", () => {
    const errado =
      'admin.from("t").update({ status: "resolved" }).eq("id", id).or("para_user_id.is.null,para_user_id.eq.eu").select("id")';
    const semRetorno = 'admin.from("t").update({ status: "resolved" }).eq("id", id).or("para_user_id.is.null,para_user_id.eq.eu")';
    const disjunta = 'admin.from("t").update({ status: "resolved" }).eq("id", id).is("para_user_id", null).select("id")';
    expect(verificar(errado)).toHaveLength(1);
    expect(verificar(semRetorno)).toEqual([]);
    expect(verificar(disjunta)).toEqual([]);
  });
});
