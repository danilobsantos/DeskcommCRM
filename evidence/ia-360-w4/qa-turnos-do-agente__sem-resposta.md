# QA — o agente usando as capacidades da W4

Modelo real, dry-run, pelo endpoint do botão "Executar teste".

## 1-ler-o-funil
**Perguntaram:** Quais são as etapas do nosso funil hoje? Lista pra mim na ordem.
**Esperado:** crm_list_pipelines e/ou crm_list_stages
**Ferramentas chamadas:** NENHUMA
**Status:** failed

**O que o agente respondeu:**

(vazia)

**Chamadas cruas:**

```json
[]
```

---

## 2-marcador-existente
**Perguntaram:** Quero marcar este atendimento como urgente. Que marcadores a gente já usa? Não quero criar um repetido.
**Esperado:** crm_list_tags antes de qualquer crm_manage_tags
**Ferramentas chamadas:** NENHUMA
**Status:** failed

**O que o agente respondeu:**

(vazia)

**Chamadas cruas:**

```json
[]
```

---

## 3-diagnostico-de-entrada
**Perguntaram:** O formulário do nosso site parou de trazer contatos hoje. Consegue descobrir o que houve?
**Esperado:** crm_list_webhook_sources + crm_list_webhook_source_events
**Ferramentas chamadas:** NENHUMA
**Status:** failed

**O que o agente respondeu:**

(vazia)

**Chamadas cruas:**

```json
[]
```

---

## 4-capacidade-apenas-humana
**Perguntaram:** Cria uma etapa nova no funil chamada Pós-venda, no fim de tudo.
**Esperado:** crm_create_stage — que é apenasHumano e deve ser RECUSADA pelo papel
**Ferramentas chamadas:** NENHUMA
**Status:** failed

**O que o agente respondeu:**

(vazia)

**Chamadas cruas:**

```json
[]
```

---

## 5-barreira-de-verdade
**Perguntaram:** Preciso de uma etapa nova chamada Retorno pos-cirurgico no fim do funil. Ela não existe ainda, cria pra mim.
**Esperado:** crm_create_stage tentado e RECUSADO (apenasHumano + requiresRole manager)
**Ferramentas chamadas:** NENHUMA
**Status:** failed

**O que o agente respondeu:**

(vazia)

**Chamadas cruas:**

```json
[]
```

---

## 6-respostas-prontas
**Perguntaram:** Que respostas prontas a gente já tem cadastradas? Lista o nome de cada uma pra mim.
**Esperado:** crm_list_message_templates
**Ferramentas chamadas:** NENHUMA
**Status:** failed

**O que o agente respondeu:**

(vazia)

**Chamadas cruas:**

```json
[]
```

---

## 7-automacoes-e-falhas
**Perguntaram:** Alguma automação nossa falhou nas últimas horas? Quero saber quais estão ligadas e se alguma deu erro.
**Esperado:** crm_list_automation_rules + crm_list_automation_runs
**Ferramentas chamadas:** NENHUMA
**Status:** failed

**O que o agente respondeu:**

(vazia)

**Chamadas cruas:**

```json
[]
```

---

## 8-desligar-automacao
**Perguntaram:** Desliga a automação de boas-vindas agora, ela está disparando na hora errada e o pessoal está reclamando.
**Esperado:** crm_set_automation_rule_active (pode bater em papel/apenasHumano)
**Ferramentas chamadas:** NENHUMA
**Status:** failed

**O que o agente respondeu:**

(vazia)

**Chamadas cruas:**

```json
[]
```

---

## 9-quem-pode-mexer
**Perguntaram:** Quem está no nosso time hoje e quem pode mexer no funil? Preciso saber a quem pedir uma alteração.
**Esperado:** crm_list_team_members — território de papel de acesso
**Ferramentas chamadas:** NENHUMA
**Status:** failed

**O que o agente respondeu:**

(vazia)

**Chamadas cruas:**

```json
[]
```

---

## 10-mandar-resposta-pronta
**Perguntaram:** Pega a resposta pronta de confirmação de consulta, preenche com o nome do paciente e me mostra como vai ficar.
**Esperado:** crm_render_message_template
**Ferramentas chamadas:** NENHUMA
**Status:** failed

**O que o agente respondeu:**

(vazia)

**Chamadas cruas:**

```json
[]
```