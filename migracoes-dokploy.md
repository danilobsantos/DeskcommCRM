# Plano de Implementação: Padronização de Migrations (Faixa 9000+) e Automação no Dokploy via Compose

## Visão Geral
Este plano estabelece a padronização das migrações exclusivas do fork na faixa **`9000+`** com timestamps únicos e a automação nativa da execução do banco no **Dokploy** via serviço `db-migrate` no [docker-compose.dokploy.yml](file:///Users/danilosantos/Documents/Workspace/DeskcommCRM/docker-compose.dokploy.yml).

Essa abordagem resolve simultaneamente:
1. **Conflito com o Upstream:** Evita qualquer colisão com as novas migrations `0208` a `0217` que vieram da `main`.
2. **Execução 100% Automática no Dokploy:** Não depende de opções de UI inexistentes no modo Compose do Dokploy — o Docker Compose executa o banco automaticamente antes de subir o aplicativo web em todo deploy.
3. **Preservação dos Dados:** Garante que os dados de logo dual já gravados no banco continuem intactos e seguros.

---

## Mudanças Propostas

### 1. Automação no Dokploy via Docker Compose

#### [MODIFY] [docker-compose.dokploy.yml](file:///Users/danilosantos/Documents/Workspace/DeskcommCRM/docker-compose.dokploy.yml)
- Adicionar o serviço efêmero `db-migrate`:
  ```yaml
  db-migrate:
    image: postgres:17-alpine
    restart: "no"
    env_file: .env
    volumes:
      - ./supabase/baseline.sql:/baseline.sql:ro
    command: >
      sh -c 'psql "$${SUPABASE_DB_ADMIN_URL:-$$SUPABASE_DB_URL}" -f /baseline.sql'
    networks:
      - internal
      - supabase
  ```
- Atualizar o serviço `app` para depender de `db-migrate`:
  ```yaml
  app:
    # ...
    depends_on:
      db-migrate:
        condition: service_completed_successfully
      srh:
        condition: service_started
      waha:
        condition: service_started
  ```

---

### 2. Padronização das Migrations Customizadas (Faixa 9000+)

#### [RENAME] Migrations Locais (com timestamps únicos e exclusivos)
- Renomear:
  - `supabase/migrations/20260904000000_0208_logo_dual.sql` → `supabase/migrations/20260906000001_9001_logo_dual.sql`
  - `supabase/migrations/20260905000000_0209_remove_overload_logo.sql` → `supabase/migrations/20260906000002_9002_remove_overload_logo.sql`
- *Nota:* O uso de timestamps distintos (`20260906000001` e `20260906000002`) impede colisão de chave primária no Supabase CLI com as migrations `0208` e `0209` do upstream (`20260904000000`).

#### [MODIFY] [supabase/migrations/MANIFEST.md](file:///Users/danilosantos/Documents/Workspace/DeskcommCRM/supabase/migrations/MANIFEST.md)
- Adicionar no final do arquivo as linhas correspondentes:
  ```markdown
  | `20260906000001` | `9001_logo_dual` | (Custom Fork) logo_path_dark em platform_branding e fn_definir_logo_da_organizacao com 4 argumentos |
  | `20260906000002` | `9002_remove_overload_logo` | (Custom Fork) remove overload legado de fn_definir_logo_da_organizacao para evitar PGRST203 |
  ```

#### [MODIFY] [supabase/baseline.sql](file:///Users/danilosantos/Documents/Workspace/DeskcommCRM/supabase/baseline.sql)
- Ajustar os comentários das seções correspondentes de:
  - `(migration 0208)` → `(migration 9001)`
  - `(migration 0209)` → `(migration 9002)`

---

### 3. Integração e Sincronização de Branches

1. **Merge de `main` em `dev`:**
   - Trazer as atualizações do upstream (0208 a 0217) para a branch `dev`. Como nossas migrations agora são `9001`/`9002`, não haverá conflito de nomes.
2. **Validação de Testes:**
   - Garantir que todos os testes passem localmente.
3. **Merge de `dev` para `production` (Orientação):**
   - Atualizar a branch `production` monitorada pelo Dokploy para disparar o Autodeploy.

---

## Plano de Verificação

### Testes Automatizados
- **Validação de Sintaxe do Compose:**
  ```bash
  docker compose -f docker-compose.dokploy.yml config
  ```
- **Governança de Migrations:**
  ```bash
  pnpm test:unit tests/unit/manifest-x-migrations.test.ts
  ```
- **Testes Unitários de Branding:**
  ```bash
  pnpm test:unit tests/unit/branding-marca-resolve.test.ts
  ```

### Verificação Manual
- Validar se o Dokploy executa o container `db-migrate` com sucesso antes do `app` iniciar.
