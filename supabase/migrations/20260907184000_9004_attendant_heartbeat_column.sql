-- ============================================================================
-- 9004 — GARANTE A COLUNA last_heartbeat_at EM attendant_availability.
--
-- O problema: bancos criados antes da migration 0039 ou que aplicaram apenas
-- `create table if not exists public.attendant_availability` não receberam a coluna
-- `last_heartbeat_at`. Isso faz com que o cron /api/v1/cron/attendant-heartbeat
-- falhe a cada 5 minutos com:
--   "column attendant_availability.last_heartbeat_at does not exist"
--
-- Esta migration é aditiva, idempotente e segura: adiciona a coluna nullable se
-- ela ainda não existir no banco.
-- ============================================================================

alter table public.attendant_availability
  add column if not exists last_heartbeat_at timestamptz;

comment on column public.attendant_availability.last_heartbeat_at is
  'Último heartbeat emitido pelo atendente. Usado por /api/v1/cron/attendant-heartbeat (AT-08) para marcar is_available=false após 15 min sem sinal.';

notify pgrst, 'reload schema';
