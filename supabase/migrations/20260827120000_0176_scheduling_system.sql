-- ============================================================================
-- 0176 — SISTEMA DE AGENDAMENTO (consultas dentárias / clínicas / serviços).
--
-- Triageira de três tabelas: providers (profissionais), provider_schedules
-- (janelas de disponibilidade por dia da semana) e appointments (consultas
-- agendadas). O agente de IA usa 7 tools MCP para consultar disponibilidade,
-- criar, reagendar, cancelar e confirmar compromissos. Um cron diário envia
-- lembrete por WhatsApp no D-day.
--
-- ─── Por que registros externos e não users ────────────────────────────────
--
-- O sistema é multi-nicho: uma clínica odontológica tem dentistas, uma
-- imobiliária tem corretores, uma consultoria tem consultores. Profissionais
-- são registros de domínio, não necessarily users do sistema. Um dentista
-- pode nem ter login — ele só precisa de uma agenda configurável.
--
-- ─── Por que provider_schedules é por DOW e não por data ───────────────────
--
-- Disponibilidade recorrente: "terça 9h-12h" é a norma. Agendar por data
-- específica seria_work_break repetitivo. Exceções (feriados) são tratadas
-- desativando o slot ou criando appointment conflitante (a tool detecta).
--
-- ─── Timezone ──────────────────────────────────────────────────────────────
--
-- `provider_schedules` usa `time` (hora local do provider). `appointments`
-- usa `timestamptz` (absoluto). A conversão acontece em
-- `lib/scheduling/availability.ts` usando `organizations.timezone`.
-- ============================================================================

-- ─── providers ─────────────────────────────────────────────────────────────

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  specialties text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_providers_org
  on public.providers (organization_id);

create index if not exists idx_providers_specialties
  on public.providers using gin (specialties);

comment on table public.providers is
  'Profissionais (dentistas, corretores, consultores) da organização. '
  'Registros de domínio — não necessariamente users do sistema.';
comment on column public.providers.specialties is
  'Especialidades do profissional (ex: ortodontia, implantodontia). '
  'Vocabulário aberto, sem CHECK — cada nicho tem o seu.';

alter table public.providers enable row level security;

drop policy if exists "tenant_isolation_providers_all" on public.providers;
create policy "tenant_isolation_providers_all" on public.providers
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  ) with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  );

drop trigger if exists trg_providers_updated_at on public.providers;
create trigger trg_providers_updated_at
  before update on public.providers
  for each row execute function public.fn_set_updated_at();

-- ─── provider_schedules ────────────────────────────────────────────────────

create table if not exists public.provider_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  day_of_week smallint not null
    check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_duration_minutes smallint not null default 30
    check (slot_duration_minutes between 10 and 480),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time)
);

create index if not exists idx_provider_schedules_org_provider
  on public.provider_schedules (organization_id, provider_id);

comment on table public.provider_schedules is
  'Janelas de disponibilidade recorrente por profissional e dia da semana. '
  'O agente gera slots a partir destas janelas e subtrai consultas existentes.';
comment on column public.provider_schedules.day_of_week is
  'Dia da semana (0=domingo, 6=sábado). Padrão PostgreSQL.';
comment on column public.provider_schedules.slot_duration_minutes is
  'Duração de cada slot de atendimento (10-480 min). Default 30.';

alter table public.provider_schedules enable row level security;

drop policy if exists "tenant_isolation_provider_schedules_all" on public.provider_schedules;
create policy "tenant_isolation_provider_schedules_all" on public.provider_schedules
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  ) with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  );

drop trigger if exists trg_provider_schedules_updated_at on public.provider_schedules;
create trigger trg_provider_schedules_updated_at
  before update on public.provider_schedules
  for each row execute function public.fn_set_updated_at();

-- ─── appointments ──────────────────────────────────────────────────────────

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  reason text,
  notes text,
  reminder_sent boolean not null default false,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time)
);

create index if not exists idx_appointments_org_provider_time
  on public.appointments (organization_id, provider_id, start_time);

create index if not exists idx_appointments_org_contact
  on public.appointments (organization_id, contact_id);

create index if not exists idx_appointments_reminder
  on public.appointments (organization_id, start_time)
  where status = 'scheduled' and reminder_sent = false;

comment on table public.appointments is
  'Consultas/agendamentos de profissionais com contatos. '
  'O agente IA cria, reagenda, cancela e confirma via tools MCP.';
comment on column public.appointments.status is
  'scheduled=pendente de confirmação, confirmed=paciente confirmou, '
  'completed=atendido, cancelled=cancelado, no_show=faltou.';
comment on column public.appointments.reminder_sent is
  'true quando o cron D-day enviou o lembrete via WhatsApp. '
  'Previne envio em dobro.';
comment on column public.appointments.confirmed_at is
  'Momento em que o paciente confirmou presença (via WhatsApp ou manual).';

alter table public.appointments enable row level security;

drop policy if exists "tenant_isolation_appointments_all" on public.appointments;
create policy "tenant_isolation_appointments_all" on public.appointments
  for all using (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  ) with check (
    public.fn_is_platform_admin()
    or (organization_id in (select public.fn_user_org_ids()))
  );

drop trigger if exists trg_appointments_updated_at on public.appointments;
create trigger trg_appointments_updated_at
  before update on public.appointments
  for each row execute function public.fn_set_updated_at();

notify pgrst, 'reload schema';

