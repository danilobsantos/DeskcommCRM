# Agenda de Profissionais Externos — guia de configuração

> **O que esta feature faz:** permite que uma clínica (ou imobiliária, consultoria…)
> tenha **profissionais externos sem login** — dentista, corretor, consultor — cada
> um com **agenda própria**, gerida por uma secretária/atendente. O agente de IA
> também agenda automaticamente. É uma extensão da Agenda do base, ativável **por
> tenant** pelo painel da plataforma (`/admin`).

---

## 1. Visão geral

| Conceito | Onde mora |
|---|---|
| Profissional externo (sem conta) | tabela `providers` (migration 9003) |
| Jornada semanal do profissional | `providers.schedule` (jsonb `{timezone, windows[]}`, mesmo molde de `attendant_availability`) |
| Compromisso do profissional | `calendar_appointments.provider_id` (mutuamente exclusivo com `owner_user_id`) |
| Tipos de atendimento | `calendar_event_types` (mesmos do base) |
| Flag por tenant | `organizations.settings.scheduling.providers_enabled` |

A feature é **opt-in**: desligada, a Agenda do base (atendentes + IA) funciona
normalmente e nada muda.

---

## 2. Pré-requisitos da instalação

1. **Migration 9003 aplicada.** No self-host, o `update.sh` aplica o apêndice do
   `baseline.sql` (cria `providers`, adiciona `provider_id` nas tabelas de agenda).
2. **Flag do tenant ligada** — decisão de PLATAFORMA (quem responde pela instalação):
   - Entre em **`/admin/tenants/:id/funcionalidades`**.
   - Ligue o switch **"Profissionais externos (dentistas sem login)"**.
   - Com a flag OFF, o item "Profissionais" **some do menu** e a página
     `/app/agenda/profissionais` redireciona para a Agenda.

> No ambiente de desenvolvimento, depois de ligar a flag, faça **hard refresh**
> (`Cmd+Shift+R`) — o `next dev` nem sempre re-registra pastas de rota/menu
> recém-criadas sem reiniciar.

---

## 3. Configuração base da agenda (antes do agente)

### 3.1 Tipos de agendamento
O agente só oferece horário se existir um **tipo** (consulta, limpeza, visita…).

- Caminho: **Configurações → Agenda → "Tipos de agendamento"** (`/app/settings/tenant/agenda`).
- Crie ao menos um tipo. Cada tipo define: **duração**, **buffers**, **antecedência
  mínima**, **exige confirmação**, **responsável padrão** (opcional).

> ⚠️ Sem tipo, o agente recebe `tipo_desconhecido` e não agenda.

### 3.2 Jornada dos atendentes (usuários)
- Caminho: **Equipe → aba Atendimento** (`/app/team`).
- Publique janelas semanais (dia + início + fim) + fuso.

> Na Agenda, `windows` vazio = "não publicou horário" ⇒ **zero horários**. É
> diferente de "sem vaga". Configurar é obrigatório para quem vai ser ofertado.

### 3.3 Jornada dos profissionais externos
Cada dentista precisa de jornada própria, senão **não agenda nada**.

- Caminho: **Agenda → Profissionais → botão "Horário"** (`/app/agenda/profissionais`).
- Defina as janelas semanais + fuso do profissional e salve.
- O profissional também tem **Ativo/Inativo**; inativo não recebe oferta.

---

## 4. Criar o agente de atendimento

1. **Conecte um canal primeiro** (WhatsApp via WAHA) — sem canal o agente não
   consegue conversar nem marcar. O canal conectado aparece na tela de criação.
2. Caminho: **IA → Agentes → "Novo agente"** (`/app/ai/agents/new`).
   - Papel necessário: **admin** da organização.
3. Preencha nome e o **system prompt** (ver seção 5).
4. Em **capacidades**, habilite os pacotes (ver seção 6).
5. Escolha o **modelo** (o padrão da organização ou um específico).
6. Associe o(s) **canal(is)** e **publique** o agente.

> Para o agente atender **inbound** (cliente chama o número), ele precisa estar
> publicado e associado ao canal. Sem isso, só funciona em fluxos que você dispara.

---

## 5. Prompt do agente

Copie e cole no campo **"System prompt"** do agente, ajustando `[NOME DA CLÍNICA]`,
endereço e horário:

```
Você é o assistente virtual da [NOME DA CLÍNICA]. Seu papel é atender no WhatsApp:
tirar dúvidas, e principalmente AGENDAR, REMARCAR ou CANCELAR consultas com os
profissionais da equipe.

## Como agendar (fluxo obrigatório)

1. Identifique a necessidade: pergunte o motivo (consulta, limpeza, check-up, dor…).
2. Sugira o profissional certo. Use `crm_list_providers` para ver os profissionais
   externos (dentistas sem login) e `crm_list_event_types` para saber o que a
   clínica atende. Não invente nome nem tipo.
3. Verifique disponibilidade com `crm_find_free_slots` ANTES de oferecer horário.
   Use o `event_type_slug` que veio de `crm_list_event_types`. Se a consulta é com
   um profissional externo, passe `provider_id` (o id veio de `crm_list_providers`).
   Nunca ofereça horário que não veio da resposta.
4. Confirme os dados com o cliente: nome completo, telefone e o horário escolhido.
5. Marque com `crm_book_appointment`, usando o `starts_at` exato que veio de
   `crm_find_free_slots`. Repasse o mesmo `provider_id` quando for com um
   profissional externo.
6. Confirme o agendamento ao cliente e avise que um lembrete é enviado no dia.

## Regras

- Se `crm_find_free_slots` voltar `publicou_horarios: false`, o profissional ainda
  não publicou horários. NÃO invente horário e NÃO diga que está lotado — avise que
  alguém da equipe confirma.
- Remarcar usa `crm_reschedule_appointment` (é o MESMO compromisso mudando de hora,
  não cancelar e marcar de novo).
- Cancelar usa `crm_cancel_appointment` e exige um `reason` claro.
- Confirmar presença usa `crm_confirm_appointment`; registrar falta/realizado usa
  `crm_set_appointment_outcome` e só DEPOIS da hora.
- Cliente que já tem consulta marcada: confira com `crm_list_appointments` antes de
  oferecer outro horário, e não o cobre como se estivesse parado.

## O que NÃO fazer

- Nunca dê diagnóstico médico nem prescreva tratamento.
- Nunca invente horário, tipo ou profissional que não veio das ferramentas.
- Nunca diga "está tudo lotado" quando a verdade é que a agenda não tem horário
  publicado.
- Em emergência (dor intensa, sangramento), oriente procurar atendimento presencial.
```

---

## 6. Quais tools habilitar

Na tela do agente, em **Capacidades**, ligue os pacotes abaixo. As ferramentas de
agenda vivem no pacote **"Vender e mover o funil"**; para conversar, ligue também
**"Atender e responder"**.

| Pacote | Traz para o agente |
|---|---|
| **Atender e responder** (`atender`) | conversar, ler contexto, buscar conhecimento, responder ao cliente |
| **Vender e mover o funil** (`vender`) | toda a família de agenda + lead/funil |

### Ferramentas de agenda (vêm do pacote `vender`)

| Tool | Risco | O que faz |
|---|---|---|
| `crm_list_event_types` | seguro | lista os tipos de atendimento (consulta, limpeza…) |
| `crm_list_providers` | seguro | lista os profissionais externos (dentistas sem login) |
| `crm_find_free_slots` | seguro | horários livres de um tipo, já com jornada/folgas/ocupados |
| `crm_list_appointments` | seguro | compromissos de um cliente/dia/pessoa |
| `crm_book_appointment` | atenção | marca consulta (reserva o horário) |
| `crm_reschedule_appointment` | atenção | remarca um compromisso |
| `crm_confirm_appointment` | atenção | confirma presença |
| `crm_set_appointment_outcome` | atenção | registra realizado/falta (só depois da hora) |
| `crm_cancel_appointment` | **crítico** | desmarca e libera o horário (não entra por pacote) |

> ⚠️ **`crm_cancel_appointment` é crítico** (efeito que não se desfaz: o horário
> volta ao pool e pode ser tomado em segundos). Por isso ele **não** vem ligado
> pelo pacote `vender`. Se quiser que a IA desmarque sozinha, ligue-o
> **explicitamente** em "modo avançado" (tool por tool). Deixe desligado se preferir
> que o cancelamento seja só por uma pessoa.

> Dica: como o `vender` também liga ferramentas de funil/lead, se quiser que o
> agente **só** agende sem mexer no funil, use o **modo avançado** e marque apenas
> as ferramentas de agenda da tabela acima (+ as de `atender`).

---

## 7. Como testar

### 7.1 Teste manual da agenda (sem agente)
1. Verifique a flag ligada e a página **Agenda → Profissionais** carregando (não
   redirecionando).
2. Cadastre um profissional e defina a **jornada dele** (botão "Horário").
3. Em `/app/agenda`, **isole o profissional** no filtro de pessoas → a grade deve
   mostrar os horários livres da jornada dele.
4. **Marque pela grade** selecionando um horário do profissional: o bloco deve
   nascer com a cor do dentista.
5. Confirme que o compromisso aparece no **histórico** e que a disponibilidade
   agora exclui aquele horário.

### 7.2 Teste do agente (ponta a ponta)
1. Com o agente **publicado** e o canal WhatsApp conectado, envie uma mensagem do
   cliente, ex.:
   - *"Oi, quero marcar uma limpeza."*
   - O agente deve responder, consultar `crm_list_event_types` + `crm_list_providers`
     + `crm_find_free_slots`, oferecer horários reais e, ao você escolher, chamar
     `crm_book_appointment`.
2. Confirme no painel que o compromisso foi criado para o **profissional correto**
   (não para um atendente aleatório).
3. Teste o caso de **sem jornada**: desative a jornada de um profissional e peça
   para agendar com ele — o agente deve dizer que alguém da equipe confirma, e
   NUNCA inventar horário.

### 7.3 Onde há prova automatizada
- Specs e2e de agenda (CI): `agenda-marcar-pela-tela`, `agenda-grade-interativa`,
  `agenda-escopo-da-organizacao`, entre outras.
- Invariante de RLS: `tests/invariants/rls-isolation.test.ts` inclui `providers`.
- Unit: `tests/unit/agenda-profissionais-externos.test.ts` (flag + ramo do motor com
  provider), `tests/unit/sidebar-grupos.test.tsx` (menu + item ativo).

---

## 8. Troubleshooting

| Sintoma | Causa provável | Ação |
|---|---|---|
| Item "Profissionais" não aparece no menu | flag OFF no tenant | ligue em `/admin/tenants/:id/funcionalidades` e hard refresh |
| Página redireciona para Agenda | flag OFF | idem |
| Dentista não aparece com horários | jornada `schedule` vazia | defina em Profissionais → "Horário" |
| Agente não agenda / diz que não acha tipo | pacote `vender` não ligado ou nenhum tipo criado | habilite o pacote e crie tipos em Configurações → Agenda |
| Agente oferece horário de outro profissional | `provider_id` não repassado na oferta/marcação | confira o fluxo do prompt; a oferta e a marcação devem usar o mesmo `provider_id` |
| Cancelamento não funciona via IA | `crm_cancel_appointment` é crítico e não entra por pacote | ligue explicitamente no modo avançado |
| Consultas de provider não aparecem na grade | grade lê `owner_user_id`; provider vai por `provider_id` | confirme que o bloco usa `responsavelId = provider_id` (versão com a integração de grade aplicada) |