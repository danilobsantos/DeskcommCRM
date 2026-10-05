-- manifest: **A edição de compromissos grava título, observação, paciente e tipo (#edicao-de-compromisso).** O PATCH `alterarAgendamentoHandler` passa a aceitar `title`, `description`, `contact_id`, `conversation_id` e `event_type_id`, mas `fn_appointment_change_core` só aplicava a allowlist antiga (starts/ends/time_zone/status/cancelamento/notes/guest/outcome/snooze) — as chaves novas seriam ignoradas em silêncio no SET. §1 estende o SET com as 5 colunas (cópia fiel do corpo em vigor da 0343, com o portão MFA e a regra dos colegas intactos e na mesma posição). §2 inclui `contact_id` na linha `changed` de `fn_google_projection_stamp`: trocar o paciente passa a avançar `google_local_revision` (e agendar `google_next_attempt_at`), senão a troca convergia em silêncio e o convidado antigo ficava no evento do Google — o executor (`sync-executor.ts`) usa `local > synced + projeções iguais` como o sinal preciso da troca. Título/observação/duração NÃO entram no `changed` do `fn_appointment_stamp` de propósito: eles já sobem pelo carimbo do Google, e virar `revision` cancelaria acompanhamentos ativos e apagaria presença por causa de uma correção de texto. Aditiva e idempotente (`create or replace` + `revoke` repetido como a 0343); apêndice no `baseline.sql` ANTES da varredura anon (criar função depois dela nasce com EXECUTE para anon em quem atualiza). Gates: `tests/api/agenda-edicao-de-compromisso.test.ts` (SET aplica as colunas nos DOIS artefatos) e `pnpm test:db` (invariantes da agenda).
-- 9015: a edição de compromissos grava título, observação, paciente e tipo.
--
-- O DEFEITO (potencial, medido por leitura): `fn_appointment_change_core`
-- monta o UPDATE com `case when p_patch?'col' …` por coluna. Chave que o SET
-- não nomeia é ignorada em silêncio — sem erro, sem escrita. A rota passaria a
-- aceitar `title/description/contact_id/event_type_id` no Zod e o banco
-- fingiria que gravou.
--
-- O segundo defeito é no Google: `fn_google_projection_stamp` só avança
-- `google_local_revision` quando a linha `changed` mexe (hora, título,
-- descrição, local, convidado). Trocar SÓ o paciente não mexia em nada
-- projetado: o reconcile via `needs_google_push` (que é por `updated_at`)
-- acordava, comparava projeções iguais e carimbava `converged` — e o e-mail
-- do paciente antigo ficava convidado no evento para sempre.
--
-- A REGUA do que entra em cada `changed`:
--   * `fn_appointment_stamp.changed` (revision do domínio): NÃO TOCADO.
--     Virar `revision` cancela acompanhamentos ativos, resolve itens do inbox,
--     apaga presença registrada e zera o snooze. Correção de título ou de
--     observação não pode fazer nada disso — e `contact_id` e `ends_at` JÁ
--     estão na linha, então troca de paciente e de duração já viram revisão.
--   * `fn_google_projection_stamp.changed`: ganha `contact_id`. O efeito é SÓ
--     acordar o reconcile com `local > synced`; a decisão do que publicar
--     continua no `compare` + `comConviteDaFicha`/`trocaDePaciente` do
--     executor, e compromisso antigo que ninguém tocou continua `converged`
--     (decisão do dono, doc 36).
--
-- `p_remote` (canal do Google) continua proibido de tocar nas chaves novas: o
-- portão subtrai a allowlist antiga e qualquer chave fora dela recusa com
-- `google_patch_forbidden`. Nenhuma linha nova no portão = as novas recusam.
-- ---- §1. o núcleo de alteração aplica título, observação, paciente e tipo (migration 9015) ----
create or replace function public.fn_appointment_change_core(p_org uuid,p_id uuid,p_revision bigint,p_patch jsonb,p_remote boolean,p_base jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.calendar_appointments; contact uuid; origin jsonb; event_id uuid;
begin
 if p_remote and (auth.uid() is not null or (p_patch-'starts_at'-'ends_at'-'time_zone'-'status'-'cancellation_reason')<>'{}'::jsonb or coalesce(p_patch->>'status','cancelled')<>'cancelled') then raise exception 'google_patch_forbidden' using errcode='42501';end if;
 if auth.uid() is not null and (not public.fn_role_at_least(p_org,'agent') or not public.fn_support_write_allowed(p_org)) then raise exception 'appointment_forbidden' using errcode='42501'; end if;
 if auth.uid() is not null and not public.fn_session_mfa_proven() then raise exception 'appointment_mfa_required' using errcode='42501';end if;
 select contact_id into contact from public.calendar_appointments where organization_id=p_org and id=p_id;
 if not found then raise exception 'appointment_not_found' using errcode='P0002'; end if;
 if contact is not null then perform public.fn_service_lock(p_org,contact); end if;
 select * into a from public.calendar_appointments where organization_id=p_org and id=p_id for update;
 if a.contact_id is distinct from contact or a.revision is distinct from p_revision then raise exception 'appointment_stale' using errcode='40001'; end if;
 -- A AGENDA DO COLEGA É UMA OPÇÃO DA ORGANIZAÇÃO (migration 0343, issue #978).
 if auth.uid() is not null and not public.fn_role_at_least(p_org,'manager')
    and not public.fn_colegas_podem_mexer_na_agenda(p_org)
    and a.owner_user_id is distinct from auth.uid() then
  raise exception 'appointment_do_colega' using errcode='42501';
 end if;
 if p_remote and a.status not in ('pending','confirmed') then raise exception 'google_outcome_protected' using errcode='40001';end if;
 if a.status='cancelled' then raise exception 'appointment_cancelled' using errcode='22023'; end if;
 if contact is not null then origin:=jsonb_build_object('kind','command','observed',public.fn_service_observe_command(p_org,contact)); end if;
 update public.calendar_appointments set
  google_base_projection=case when p_remote then p_base else google_base_projection end,
  starts_at=case when p_patch?'starts_at' then (p_patch->>'starts_at')::timestamptz else starts_at end,
  ends_at=case when p_patch?'ends_at' then (p_patch->>'ends_at')::timestamptz else ends_at end,
  time_zone=coalesce(p_patch->>'time_zone',time_zone),
  status=coalesce(p_patch->>'status',status),
  cancelled_at=case when p_patch->>'status'='cancelled' then now() else cancelled_at end,
  cancellation_reason=case when p_patch?'cancellation_reason' then p_patch->>'cancellation_reason' else cancellation_reason end,
  notes=case when p_patch?'notes' then p_patch->>'notes' else notes end,
  guest_email=case when p_patch?'guest_email' then p_patch->>'guest_email' else guest_email end,
  -- EDIÇÃO DE COMPROMISSO (9015): título, observação publicável, paciente e
  -- tipo. `contact_id`/`event_type_id` com JSON null viram SQL NULL (desvincula);
  -- o escopo do contato contra a org é validado na rota (404) e de novo no
  -- `fn_appointment_stamp` (`appointment_contact_scope`). Título vazio é
  -- recusado na rota (zod min 1); aqui o SET só aplica o que veio.
  title=case when p_patch?'title' then p_patch->>'title' else title end,
  description=case when p_patch?'description' then p_patch->>'description' else description end,
  contact_id=case when p_patch?'contact_id' then (p_patch->>'contact_id')::uuid else contact_id end,
  event_type_id=case when p_patch?'event_type_id' then (p_patch->>'event_type_id')::uuid else event_type_id end,
  -- A conversa anda JUNTO com o paciente: trocar o paciente sem soltar a
  -- conversa antiga deixava o compromisso novo apontando para o atendimento
  -- de outra pessoa. A tela limpa (null) ao trocar e religa ao escolher.
  conversation_id=case when p_patch?'conversation_id' then (p_patch->>'conversation_id')::uuid else conversation_id end,
  outcome_message_id=case when p_patch?'outcome_message_id' then (p_patch->>'outcome_message_id')::uuid else null end,
  confirmation_next_at=case when p_patch?'confirmation_next_at' then (p_patch->>'confirmation_next_at')::timestamptz else confirmation_next_at end
 where organization_id=p_org and id=p_id returning * into a;
 if p_patch?'confirmation_next_at' and (a.confirmation_next_at<=now() or a.confirmation_next_at>now()+interval '24 hours') then raise exception 'appointment_invalid_snooze' using errcode='22023'; end if;
 update public.followup_enrollments set status='cancelled',cancel_reason='O compromisso mudou. Revise o próximo passo.',completed_at=now(),next_eval_at=null,claimed_until=null
  where organization_id=p_org and appointment_id=p_id and appointment_revision<>a.revision and status in ('active','waiting_reply','paused_handoff','paused_manual');
 update public.agent_inbox_items set status='resolved',resolved_at=now()
  where organization_id=p_org and ref_kind='appointment' and ref_id=p_id and status='open'
   and (appointment_revision<>a.revision or a.status in ('completed','no_show','cancelled') or p_patch?'confirmation_next_at');
 if contact is not null and a.status='no_show' and a.outcome_recorded_at is not null and a.revision<>p_revision then
  insert into public.event_log(organization_id,event_type,entity_kind,entity_id,payload)
   values(p_org,'appointment.outcome_confirmed','appointment',p_id,
    jsonb_build_object('appointment_revision',a.revision,'service_origin',origin)) returning id into event_id;
 end if;
 return to_jsonb(a);
end; $$;

-- Repetido do baseline de propósito: esta migration REFAZ a função, e o
-- `create or replace` não mexe em grant (ver o mesmo comentário na 0343).
revoke all on function public.fn_appointment_change_core(uuid,uuid,bigint,jsonb,boolean,jsonb) from public,anon,authenticated;

-- ---- §2. trocar o paciente acorda o push do Google (migration 9015) ----
--
-- Só a linha `changed`: `contact_id` entra na comparação. O resto da função é
-- cópia fiel do corpo em vigor (o do baseline, § da 0225). Troca de paciente
-- avança `google_local_revision` e agenda `google_next_attempt_at`; o executor
-- lê `local > synced` com projeções iguais como TROCA DE PACIENTE e republica
-- o grupo `guest` com a lista refeita (ver `trocouPaciente` em sync-model.ts).
create or replace function public.fn_google_projection_stamp()
returns trigger language plpgsql security definer set search_path=public as $$
declare changed boolean; inbound boolean; decision boolean; redacted boolean;
begin
 redacted:=new.contact_id is not null and exists(select 1 from public.contacts where organization_id=new.organization_id and id=new.contact_id and is_anonymized);
 if redacted then
  new.google_base_projection:=null;new.google_conflict:=null;new.google_pending_write:=null;new.google_claim_token:=null;new.google_claim_until:=null;new.google_etag:=null;new.guest_email:=null;
  if tg_op='UPDATE' then new.google_claim_epoch:=old.google_claim_epoch+1;new.google_local_revision:=old.google_local_revision;new.google_synced_local_revision:=old.google_local_revision;end if;
  return new;
 end if;
 if tg_op='INSERT' then
  new.google_local_revision:=1;new.google_synced_local_revision:=0;
  if auth.uid() is not null then
   new.google_base_projection:=null;new.google_etag:=null;new.google_pending_write:=null;new.google_conflict:=null;
   new.google_claim_token:=null;new.google_claim_epoch:=0;new.google_claim_until:=null;
   new.google_connection_id:=null;new.google_calendar_id:=null;new.google_event_id:=null;
  end if;
  return new;
 end if;
 decision:=((old.provider_id is null and auth.uid()=old.owner_user_id and public.fn_role_at_least(new.organization_id,'agent'))
  or (old.provider_id is not null and auth.uid() is not null and public.fn_role_at_least(new.organization_id,'manager')))
  and public.fn_support_write_allowed(new.organization_id)
  and old.google_conflict is not null and new.google_conflict-'resolution'=old.google_conflict-'resolution'
  and new.google_conflict->'resolution'->>'actor_id'=auth.uid()::text
  and new.google_conflict->'resolution'->>'choice' in ('google','local','preserve_remote')
  and old.google_conflict->>'revision'=old.revision::text and old.google_conflict->>'local_revision'=old.google_local_revision::text
  and old.google_conflict->>'etag' is not distinct from old.google_etag;
 if auth.uid() is not null and (row(new.google_synced_at,new.google_sync_error) is distinct from row(old.google_synced_at,old.google_sync_error)
  or (new.google_next_attempt_at is distinct from old.google_next_attempt_at and not coalesce((((old.provider_id is null and auth.uid()=old.owner_user_id and public.fn_role_at_least(new.organization_id,'agent'))
   or (old.provider_id is not null and auth.uid() is not null and public.fn_role_at_least(new.organization_id,'manager'))) and public.fn_support_write_allowed(new.organization_id))
    and new.google_next_attempt_at<=clock_timestamp() and (old.google_conflict is null or decision),false))) then
  raise exception 'google_metadata_private' using errcode='42501';end if;
 if auth.uid() is not null and ((new.google_conflict is distinct from old.google_conflict and not coalesce(decision,false)) or row(new.google_base_projection,new.google_pending_write,new.google_claim_token,new.google_claim_epoch,new.google_claim_until,new.google_synced_local_revision,new.google_etag,new.google_connection_id,new.google_calendar_id,new.google_event_id)
  is distinct from row(old.google_base_projection,old.google_pending_write,old.google_claim_token,old.google_claim_epoch,old.google_claim_until,old.google_synced_local_revision,old.google_etag,old.google_connection_id,old.google_calendar_id,old.google_event_id)) then
  raise exception 'google_metadata_private' using errcode='42501';
 end if;
 -- 9015: `contact_id` na linha. O e-mail do paciente não é coluna projetada
 -- (mora em `contacts`), então sem isto a troca não avançava revisão nenhuma e
 -- o reconcile convergia com o convidado antigo no evento.
 changed:=row(new.starts_at,new.ends_at,new.time_zone,new.status='cancelled',new.title,new.description,new.location_kind,new.location_details,new.guest_email,new.contact_id)
  is distinct from row(old.starts_at,old.ends_at,old.time_zone,old.status='cancelled',old.title,old.description,old.location_kind,old.location_details,old.guest_email,old.contact_id);
 -- Única entrada que modifica base e domínio juntos é o núcleo service-only.
 -- Não há GUC ou flag no body público que suprima revisão.
 inbound:=row(new.title,new.description,new.location_kind,new.location_details,new.guest_email) is not distinct from row(old.title,old.description,old.location_kind,old.location_details,old.guest_email) and auth.uid() is null and new.google_base_projection is distinct from old.google_base_projection
  and (new.google_base_projection->'shared'->>'starts_at')::timestamptz=new.starts_at
  and (new.google_base_projection->'shared'->>'ends_at')::timestamptz=new.ends_at
  and new.google_base_projection->'shared'->>'time_zone'=new.time_zone
  and (new.google_base_projection->'shared'->>'cancelled')::boolean=(new.status='cancelled');
 new.google_local_revision:=old.google_local_revision+case when changed and not coalesce(inbound,false) then 1 else 0 end;
 if changed then new.google_next_attempt_at:=now(); end if;
 return new;
end;$$;
revoke all on function public.fn_google_projection_stamp() from public,anon,authenticated;
drop trigger if exists trg_google_projection_stamp on public.calendar_appointments;
create trigger trg_google_projection_stamp before insert or update on public.calendar_appointments for each row execute function public.fn_google_projection_stamp();
