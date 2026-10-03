-- 9010 — DERRUBA O OVERLOAD DE 4 ARGS DE fn_definir_logo_da_organizacao.
--
-- A 9002 matou o overload de 3 args porque `create or replace` com assinatura
-- diferente CRIA uma segunda função, e chamada com 3 parâmetros virava
-- PGRST203 ("Could not choose the best candidate"). A 0406 (logo por tema)
-- recriou o mesmo defeito pelo outro lado: ela trouxe de volta a de 3 args
-- como wrapper fino para `fn_definir_logo_por_tema_da_organizacao`, e a de 4
-- args da dev (9001) continuou de pé — de novo duas candidatas para a mesma
-- chamada de 3 parâmetros, de novo PGRST203 (medido em `test:db`, 2026-09-28:
-- `function ... is not unique` em `marca-logo.test.ts` e `logo-por-tema`).
--
-- Cai a de 4, fica a de 3: ninguém chama a de 4 (a rota grava pelo wrapper de
-- tema desde o merge; os invariantes chamam a forma de 3), e a de 3 é o caminho
-- vivo. Idempotente (`if exists`); não toca em dado.
-- ============================================================================

drop function if exists public.fn_definir_logo_da_organizacao(uuid, uuid, text, text);

notify pgrst, 'reload schema';
