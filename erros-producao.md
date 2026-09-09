# Plano de Resolução: Erros Recorrentes em Produção (Dokploy / VPS)

> **Slug:** `erros-producao`  
> **Status:** Proposto / Planejamento  
> **Responsável Principal:** `orchestrator` / `backend-specialist`  
> **Agentes Especialistas:** `database-architect`, `backend-specialist`, `security-auditor`  
> **Prioridade:** P0 (Crítico)

---

## 1. Visão Geral e Diagnóstico das Falhas

A análise dos logs de produção revelou 3 anomalias ativas que afetam a confiabilidade do sistema:

| Severidade | Erro / Log | Causa Raiz Identificada no Código / Infra | Impacto |
|---|---|---|---|
| 🔴 **P0** | `[media-derive] failed permanently — getaddrinfo EAI_AGAIN db` | 1. O serviço `app` no [docker-compose.dokploy.yml](docker-compose.dokploy.yml) **não está conectado à rede `supabase`**, impedindo a resolução DNS do host `db`.<br>2. `workers/media-derive-worker.ts` marca mídia como falha permanente após 5 tentativas mesmo em erros transientes de DNS. | Transcrições de áudio WhatsApp (Whisper) e visão multimodal de imagens são descartadas permanentemente. |
| 🔴 **P0** | `[attendant-heartbeat] sweep failed: column attendant_availability.last_heartbeat_at does not exist` | No commit `37cd7df9`, a coluna `last_heartbeat_at` foi adicionada apenas ao final de `supabase/baseline.sql`, **sem gerar a migration correspondente em `supabase/migrations/` nem no `MANIFEST.md`**. O banco em produção está com schema defasado. | O cron de heartbeat falha a cada 5 min; auto-offline de atendentes inativos não funciona. |
| 🟡 **P1** | `MaxListenersExceededWarning: 11 close listeners added to [ServerResponse]` | Empilhamento de listeners de `'close'` no `ServerResponse` do Node.js causado pela combinação de Next.js 16 + `@sentry/nextjs` (v10) + OpenTelemetry e middlewares. O limite padrão de 10 do Node foi ultrapassado por 1 listener. | Poluição de logs e risco potencial de degradação de memória em alta concorrência. |
| ℹ️ **Info** | `event-log-drain failed: 1` | Consequência direta do erro de rede do `media-derive` (ao falhar o handler, o drain contabiliza falha no lote). | Normaliza assim que o `media-derive` voltar a conectar. |

---

## 2. Perguntas Socráticas & Decisões Arquiteturais (Socratic Gate)

1. **Topologia de Rede no Dokploy:**
   - O `docker-compose.dokploy.yml` define o serviço `app` com as redes `[internal, proxy]`, enquanto `worker` e `db-migrate` utilizam `[internal, proxy, supabase]`.
   - *Decisão necessária:* Adicionar a rede `supabase` ao serviço `app` para permitir acesso direto ao host `db:5432` através do pool Postgres (`SUPABASE_DB_URL`).
2. **Política de Retry do `media-derive`:**
   - Erros transientes de infraestrutura (`EAI_AGAIN`, `ECONNREFUSED`, `ETIMEDOUT`) devem consumir tentativas normais de processamento de mídia ou emitir status `retry` com backoff sem marcar `media_derived_status: "failed"`?
   - *Recomendação:* Diferenciar erro de mídia inválida (fatal) de falha de conexão com banco/provedor (transiente), devolvendo `{ status: "retry" }` no dispatcher do `event_log`.
3. **Padrão de Migrations:**
   - Toda alteração de schema deve seguir a Doutrina de Migrations do DeskcommCRM:
     `supabase/migrations/YYYYMMDDHHMMSS_9004_*.sql` + `supabase/baseline.sql` + `supabase/migrations/MANIFEST.md`.

---

## 3. Plano de Tarefas Detalhado

### Fase 1: Correção Imediata de Infraestrutura e Conectividade (P0)
- [ ] **T1.1 (Compose Dokploy):** Adicionar a rede `supabase` ao container `app` em [docker-compose.dokploy.yml](docker-compose.dokploy.yml).
  - *Arquivo:* `docker-compose.dokploy.yml`
  - *Ação:* Inserir `- supabase` sob `services.app.networks`.
  - *Critério de Aceite:* Container `app` é capaz de resolver `getent hosts db` e conectar na porta 5432.
- [ ] **T1.2 (Resiliência do Worker):** Melhorar o tratamento de erros em [workers/media-derive-worker.ts](workers/media-derive-worker.ts).
  - *Arquivo:* `workers/media-derive-worker.ts`
  - *Ação:* Não invocar `markFailed()` quando o erro for erro de rede/DNS (`EAI_AGAIN`, `ECONNREFUSED`, etc.). Retornar `{ consumer_key, status: "retry" }` para o drain aplicar backoff exponencial.
  - *Critério de Aceite:* Teste unitário simulando erro de conexão não marca a mensagem como `failed`.

### Fase 2: Correção de Schema e Migrations (P0)
- [ ] **T2.1 (Migration Versionada):** Criar migration padronizada na faixa fork (`9000+`).
  - *Arquivo Novo:* `supabase/migrations/20260907184000_9004_attendant_heartbeat_column.sql`
  - *Conteúdo:*
    ```sql
    -- 9004_attendant_heartbeat_column — garante last_heartbeat_at para bancos legados
    alter table public.attendant_availability
      add column if not exists last_heartbeat_at timestamptz;
    ```
- [ ] **T2.2 (Manifesto de Migrações):** Registrar a migration em [supabase/migrations/MANIFEST.md](supabase/migrations/MANIFEST.md).
  - *Arquivo:* `supabase/migrations/MANIFEST.md`
  - *Ação:* Adicionar a linha da migration `9004_attendant_heartbeat_column`.
- [ ] **T2.3 (Execução em Produção):** Executar comando DDL direto no banco de produção (ou via `db-migrate` do Dokploy).
  - *Comando:* `ALTER TABLE public.attendant_availability ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;`
  - *Critério de Aceite:* `[attendant-heartbeat] sweep failed` deixa de ocorrer nos logs do cron.

### Fase 3: Investigação e Mitigação do EventEmitter Leak (P1)
- [ ] **T3.1 (Configuração de MaxListeners / Instrumentation):**
  - *Arquivo:* `instrumentation.ts` e/ou `sentry.server.config.ts`
  - *Ação:* Configurar limite adequado de listeners no Node.js (`require('events').EventEmitter.defaultMaxListeners = 30` ou `setMaxListeners`) no bootstrap do servidor para acomodar o tracing conjunto de Next.js + Sentry + OpenTelemetry.
- [ ] **T3.2 (Ativação de Rastreio em Staging/Produção):**
  - Configurar `NODE_OPTIONS='--trace-warnings'` na variável de ambiente do container `app` temporariamente para capturar a stack trace exata caso algum listener não esteja sendo liberado.

### Fase 4: Reprocessamento de Mídias Afetadas (P1)
- [ ] **T4.1 (Query de Reativação):** Criar script ou query segura para reprocessar mensagens que ficaram presas em `media_derived_status = 'failed'` devido à queda de DNS.
  - *Critério de Aceite:* Mensagens das últimas 24h com status `failed` são recolocadas na fila de `event_log` com `event_type = 'media.derive_requested'`.

---

## 4. Plano de Verificação e Testes

1. **Testes Locais & Invariantes:**
   - `pnpm test:unit tests/unit/media-derive-worker.test.ts`
   - `pnpm test:unit tests/unit/cron-audita-so-quando-ha-efeito.test.ts`
   - `pnpm gov:verify` (typecheck + lint + unit tests)
2. **Validação de Schema:**
   - Verificar se `pnpm test:db` (ou script de validação de migrations) passa com o novo manifesto e migration 9004.
3. **Validação em Produção (Checklist de Deploy):**
   - Executar `docker compose -f docker-compose.dokploy.yml exec app ping -c 1 db` ou `nc -zvw3 db 5432` para confirmar resolução DNS.
   - Observar logs do `scheduler`:
     - Cron `/api/v1/cron/attendant-heartbeat` retornando status 200.
     - Cron `/api/v1/cron/event-log-drain` retornando `{ failed: 0 }`.
   - Confirmar ausência do alerta `MaxListenersExceededWarning`.
