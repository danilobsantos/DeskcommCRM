-- ============================================================================
-- 9002 — DERRUBA O OVERLOAD LEGADO DE fn_definir_logo_da_organizacao.
--
-- O problema: a migration 0208 estendeu `fn_definir_logo_da_organizacao` de
-- `(uuid, uuid, text)` para `(uuid, uuid, text, text default null)` usando
-- `create or replace`. Em Postgres, `create or replace` só troca a implementação
-- de uma função com a MESMA assinatura — assinatura diferente cria uma SEGUNDA
-- função. O resultado é um OVERLOAD: a versão de 3 argumentos (0158) continua
-- de pé ao lado da de 4 (0208).
--
-- Por que o overload é defeito, e não detalhe: quando alguém chama a função com
-- os 3 parâmetros originais — exatamente o que faz QUALQUER código pré-0208, o
-- cenário de rollback do `agent.sh` (imagem velha sobre banco novo) — o PostgREST
-- não consegue escolher entre as duas candidatas e devolve HTTP 300 PGRST203
-- "Could not choose the best candidate function". O logo da organização para de
-- gravar (a rota responde 500 "Erro ao gravar o logo") sem tocar em schema.
--
-- Medido no PostgREST real: com os dois overloads, a chamada de 3 parâmetros
-- devolve 300 PGRST203; a chamada de 4 responde 1. Depois do `drop` desta
-- migration, a de 3 resolve para a de 4 (via `default null`) e devolve 1.
--
-- Por que é seguro derrubar a versão de 3 argumentos:
--   - o ÚNICO chamador em código (`app/api/v1/marca/logo/route.ts`) sempre passa
--     os 4 parâmetros desde a 0208, então não é afetado;
--   - código velho (pré-0208) que chame com 3 resolve para a de 4 com
--     `p_path_dark = null`, e o corpo dela remove `logo_path_dark` quando grava
--     `logo_path` — a semântica dual exata; sai de PGRST203 para funcionar;
--   - o `baseline.sql` já cria SÓ a versão de 4, então esta migration é no-op em
--     quem instala do zero (é a razão de ser do `if exists`).
--
-- Aditiva e idempotente: não toca em dado, não cria constraint.
-- ============================================================================

drop function if exists public.fn_definir_logo_da_organizacao(uuid, uuid, text);

comment on function public.fn_definir_logo_da_organizacao(uuid, uuid, text, text) is
  'Grava (ou apaga) organizations.settings.branding.logo_path e logo_path_dark com merge no CAMPO. Assevera prefixo por organization_id. Papel insuficiente levanta 42501. Devolve linhas afetadas: 0 = a organização não existe. Chamador: app/api/v1/marca/logo/route.ts.';

notify pgrst, 'reload schema';