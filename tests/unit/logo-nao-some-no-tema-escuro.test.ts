/**
 * O LOGO DE QUEM HOSPEDA TEM UMA ARTE POR TEMA — E NENHUMA MOLDURA BRANCA.
 *
 * ═══ POR QUE ESTA CERCA EXISTE ═══
 *
 * O upstream resolveu o #659 ("logo escuro some no tema escuro") com um chip
 * claro (`dark:bg-white`) por baixo do logo, partindo da premissa de que o
 * produto aceita UM logo só, sem arte para o tema escuro. Nesta dev essa
 * premissa é falsa: há UMA ARTE POR TEMA (`logoUrl` + `logoUrlDark`, migrations
 * 9001/9002, com fallback em cascata) — e sobre a arte escura, feita para
 * fundo escuro, o chip vira moldura branca de sobra.
 *
 * O chip foi removido das três superfícies em 2026-09-14. Ele voltaria em
 * silêncio no próximo merge do upstream (o diff dele não conflita com nada
 * daqui), então esta cerca vigia a ausência — o inverso da cerca original,
 * que vigiava a presença.
 *
 * ═══ O QUE ELA MEDE ═══
 *
 * 1. Nenhum `bg-white` nas três superfícies que desenham o logo do operador
 *    (barra, entrada, prévia). A régua é o token inteiro, não o contexto:
 *    qualquer moldura clara nova cai aqui, tenha o nome que tiver.
 * 2. O padrão dual-logo continua presente em cada superfície (a arte escura
 *    existe de verdade, não só a ausência do chip).
 * 3. CONTROLE herdado da cerca original: as três superfícies continuam sendo
 *    as três que desenham o logo — escopo velho sem avisar é o modo de falha
 *    que o `barra-lateral-nao-perde-o-sticky` registra.
 *
 * ═══ CONSEQUÊNCIA CONHECIDA ═══
 *
 * Tenant que subiu SÓ o logo claro e nunca cadastrou o escuro vê a arte clara
 * crua no tema escuro (o bug #659 original, para esse caso). Troca assumida
 * pelo dono em 2026-09-14; mitigar (aviso na tela de marca quando falta a
 * arte escura) é trabalho futuro, não desta cerca.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const leia = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

/** Tira comentário para que uma menção em prosa não satisfaça nem quebre a cerca. */
const semComentario = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");

const SUPERFICIES = [
  "components/shell/Sidebar.tsx",
  "app/(public)/layout.tsx",
  "components/branding/CampoDeLogo.tsx",
] as const;

describe("o logo do operador tem arte própria por tema, sem moldura branca", () => {
  it("nenhuma superfície embrulha o logo em moldura clara", () => {
    // Se o chip do upstream voltar num merge (o diff dele não conflita), é
    // aqui que ele aparece: `dark:bg-white` na barra/entrada, `bg-white`
    // condicional ao rótulo na prévia. Um token só pega os três.
    for (const arquivo of SUPERFICIES) {
      expect(
        semComentario(leia(arquivo)),
        `moldura clara de volta em ${arquivo} — o padrão aqui é uma arte por tema`,
      ).not.toMatch(/bg-white/);
    }
  });

  it("cada superfície resolve a arte escura de verdade", () => {
    // Ausência do chip sem arte escura seria o #659 de volta. Cada superfície
    // tem o seu mecanismo (hook de tema na barra, variante `dark:` no server
    // component do login, caixa por rótulo na prévia) — o que se prende aqui é
    // que o símbolo da arte escura existe em cada arquivo.
    const ARTE_ESCURA: Record<(typeof SUPERFICIES)[number], RegExp> = {
      "components/shell/Sidebar.tsx": /logoUrlDark/,
      "app/(public)/layout.tsx": /logo-da-fachada-escuro/,
      "components/branding/CampoDeLogo.tsx": /emVigorDark/,
    };
    for (const arquivo of SUPERFICIES) {
      expect(
        semComentario(leia(arquivo)),
        `${arquivo} perdeu a resolução da arte escura`,
      ).toMatch(ARTE_ESCURA[arquivo]);
    }
  });

  it("CONTROLE: as três superfícies continuam sendo as três que desenham o logo do operador", () => {
    for (const arquivo of SUPERFICIES) {
      expect(semComentario(leia(arquivo)), `${arquivo} deixou de desenhar o logo`).toMatch(/<img\b/);
    }
  });
});
