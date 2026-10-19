-- manifest: inbox, agenda e tarefas avaliam a visibilidade em CONJUNTO — as policies deixam de chamar fn_can_view_* por linha e usam helpers set-based calculados uma vez por consulta (P0 do diagnóstico de 2026-10-19)
--
-- ─── O defeito ──────────────────────────────────────────────────────────────
--
-- `conversations_select` chama `fn_can_view_conversation(organization_id,
-- assigned_to_user_id)` para CADA linha. A função é `stable security definer` e
-- resolve o papel e o `visibility_mode` da organização a cada chamada. Numa
-- inbox com 1.470 conversas, o Postgres executa a função 1.470 vezes por SELECT
-- — e o Realtime reavalia a policy a cada change. O mesmo padrão existe em
-- `calendar_appointments_select/write` e `crm_tasks_select/write`, que ainda
-- chamam `fn_role_at_least` e `fn_colegas_podem_mexer_na_agenda` por linha.
--
-- ─── O conserto ─────────────────────────────────────────────────────────────
--
-- A decisão "quais organizações este usuário vê por inteiro / só a própria fila"
-- não depende da linha: depende do usuário, do papel e do `visibility_mode` da
-- organização. Ela é calculada UMA vez por consulta, em funções `stable` que
-- devolvem `setof uuid`, e a policy pergunta `organization_id in (select ...)`.
-- O planejador trata a subconsulta como InitPlan em vez de avaliar a função por
-- linha.
--
-- A semântica é a MESMA das funções por linha (0035/0680), incluindo:
--
--   · viewer/manager/admin veem a organização inteira;
--   · agent em `all` vê tudo; em `own_and_unassigned` vê o próprio + o que não
--     tem dono; em `own` vê só o próprio;
--   · a opção `colegas_podem_mexer_na_agenda` (ausente = ligada) continua
--     mandando na agenda E nas tarefas;
--   · suporte: `support_readonly` é viewer, `support_full` é admin;
--   · escrita continua exigindo `agent`+ e `fn_is_platform_admin_full()`.
--
-- As funções antigas `fn_can_view_*` ficam no banco (outras rotas podem chamá-las
-- e removê-las exigiria uma varredura), mas deixam de ser chamadas pelas
-- policies destas três tabelas. `tests/invariants/rls-set-based-inbox.test.ts`
-- vigia a forma das policies; os invariantes de comportamento (gov-5,
-- visibilidade-na-agenda-e-nas-tarefas) continuam medindo o resultado.
--
-- Idempotente: `create or replace function` e `drop policy if exists`.

begin;

-- ─── Conjuntos de organização ───────────────────────────────────────────────
--
-- Todos derivam de `fn_user_org_ids()`/`fn_user_role_in_org()`, que já são
-- SECURITY DEFINER e já tratam a sessão de suporte. Não recebem organização por
-- argumento: a fonte é sempre `auth.uid()`, nunca o corpo da requisição.

-- Organizações que este usuário lê POR INTEIRO em `conversations`.
create or replace function public.fn_orgs_visao_total()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select org.organization_id
  from public.fn_user_org_ids() as org(organization_id)
  where public.fn_user_role_in_org(org.organization_id) in ('viewer', 'manager', 'admin')
     or (
       public.fn_user_role_in_org(org.organization_id) = 'agent'
       and coalesce(
         (select o.settings->>'visibility_mode'
            from public.organizations o
           where o.id = org.organization_id),
         'own_and_unassigned'
       ) = 'all'
     );
$fn$;

comment on function public.fn_orgs_visao_total() is
  'Organizações em que o usuário da sessão lê TODAS as conversas: viewer/manager/admin, agent em visibility_mode=all, e a organização sob suporte. Substitui fn_can_view_conversation no ramo que não depende da linha.';

-- Organizações em que o agent vê também as conversas SEM DONO.
create or replace function public.fn_orgs_visao_propria_nao_atribuida()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select org.organization_id
  from public.fn_user_org_ids() as org(organization_id)
  where public.fn_user_role_in_org(org.organization_id) = 'agent'
    and coalesce(
      (select o.settings->>'visibility_mode'
         from public.organizations o
        where o.id = org.organization_id),
      'own_and_unassigned'
    ) = 'own_and_unassigned';
$fn$;

comment on function public.fn_orgs_visao_propria_nao_atribuida() is
  'Organizações em que o agent vê o próprio + o que não tem dono (visibility_mode=own_and_unassigned). Usada também pela agenda e pelas tarefas, que compartilham o mesmo eixo.';

-- Organizações que este usuário lê POR INTEIRO na agenda e nas tarefas.
-- Difere de fn_orgs_visao_total por UMA opção: `colegas_podem_mexer_na_agenda`
-- (ausente = ligada) abre a agenda/tarefas da equipe para o agent.
create or replace function public.fn_orgs_agenda_total()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select org.organization_id
  from public.fn_user_org_ids() as org(organization_id)
  where public.fn_user_role_in_org(org.organization_id) in ('viewer', 'manager', 'admin')
     or (
       public.fn_user_role_in_org(org.organization_id) = 'agent'
       and (
         coalesce(
           (select o.settings->>'visibility_mode'
              from public.organizations o
             where o.id = org.organization_id),
           'own_and_unassigned'
         ) = 'all'
         or public.fn_colegas_podem_mexer_na_agenda(org.organization_id)
       )
     );
$fn$;

comment on function public.fn_orgs_agenda_total() is
  'Organizações em que o usuário da sessão lê TODA a agenda e TODAS as tarefas: viewer/manager/admin, agent em visibility_mode=all ou com a opção colegas_podem_mexer_na_agenda ligada/ausente, e a organização sob suporte.';

-- Organizações em que o usuário tem pelo menos o papel pedido. `fn_role_at_least`
-- já responde suporte (readonly=viewer, full=admin); a diferença é que aqui a
-- pergunta é feita UMA vez por organização, não uma vez por linha.
create or replace function public.fn_orgs_com_papel(p_min text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select org.organization_id
  from public.fn_user_org_ids() as org(organization_id)
  where public.fn_role_at_least(org.organization_id, p_min);
$fn$;

comment on function public.fn_orgs_com_papel(text) is
  'Organizações em que o usuário da sessão tem pelo menos p_min. Substitui fn_role_at_least(organization_id, ...) nas policies de escrita, sem avaliar a função por linha.';

revoke all on function public.fn_orgs_visao_total() from public, anon;
revoke all on function public.fn_orgs_visao_propria_nao_atribuida() from public, anon;
revoke all on function public.fn_orgs_agenda_total() from public, anon;
revoke all on function public.fn_orgs_com_papel(text) from public, anon;

grant execute on function public.fn_orgs_visao_total() to authenticated, service_role;
grant execute on function public.fn_orgs_visao_propria_nao_atribuida() to authenticated, service_role;
grant execute on function public.fn_orgs_agenda_total() to authenticated, service_role;
grant execute on function public.fn_orgs_com_papel(text) to authenticated, service_role;

-- ─── conversations ──────────────────────────────────────────────────────────
--
-- Leitura: total do usuário + o próprio + o que não tem dono no modo
-- own_and_unassigned. O ramo do dono exige pertencimento para um não-membro não
-- entrar por `assigned_to_user_id = auth.uid()`.

drop policy if exists "conversations_select" on public.conversations;
create policy "conversations_select" on public.conversations
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (select public.fn_orgs_visao_total())
    or (
      organization_id in (select public.fn_user_org_ids())
      and assigned_to_user_id = auth.uid()
    )
    or (
      assigned_to_user_id is null
      and organization_id in (select public.fn_orgs_visao_propria_nao_atribuida())
    )
  );

-- Escrita: o mesmo piso `agent`+ de antes, agora em conjunto. `fn_orgs_com_papel`
-- já inclui suporte full (admin) e exclui support_readonly (viewer), como
-- `fn_role_at_least` fazia.

drop policy if exists "conversations_agent_write" on public.conversations;
drop policy if exists "conversations_agent_insert" on public.conversations;
drop policy if exists "conversations_agent_update" on public.conversations;
drop policy if exists "conversations_agent_delete" on public.conversations;

create policy "conversations_agent_insert" on public.conversations
  for insert with check (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_orgs_com_papel('agent'))
  );

create policy "conversations_agent_update" on public.conversations
  for update using (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_orgs_com_papel('agent'))
  ) with check (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_orgs_com_papel('agent'))
  );

create policy "conversations_agent_delete" on public.conversations
  for delete using (
    (select public.fn_is_platform_admin_full())
    or organization_id in (select public.fn_orgs_com_papel('agent'))
  );

-- ─── calendar_appointments ──────────────────────────────────────────────────
--
-- Leitura: total (inclui colegas/all) + o próprio + o que não tem dono no modo
-- own_and_unassigned. `fn_orgs_agenda_total` já carrega a opção da #978.

drop policy if exists calendar_appointments_select on public.calendar_appointments;
create policy calendar_appointments_select on public.calendar_appointments
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (select public.fn_orgs_agenda_total())
    or (
      organization_id in (select public.fn_user_org_ids())
      and owner_user_id = auth.uid()
    )
    or (
      owner_user_id is null
      and organization_id in (select public.fn_orgs_visao_propria_nao_atribuida())
    )
  );

-- Escrita: `agent`+ e (total da agenda OU o próprio OU sem dono no modo
-- own_and_unassigned). O ramo `manager+` da versão por linha é subsumido por
-- `fn_orgs_agenda_total`, que inclui viewer/manager/admin — e o piso `agent`
-- continua barrando o viewer.

drop policy if exists calendar_appointments_write on public.calendar_appointments;
create policy calendar_appointments_write on public.calendar_appointments
  using (
    (select public.fn_is_platform_admin_full())
    or (
      organization_id in (select public.fn_orgs_com_papel('agent'))
      and (
        organization_id in (select public.fn_orgs_agenda_total())
        or (
          organization_id in (select public.fn_user_org_ids())
          and owner_user_id = auth.uid()
        )
        or (
          owner_user_id is null
          and organization_id in (select public.fn_orgs_visao_propria_nao_atribuida())
        )
      )
    )
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or (
      organization_id in (select public.fn_orgs_com_papel('agent'))
      and (
        organization_id in (select public.fn_orgs_agenda_total())
        or (
          organization_id in (select public.fn_user_org_ids())
          and owner_user_id = auth.uid()
        )
        or (
          owner_user_id is null
          and organization_id in (select public.fn_orgs_visao_propria_nao_atribuida())
        )
      )
    )
  );

-- ─── crm_tasks ──────────────────────────────────────────────────────────────
--
-- Leitura: total (inclui colegas/all) + atribuído a mim + criado por mim + sem
-- responsável no modo own_and_unassigned. O `created_by` é o mesmo braço da
-- versão por linha e é o que impede a tarefa recém-criada de sumir da tela de
-- quem a criou.

drop policy if exists crm_tasks_select on public.crm_tasks;
create policy crm_tasks_select on public.crm_tasks
  for select using (
    (select public.fn_is_platform_admin())
    or organization_id in (select public.fn_orgs_agenda_total())
    or (
      organization_id in (select public.fn_user_org_ids())
      and (assigned_to = auth.uid() or created_by = auth.uid())
    )
    or (
      assigned_to is null
      and organization_id in (select public.fn_orgs_visao_propria_nao_atribuida())
    )
  );

drop policy if exists crm_tasks_write on public.crm_tasks;
create policy crm_tasks_write on public.crm_tasks
  using (
    (select public.fn_is_platform_admin_full())
    or (
      organization_id in (select public.fn_orgs_com_papel('agent'))
      and (
        organization_id in (select public.fn_orgs_agenda_total())
        or (
          organization_id in (select public.fn_user_org_ids())
          and (assigned_to = auth.uid() or created_by = auth.uid())
        )
        or (
          assigned_to is null
          and organization_id in (select public.fn_orgs_visao_propria_nao_atribuida())
        )
      )
    )
  )
  with check (
    (select public.fn_is_platform_admin_full())
    or (
      organization_id in (select public.fn_orgs_com_papel('agent'))
      and (
        organization_id in (select public.fn_orgs_agenda_total())
        or (
          organization_id in (select public.fn_user_org_ids())
          and (assigned_to = auth.uid() or created_by = auth.uid())
        )
        or (
          assigned_to is null
          and organization_id in (select public.fn_orgs_visao_propria_nao_atribuida())
        )
      )
    )
  );

notify pgrst, 'reload schema';

commit;
