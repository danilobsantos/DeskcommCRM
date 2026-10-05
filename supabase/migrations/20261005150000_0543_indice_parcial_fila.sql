-- 0543 — índice parcial para a aba Fila do inbox.
--
-- manifest: A aba Fila filtra por `comando_da_conversa IN ('aguardando', 'automatico')`,
-- que é uma função calculada pelo PostgREST. O Postgres não sabe que esse predicado
-- implica `assigned_to_user_id IS NULL` e `status NOT IN ('closed', 'archived', 'resolved')`,
-- então sem predicados físicos explícitos o planner faz seq scan + sort na tabela inteira.
-- O índice parcial cobre exatamente o subconjunto que a Fila pode retornar: conversas
-- sem responsável e não-terminais, ordenadas por `awaiting_since` (a régua da Fila).
-- O handler agora adiciona esses predicados explicitamente quando `isQueue` é verdadeiro.

create index if not exists idx_conversations_org_fila
  on public.conversations (organization_id, awaiting_since asc nulls last, id asc)
  where assigned_to_user_id is null
    and status not in ('closed', 'archived', 'resolved');
