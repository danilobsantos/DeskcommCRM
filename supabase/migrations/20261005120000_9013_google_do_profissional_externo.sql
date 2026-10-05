-- manifest: Google Agenda por profissional externo: vínculo provider↔calendário da conta central + leitura de ocupação (o push segue fora: needs_google_push só cobre owner_user_id).
--
-- CONTEXTO. Profissionais externos (`providers`, 9003) não têm login e o sync
-- Google só conhecia `owner_user_id` (0260): a coleta pulava o Google para
-- provider "por desenho". Com a conta CENTRAL da clínica (1 OAuth da
-- secretária, N calendários) dá para dar a cada dentista a sua agenda sem OAuth
-- por pessoa: o vínculo mora em `calendar_connection_calendars.provider_id`.
--
-- O QUE MUDA (tudo aditivo, nada existente muda de comportamento):
-- 1. `calendar_connection_calendars.provider_id` nullable + FK `providers` com
--    `on delete set null` (excluir o profissional DISSOLVE o vínculo; a linha
--    do calendário — da conta central — sobrevive. `cascade` apagaria a agenda
--    do catálogo junto com o dentista).
-- 2. `UNIQUE (organization_id, provider_id) WHERE provider_id IS NOT NULL` —
--    um profissional = uma agenda (regra do produto). Linhas sem provider
--    (o uso por usuário, de hoje) não entram no índice parcial.
-- 3. `fn_agenda_ocupacao_google_do_profissional(p_org, p_provider, p_de, p_ate)`
--    — mesma forma e mesmas 5 colunas de `fn_agenda_ocupacao_google_do_dono`
--    (0260): lê a view `calendar_selected_external_events` (já exclui
--    `cancelled` e o que não conta para conflito), filtra pelo calendário
--    vinculado e confere o pertencimento no corpo (`fn_user_org_ids`), como a
--    0260. `security definer`, `search_path` blindado, EXECUTE revogado das duas
--    origens e concedido só a `authenticated`/`service_role`.
--
-- O QUE NÃO MUDA DE PROPÓSITO. `needs_google_push` (0225, coluna gerada) e o
-- índice parcial do push filtram `owner_user_id IS NOT NULL`: compromisso de
-- provider continua sem push. A escrita para a agenda do profissional é o
-- passo seguinte e pede cirurgia na coluna gerada + `fn_google_appointment` —
-- fora deste incremento para não tocar função quente.
--
-- IDEMPOTENTE: `add column if not exists`, `create ... if not exists`,
-- `create or replace function`, `drop ... if exists` antes de criar o índice
-- único (re-aplicar não duplica efeito).

alter table public.calendar_connection_calendars
  add column if not exists provider_id uuid references public.providers(id) on delete set null;

comment on column public.calendar_connection_calendars.provider_id is
  'O PROFISSIONAL EXTERNO dono deste calendário vinculado (migration 9013), quando a agenda não é de um usuário e sim de um dentista/corretor sem login. NULL = uso por usuário (o comportamento de antes). Com provider, a linha é o vínculo "uma agenda para cada profissional" da conta central da clínica.';

-- Um profissional = uma agenda. Parcial porque NULL não colide com NULL numa
-- UNIQUE e as linhas de usuário (a maioria) ficam fora do índice.
drop index if exists public.calendar_connection_calendars_provider_unico;
create unique index if not exists calendar_connection_calendars_provider_unico
  on public.calendar_connection_calendars (organization_id, provider_id)
  where provider_id is not null;

create or replace function public.fn_agenda_ocupacao_google_do_profissional(
  p_org uuid,
  p_provider uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  transparency text,
  status text,
  connection_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.starts_at, e.ends_at, e.transparency, e.status, c.status
    from public.calendar_selected_external_events e
    join public.calendar_connections c
      on c.organization_id = e.organization_id
     and c.id = e.connection_id
    join public.calendar_connection_calendars k
      on k.organization_id = e.organization_id
     and k.connection_id = e.connection_id
     and k.external_calendar_id = e.external_calendar_id
     and k.provider_id = p_provider
    join public.providers p
      on p.organization_id = e.organization_id
     and p.id = k.provider_id
   where (auth.uid() is null
          or p_org in (select public.fn_user_org_ids())
          or public.fn_is_platform_admin())
     and e.organization_id = p_org
     and p.organization_id = p_org
     -- Cruzamento ESTRITO, a régua de `colide`: encostar não é ocupar.
     and e.starts_at < p_ate
     and e.ends_at > p_de;
$$;

comment on function public.fn_agenda_ocupacao_google_do_profissional(uuid, uuid, timestamptz, timestamptz) is
  'Ocupação do Google da agenda vinculada a um PROFISSIONAL EXTERNO (migration 9013): mesma forma da fn_agenda_ocupacao_google_do_dono (0260), com o dono trocado pelo vínculo calendar_connection_calendars.provider_id. Sem vínculo, devolve zero linhas (igual a "sem Google"). Devolve ocupação, nunca conteúdo do evento.';

-- AS DUAS ORIGENS DE EXECUTE (CLAUDE.md, item 9): o grant direto a anon do
-- `alter default privileges` do baseline e o grant a PUBLIC da criação.
revoke execute on function public.fn_agenda_ocupacao_google_do_profissional(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.fn_agenda_ocupacao_google_do_profissional(uuid, uuid, timestamptz, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
