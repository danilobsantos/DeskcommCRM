-- manifest: **A edição de compromissos troca o profissional (owner_user_id/provider_id).** O PATCH `alterarAgendamentoHandler` passa a aceitar as duas chaves, mas `fn_appointment_change_core` só aplicava a allowlist da 9015 — as novas seriam ignoradas em silêncio no SET. Estende o SET com as 2 colunas (cópia fiel do corpo em vigor, com o portão MFA e a regra dos colegas intactos e na mesma posição). `p_remote` continua proibido de tocá-las (o portão subtrai a allowlist antiga; sem linha nova, as novas recusam). `fn_appointment_stamp.changed` e `fn_google_projection_stamp.changed` NÃO ganham as colunas de propósito: trocar o responsável não cancela acompanhamentos nem republica o evento do Google (hora, paciente e convidados não mudam) — o de/para fica no audit `agenda.appointment_updated`. Aditiva e idempotente (`create or replace` + `revoke` repetido como a 9015); apêndice no `baseline.sql`. Gates: `tests/api/agenda-edicao-de-compromisso.test.ts` (SET aplica as colunas nos DOIS artefatos) e `pnpm test:db` (invariantes da agenda).
-- 9018: a edição de compromissos troca o profissional (atendente ou externo).

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
  title=case when p_patch?'title' then p_patch->>'title' else title end,
  description=case when p_patch?'description' then p_patch->>'description' else description end,
  contact_id=case when p_patch?'contact_id' then (p_patch->>'contact_id')::uuid else contact_id end,
  event_type_id=case when p_patch?'event_type_id' then (p_patch->>'event_type_id')::uuid else event_type_id end,
  -- A conversa anda JUNTO com o paciente (9015): trocar o paciente sem soltar
  -- a conversa antiga deixava o compromisso novo apontando para o atendimento
  -- de outra pessoa. A tela limpa (null) ao trocar e religa ao escolher.
  conversation_id=case when p_patch?'conversation_id' then (p_patch->>'conversation_id')::uuid else conversation_id end,
  -- TROCA DE PROFISSIONAL (9018): um dono só (`dono_unico`); JSON null vira
  -- SQL NULL (limpa o lado), como `contact_id` acima. A exclusividade e a
  -- existência do externo contra a org são validadas no handler (422/404 com
  -- frase); aqui o SET só aplica o que veio.
  owner_user_id=case when p_patch?'owner_user_id' then (p_patch->>'owner_user_id')::uuid else owner_user_id end,
  provider_id=case when p_patch?'provider_id' then (p_patch->>'provider_id')::uuid else provider_id end,
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
