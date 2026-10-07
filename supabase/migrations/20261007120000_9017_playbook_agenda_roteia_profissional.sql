-- manifest: **O playbook `agendamento` aprende a rotear para profissional externo.** Medido no `api_audit_log` em produção (2026-10-07): 20/20 `crm_find_free_slots` sem dono, zero marcações em 1h. Nova versão do corpo (roteamento via `crm_list_providers` + `provider_id`) publicada pelo ritual idempotente da 0486 (md5 + reponte); apêndice no `baseline.sql` ANTES da varredura de função (o bloco é só `do`, sem criar função).
-- 9017 — o playbook `agendamento` aprende a rotear para profissional externo.
--
-- O `api_audit_log` mediu o defeito em produção (2026-10-07): 20/20 chamadas de
-- `crm_find_free_slots` com `ok: true`, ZERO com `provider_id` e ZERO marcações em
-- 1h — o modelo consultava em loop a agenda do atendente padrão e desistia com
-- "vou verificar com a equipe". O playbook ensinava só `crm_list_event_types` →
-- `find` → `book`, sem nunca nomear `crm_list_providers`: sem instrução, o modelo
-- não endereça o profissional, e a consulta cai no dono errado (outro calendário,
-- outros dias fora).
--
-- ⚠️ A RÉGUA É A MESMA da 0486: ferramenta nova entra DENTRO de condição ("e
-- `crm_list_providers` estiver na sua mão", "SE o horário é com profissional
-- específico"). Nomear ferramenta que o agente não tem faz o modelo tentar chamá-la.
--
-- MESMA FORMA da 0191/0486 (`values (null, '<nome>', ..., $body$...$body$)`), pelo
-- mesmo motivo: `tests/unit/playbook-cita-a-ferramenta.test.ts` extrai os corpos por
-- esse padrão exato — outro delimitador deixa o gate VERDE por vacuidade.
--
-- Idempotência por CONTEÚDO (md5 do corpo), reponte SEMPRE — ver a 0486.

do $pub$
declare
  -- md5 do corpo abaixo. Conferido logo após o insert — ver a 0486.
  v_md5 constant text := 'd5fc94b8df90efb2f0f1cde7f10bafe9';
  v_id  uuid;
begin
  select id into v_id
    from skill_versions
   where organization_id is null and name = 'agendamento' and md5(body) = v_md5
   limit 1;

  if v_id is null then
    insert into skill_versions (organization_id, name, description, body, matcher)
    values (
      null,
      'agendamento',
      'Playbook pra marcar/remarcar horário (consulta, visita, sessão) — consulta a agenda real (tipos, horários e profissional quando houver) pelas ferramentas quando elas existem, nunca inventa disponibilidade, e confirma por escrito antes de fechar.',
      $body$# Playbook: marcar horário/agendamento

## Quando usar
O lead pede pra marcar um horário, consulta, visita, demonstração ou sessão —
qualquer compromisso com data/hora. Comum em clínicas, imobiliárias (visitas),
serviços e consultorias.

## Regra de ouro: consulte a agenda, não adivinhe
Você tem acesso à agenda **se, e somente se**, a ferramenta `crm_find_free_slots`
estiver disponível para você. Não julgue isso por intuição — chame e leia a resposta.
Se `crm_list_event_types` também estiver na sua mão, a consulta é de DOIS passos, e os
dois no MESMO TURNO: ela devolve os tipos de atendimento da empresa com o `slug` de cada
um, e só então `crm_find_free_slots` consulta horários DESSE tipo, com o `event_type_slug`
que veio da lista. Parar depois da lista e responder "vou verificar" é o defeito — a lista
é o começo da conversa com a agenda, não a resposta. Nunca invente nem traduza um `slug`:
se o tipo que o lead pediu não está na lista, diga o que existe em vez de verificar o que
não existe.
Se o lead quer ser atendido por um PROFISSIONAL específico (nomeou "com a Dra. X",
ou o atendimento só existe na agenda de um profissional) e `crm_list_providers`
estiver na sua mão, a consulta tem um passo a mais, no MESMO TURNO: ela devolve os
profissionais ativos com o `id` de cada um, e `crm_find_free_slots` e
`crm_book_appointment` levam esse `id` em `provider_id`. Sem `provider_id`, as duas
caem na agenda do atendente padrão — outro calendário, outros dias fora, e o horário
oferecido não existe na agenda certa. `crm_list_providers` vazia = a empresa não tem
profissionais externos: siga pelos atendentes.
- Voltou com horários → ofereça 2 ou 3 deles, concretos.
- Voltou `publicou_horarios: false` → o atendente ainda não publicou os horários de
  trabalho dele. Isso NÃO é "está lotado" e NÃO é "não tem vaga": não invente horário,
  não diga que a agenda está cheia, e avise que alguém da equipe confirma.
- Voltou com `motivo` → leia a `mensagem` e faça o que ela manda. Ela foi escrita para
  o cliente ouvir.
- Voltou `fuso_suposto: true` → o fuso da agenda veio do padrão e ninguém confirmou.
  Ofereça pedindo confirmação — "consigo terça às 14h; confere se esse horário bate aí
  pra você?" — em vez de afirmar.
- Você não tem essa ferramenta → aí sim: não ofereça horário nenhum, diga que vai
  confirmar a disponibilidade e sinalize handoff para quem tem acesso.
Prometer um horário que depois não existe quebra confiança e gera reagendamento
forçado. Inventar é pior do que demorar um instante a mais para responder.

## Fluxo padrão (if-then)

**1. Identifique o serviço/motivo antes de oferecer horário**
- SE o lead só disse "quero agendar" sem contexto → pergunte o motivo/serviço
  primeiro. Agendar sem saber o quê gera erro de encaixe (ex.: consulta de 20min
  marcada num slot de 1h de procedimento).
- SE você ainda não tem o `slug` desse serviço e `crm_list_event_types` está na sua mão →
  chame-a e escolha o tipo pelo que o lead descreveu; é dela que sai o `event_type_slug` do
  passo seguinte.

**2. Ofereça opções fechadas, não uma pergunta aberta**
- SE o tipo já está na lista mas horário nenhum foi consultado ainda → chame
  `crm_find_free_slots` com o `event_type_slug` dele ANTES de responder.
- SE o horário é com profissional específico → repita o `provider_id` dele em TODAS
  as chamadas da cadeia (`find` e `book`); trocar de ferramenta no meio (`find` com
  e `book` sem) marca na agenda errada.
- SE `crm_find_free_slots` respondeu com horários → ofereça 2-3 concretos ("tenho terça
  14h ou quarta 10h, qual funciona?"). Pergunta aberta tipo "qual horário você prefere?"
  gera ida e volta desnecessária e trava a conversa.
- SE você não tem a ferramenta → não invente. Diga algo como "vou confirmar a
  disponibilidade e te retorno em instantes" e sinalize handoff/task pra quem tem
  acesso.

**3. Colete os dados obrigatórios antes de confirmar**
- Nome completo do lead (ou confirme o que já está no CRM).
- Serviço/motivo específico.
- Unidade/local, se o tenant tiver mais de uma (clínica com filiais, imobiliária com
  múltiplos imóveis).
- Se for reagendamento, o horário anterior a ser substituído.

**4. Confirme por escrito antes de encerrar**
- SE o lead escolheu um horário e `crm_book_appointment` está na sua mão → grave de verdade
  com ela, usando o `starts_at` que `crm_find_free_slots` devolveu, sem reescrever, e SÓ ENTÃO
  repita por escrito. Horário oferecido e não marcado não é reserva — é ele que gera
  reagendamento forçado.
- SE o lead aceitar um horário → repita de volta por escrito: "Confirmado:
  [serviço] dia [data] às [hora], em [local]. Confirma pra mim?"
- Só considere o agendamento fechado depois do "sim"/confirmação explícita do lead —
  silêncio ou "ok" vago não é confirmação suficiente pra compromissos com custo de
  no-show alto (ex. consulta médica, visita a imóvel).

**5. Reagendamento e cancelamento**
- SE o lead pedir pra remarcar E você tem `crm_reschedule_appointment` → use ela.
  NÃO cancele e marque de novo: é o MESMO compromisso mudando de hora. O histórico
  continua um só e o lembrete é refeito sozinho para o horário novo.
- SE o lead pedir pra remarcar e você NÃO tem essa ferramenta → então cancelar e marcar
  de novo é o único caminho, e ele tem um custo que você precisa administrar: o cliente
  pode receber dois avisos seguidos e contraditórios ("desmarcado" e depois "marcado").
  Antes de fazer, diga a ele em uma frase o que vai acontecer — "vou desmarcar o horário
  antigo e já marcar o novo, você pode receber dois avisos" — e nunca deixe os dois
  compromissos de pé ao mesmo tempo.
- SE o lead pedir pra cancelar → use `crm_cancel_appointment` se você a tiver, informe o
  motivo, e pergunte se quer remarcar pra outra data, sem pressionar. Cancelar libera
  aquele horário para outra pessoa e não dá para desfazer: confirme antes.

**6. Risco de no-show**
- Se o negócio tiver política de confirmação D-1 documentada na base de
  conhecimento, siga-a (ex.: mensagem de lembrete automática). Se não houver, não
  invente política — apenas confirme o agendamento normalmente.

## Regras duras
- Nunca confirme horário sem ter checado disponibilidade real (ou sem sinalizar que
  ainda vai confirmar).
- Nunca marque dois compromissos conflitantes pro mesmo lead sem avisar.
- Nunca ofereça nem marque horário da agenda do atendente padrão para pedido dirigido
  a profissional específico — e nunca o inverso.
- Se o lead pedir um horário fora do funcionamento do negócio (ex. domingo,
  madrugada) e isso não estiver nas regras do tenant, não confirme — explique a
  janela real de atendimento.
- Dado sensível (endereço completo, documento) só é coletado se o fluxo do tenant
  realmente exigir — não peça informação a mais que o agendamento precisa.
- Marcar consulta e agendar retorno são coisas DIFERENTES. `crm_book_appointment` é para
  hora combinada COM o cliente, que ele reservou e vai comparecer — alguém espera por ele.
  `crm_schedule_followup` é decisão interna nossa de voltar a falar: o cliente não fica
  sabendo e nada é reservado na agenda de ninguém. Se ele ESCOLHEU um horário para ser
  atendido, é a primeira.

## Exemplos de resposta (tom, não copiar literal)
- "Pra eu te encaixar certo: é pra qual serviço/motivo?"
- "Tenho quinta às 15h ou sexta às 9h — qual fica melhor pra você?"
- "Confirmado: consulta dia 28/07 às 15h, na unidade Centro. Pode confirmar pra
  mim?"

## O que NÃO fazer
- Não pergunte "qual horário você prefere?" sem oferecer opções concretas quando
  você tem a agenda.
- Não confirme agendamento sem resposta explícita do lead.
- Não invente disponibilidade que você não checou.$body$,
      '{"any_keywords": ["agendar", "marcar horário", "marcar consulta", "marcar uma visita", "agenda", "que horas vocês", "horário disponível", "remarcar", "reagendar", "cancelar o horário", "desmarcar"], "probe_keywords": ["que horas", "qual dia", "tem vaga", "disponibilidade"]}'::jsonb
    )
    returning id into v_id;

    if (select md5(body) from skill_versions where id = v_id) is distinct from v_md5 then
      raise exception 'playbook agendamento: o md5 declarado (%) nao corresponde ao corpo inserido. Recalcule antes de publicar.', v_md5;
    end if;
  end if;

  -- Repointe SEMPRE (ver a 0486).
  update skill_pointers
     set version_id = v_id, updated_at = now()
   where organization_id is null and name = 'agendamento';

  if not found then
    insert into skill_pointers (organization_id, name, version_id)
    values (null, 'agendamento', v_id);
  end if;
end
$pub$;
