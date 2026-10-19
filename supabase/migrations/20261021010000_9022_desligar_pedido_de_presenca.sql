-- manifest: permite desligar por organização o pedido de confirmação de presença
-- (settings.agenda.pedir_presenca). O sweep deixa de criar o aviso
-- appointment_outcome_required e encerra os que já estavam abertos. Corrige de
-- passagem fn_agenda_minutes, que hoje descarta TODOS os prazos quando o objeto
-- agenda tem uma chave que ele não conhece.

-- 1. Leitor de prazos: chave desconhecida deixa de invalidar o objeto inteiro.
--    Sem isto, gravar pedir_presenca faria confirmation_delay_minutes e
--    unknown_protection_minutes caírem para o padrão, em silêncio.
create or replace function public.fn_agenda_minutes(p_settings jsonb,p_key text,p_default int)
returns int language plpgsql immutable set search_path=public as $$
declare cfg jsonb:=p_settings->'agenda'; delay int; horizon int;
begin
 if jsonb_typeof(cfg) is distinct from 'object'
  or jsonb_typeof(cfg->'confirmation_delay_minutes') is distinct from 'number'
  or jsonb_typeof(cfg->'unknown_protection_minutes') is distinct from 'number'
  or (cfg->>'confirmation_delay_minutes' ~ '^[0-9]{1,5}$') is not true
  or (cfg->>'unknown_protection_minutes' ~ '^[0-9]{1,5}$') is not true then return p_default; end if;
 delay:=(cfg->>'confirmation_delay_minutes')::int; horizon:=(cfg->>'unknown_protection_minutes')::int;
 if delay not between 1 and 10080 or horizon not between delay and 10080 then return p_default; end if;
 return case p_key when 'confirmation_delay_minutes' then delay when 'unknown_protection_minutes' then horizon else p_default end;
end;
$$;
revoke all on function public.fn_agenda_minutes(jsonb,text,int) from public,anon,authenticated;
grant execute on function public.fn_agenda_minutes(jsonb,text,int) to service_role;

-- 2. Escrita: aceita pedir_presenca (booleano, opcional). PATCH antigo, de aba
--    aberta antes desta versão, não manda a chave: preservar o valor gravado
--    evita religar o pedido sem ninguém pedir.
create or replace function public.fn_agenda_settings(p_org uuid, p_config jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null
     or not public.fn_role_at_least(p_org, 'manager')
     or not public.fn_support_write_allowed(p_org) then
    raise exception 'agenda_settings_forbidden' using errcode = '42501';
  end if;

  -- Portão de MFA (migration 0229). Prazos de agenda são configuração que muda
  -- o comportamento do produto para a organização inteira.
  if not public.fn_session_mfa_proven() then
    raise exception 'agenda_mfa_required' using errcode = '42501';
  end if;

  if not (p_config ? 'pedir_presenca') then
    p_config := p_config || coalesce(
      (select jsonb_build_object('pedir_presenca', settings->'agenda'->'pedir_presenca')
         from public.organizations
        where id = p_org
          and jsonb_typeof(settings->'agenda'->'pedir_presenca') = 'boolean'),
      '{}'::jsonb);
  end if;

  if jsonb_typeof(p_config->'confirmation_delay_minutes') is distinct from 'number'
     or jsonb_typeof(p_config->'unknown_protection_minutes') is distinct from 'number'
     or (p_config - 'confirmation_delay_minutes'
                  - 'unknown_protection_minutes'
                  - 'pending_expires_after_minutes'
                  - 'pedir_presenca') <> '{}'::jsonb
     or (p_config->>'confirmation_delay_minutes' ~ '^[0-9]{1,5}$') is not true
     or (p_config->>'unknown_protection_minutes' ~ '^[0-9]{1,5}$') is not true
     or (p_config->>'confirmation_delay_minutes')::int not between 1 and 10080
     or (p_config->>'unknown_protection_minutes')::int not between 1 and 10080
     or (p_config->>'unknown_protection_minutes')::int
        < (p_config->>'confirmation_delay_minutes')::int
  then
    raise exception 'agenda_settings_invalid' using errcode = '22023';
  end if;

  if p_config ? 'pending_expires_after_minutes' then
    if jsonb_typeof(p_config->'pending_expires_after_minutes') is distinct from 'number'
       or (p_config->>'pending_expires_after_minutes' ~ '^[0-9]{1,5}$') is not true
       or (p_config->>'pending_expires_after_minutes')::int not between 15 and 10080
    then
      raise exception 'agenda_settings_invalid' using errcode = '22023';
    end if;
  end if;

  if p_config ? 'pedir_presenca'
     and jsonb_typeof(p_config->'pedir_presenca') is distinct from 'boolean' then
    raise exception 'agenda_settings_invalid' using errcode = '22023';
  end if;

  update public.organizations
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{agenda}', p_config, true)
   where id = p_org;
  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;
  return p_config;
end; $$;
revoke all on function public.fn_agenda_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_agenda_settings(uuid, jsonb) to authenticated;

-- 3. Sweep: organização desligada não gera aviso, e o que já estava aberto é
--    encerrado. O encerramento mora aqui, e não na rota de configuração, para
--    valer por qualquer caminho (inclusive SQL direto) e fechar sozinho no
--    primeiro tique depois do desligamento. Predicado tolerante a lixo: só o
--    `false` explícito desliga; ausente ou estranho mantém o comportamento.
create or replace function public.fn_appointment_confirmation_sweep(p_limit int default 100,p_now timestamptz default now())
returns int language plpgsql security definer set search_path=public as $$
declare a record; candidate record; n int:=0; expired boolean;
begin
 update public.agent_inbox_items i
    set status='resolved', resolved_at=now()
   from public.organizations o
  where o.id=i.organization_id
    and i.kind='appointment_outcome_required'
    and i.status='open'
    and (o.settings->'agenda'->'pedir_presenca')='false'::jsonb;

 -- Escolhe o mesmo lote vencido e obtém mutexes em ordem, sem row lock prévio.
 for candidate in select * from (
  select c.id,c.organization_id,c.contact_id,c.ends_at
  from public.calendar_appointments c join public.organizations o on o.id=c.organization_id
  where c.status in ('pending','confirmed')
   and (o.settings->'agenda'->'pedir_presenca') is distinct from 'false'::jsonb
   and c.ends_at+make_interval(mins=>public.fn_agenda_minutes(o.settings,'confirmation_delay_minutes',10))<=p_now
   and (c.confirmation_next_at is null or c.confirmation_next_at<=p_now)
   and not exists(select 1 from public.contacts ct where ct.organization_id=c.organization_id and ct.id=c.contact_id and ct.is_anonymized)
  order by c.ends_at,c.id limit greatest(1,least(p_limit,500))
 ) due order by organization_id,contact_id,id
 loop
  if candidate.contact_id is not null and not pg_try_advisory_xact_lock(hashtextextended(candidate.organization_id::text||':'||candidate.contact_id::text,222)) then continue;end if;
  select c.*,o.settings into a from public.calendar_appointments c join public.organizations o on o.id=c.organization_id
   where c.id=candidate.id and c.organization_id=candidate.organization_id and c.contact_id is not distinct from candidate.contact_id
    and c.status in ('pending','confirmed')
    and (o.settings->'agenda'->'pedir_presenca') is distinct from 'false'::jsonb
    and c.ends_at+make_interval(mins=>public.fn_agenda_minutes(o.settings,'confirmation_delay_minutes',10))<=p_now
    and (c.confirmation_next_at is null or c.confirmation_next_at<=p_now)
    and not exists(select 1 from public.contacts ct where ct.organization_id=c.organization_id and ct.id=c.contact_id and ct.is_anonymized)
   for update of c skip locked;
  if not found then continue;end if;
  expired:=a.ends_at+make_interval(mins=>public.fn_agenda_minutes(a.settings,'unknown_protection_minutes',1440))<=p_now;
  insert into public.agent_inbox_items(organization_id,kind,severity,title,body,ref_kind,ref_id,appointment_revision)
   values(a.organization_id,'appointment_outcome_required',case when expired then 'critical' else 'warn' end,
    case when expired then 'Presença sem confirmação há mais tempo' else 'Confirme a presença no compromisso' end,
    'Compromisso: '||a.title||'. Abra e registre se a pessoa compareceu, faltou ou cancelou. O horário sozinho não confirma falta.',
    'appointment',a.id,a.revision)
   on conflict(organization_id,ref_id,appointment_revision,kind) where ref_kind='appointment' and appointment_revision is not null
   do update set status='open',resolved_at=null,severity=excluded.severity,title=excluded.title;
  update public.calendar_appointments set confirmation_next_at=case when expired then p_now+interval '24 hours' else least(p_now+interval '24 hours',a.ends_at+make_interval(mins=>public.fn_agenda_minutes(a.settings,'unknown_protection_minutes',1440))) end where id=a.id and organization_id=a.organization_id;
  n:=n+1;
 end loop;
 return n;
end; $$;
revoke all on function public.fn_appointment_confirmation_sweep(int,timestamptz) from public,anon,authenticated;
grant execute on function public.fn_appointment_confirmation_sweep(int,timestamptz) to service_role;
