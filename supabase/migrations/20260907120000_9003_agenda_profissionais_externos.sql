-- ============================================================================
-- 9003 — AGENDA: PROFISSIONAIS EXTERNOS (o dentista sem login).
--
-- A agenda do base (0177) marca compromisso de QUEM TEM CONTA no sistema: o
-- dono é `calendar_appointments.owner_user_id`, um `auth.users`. Numa clínica,
-- o dentista muitas vezes não loga no produto — quem gerencia a agenda dele é
-- a secretária (o atendente). Este apêndice adiciona o dono EXTERNO: um
-- `providers` (profissional) existe como registro de domínio, com jornada
-- própria, e um compromisso passa a poder pertencer OU a um atendente OU a um
-- profissional — nunca aos dois.
--
-- ─── Por que `providers` e não reusar `attendant_availability` ──────────────
-- `attendant_availability` tem `user_id not null references auth.users` e
-- `unique (organization_id, user_id)`: é a jornada DE UM USUÁRIO. Um
-- profissional sem conta não tem `user_id` para preencher — inflar aquela
-- tabela com "usuários fantasma" forçaria a criar `auth.users` sem login, que
-- é a classe de gambiarra que o base mediu para rejeitar (ver 0177 § Por que
-- NÃO reusar cron_jobs).
--
-- ─── Por que `schedule` é jsonb e não tabela filha ──────────────────────────
-- A jornada semanal já tem MOLDE no produto: `availabilityScheduleSchema`
-- (`lib/schemas/routing.ts`) com `{timezone, windows[{dow,start,end}]}`, o
-- MESMO de `attendant_availability.schedule`. O motor de slots
-- (`lib/agenda/horarios-livres.ts`) já consome este molde. Duplicar janela em
-- tabela própria criaria DOIS formatos para a mesma pergunta — anti-pattern nº
-- 6 do CLAUDE.md.
--
-- ─── RLS ────────────────────────────────────────────────────────────────────
-- O molde é o de `calendar_event_types` (0177): leitura para a organização,
-- escrita a partir de `manager` — profissional é CONFIGURAÇÃO do negócio, e
-- quem define é quem responde por ele (não o `agent` que só opera o dia).
-- `revoke all from anon`: a anon key vai ao browser e não deve alcançar esta
-- tabela pelo PostgREST.
--
-- ─── Aditiva, idempotente, sem dado a curar ─────────────────────────────────
-- Novas colunas são NULLABLE e nenhuma linha existente viola as constraints:
-- `calendar_appointments` existentes têm `owner_user_id` e `provider_id` NULL
-- (satisfazem o "no máximo um"); `calendar_availability_exceptions` existentes
-- têm `user_id` e `provider_id` NULL (idem). Relaxar `user_id` para NULLABLE só
-- ABAIXA uma restrição — nunca quebra um dado que já passava.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1 · o profissional externo
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  -- Vocabulário aberto, multi-nicho (ortodontia, implantodontia, corretores…).
  specialties text[] not null default '{}',
  active boolean not null default true,
  -- Mesmo molde de attendant_availability.schedule ({timezone, windows[]}).
  schedule jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_providers_org on public.providers (organization_id);
create index if not exists idx_providers_specialties on public.providers using gin (specialties);

comment on table public.providers is
  'Profissional EXTERNO (dentista, corretor, consultor) sem conta no sistema. A jornada dele mora em `schedule` (mesmo molde de attendant_availability.schedule); quem gerencia é o atendente. Um compromisso de `calendar_appointments` pertence ou a um profissional (provider_id) ou a um usuário (owner_user_id), nunca aos dois.';
comment on column public.providers.specialties is
  'Especialidades do profissional. Vocabulário aberto, sem CHECK — cada nicho tem o seu.';
comment on column public.providers.schedule is
  'Jornada semanal tz-aware, no molde de `availabilityScheduleSchema` ({timezone, windows[{dow,start,end}]}). Vazio (default `{}`) = nada publicado ⇒ zero horário, igual a attendant_availability para a agenda.';

-- ─── RLS: ler é da org; escrever é de manager+ ────────────────────────────
alter table public.providers enable row level security;

drop policy if exists providers_select on public.providers;
create policy providers_select on public.providers
  for select using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  );

drop policy if exists providers_write on public.providers;
create policy providers_write on public.providers
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

revoke all on public.providers from anon;

-- ────────────────────────────────────────────────────────────────────────────
-- 2 · o dono externo no compromisso
-- ────────────────────────────────────────────────────────────────────────────
alter table public.calendar_appointments
  add column if not exists provider_id uuid references public.providers(id) on delete set null;

-- "No máximo UM dono": atendente OU profissional. `owner_user_id is null or
-- provider_id is null` é satisfeito por toda linha existente (provider_id NULL)
-- e também pela linha órfã de um usuário apagado (owner_user_id NULL) — por
-- isso é a forma segura, e não o XOR estrito.
alter table public.calendar_appointments
  drop constraint if exists calendar_appointments_dono_unico;
alter table public.calendar_appointments
  add constraint calendar_appointments_dono_unico
  check (owner_user_id is null or provider_id is null);

comment on column public.calendar_appointments.provider_id is
  'O PROFISSIONAL EXTERNO dono deste compromisso, quando não há usuário. Mutuamente exclusivo com owner_user_id (constraint calendar_appointments_dono_unico).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3 · a exceção de data do profissional
-- ────────────────────────────────────────────────────────────────────────────
-- "No dia 12 o dentista não atende" precisa mirar um profissional, não um
-- usuário. `user_id` vira NULLABLE e entra `provider_id`, com o mesmo "no
-- máximo um" — sem tabela irmã para a mesma pergunta (anti-pattern nº 6).
alter table public.calendar_availability_exceptions
  alter column user_id drop not null;

alter table public.calendar_availability_exceptions
  add column if not exists provider_id uuid references public.providers(id) on delete cascade;

alter table public.calendar_availability_exceptions
  drop constraint if exists calendar_exceptions_dono_unico;
alter table public.calendar_availability_exceptions
  add constraint calendar_exceptions_dono_unico
  check (user_id is null or provider_id is null);

-- A UNIQUE por pessoa (0177) cobre o caminho do usuário; este índice cobre o do
-- profissional. Parcial: provider_id NOT NULL não colide com a outra — e NULL
-- nunca colide com NULL, então sem o parcial a restrição não valeria nada para
-- provider.
create unique index if not exists calendar_exceptions_provider_dia_faixa_key
  on public.calendar_availability_exceptions (organization_id, provider_id, exception_date, start_minute)
  where provider_id is not null;

comment on column public.calendar_availability_exceptions.provider_id is
  'O profissional a quem a exceção se aplica, quando não é um usuário. Mutuamente exclusivo com user_id.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4 · updated_at
-- ────────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_providers_updated_at on public.providers;
create trigger trg_providers_updated_at
  before update on public.providers
  for each row execute function public.fn_set_updated_at();