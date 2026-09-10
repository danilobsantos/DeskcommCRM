-- ============================================================================
-- 9006 — Reconciliação segura de unread_count_for_assignee pós-redeploy.
--
-- O baseline.sql herdou da migration 0161 uma query de backfill que recalculava
-- unread_count_for_assignee em massa baseando-se estritamente em
-- `sent_at > coalesce(c.last_outbound_at, '-infinity')`.
-- Isso causava um falso positivo grave: conversas lidas manualmente pelo
-- atendente (via rota mark-read) onde o cliente enviou a última mensagem
-- (ex: "Combinado", "Obrigado") voltavam como NÃO LIDAS a cada deploy.
--
-- Esta migration:
-- 1. Zera o contador de conversas terminadas (closed, resolved, archived).
-- 2. Zera o contador de conversas com atendimento já encerrado.
-- ============================================================================

-- Conversas já encerradas ou arquivadas nunca devem exibir badge de pendente
update public.conversations
   set unread_count_for_assignee = 0
 where status in ('closed', 'resolved', 'archived')
   and unread_count_for_assignee > 0;

-- Conversas com encerramento de atendimento carimbado também zeram unread
update public.conversations
   set unread_count_for_assignee = 0
 where service_closed_at is not null
   and unread_count_for_assignee > 0;

notify pgrst, 'reload schema';
