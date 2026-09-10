#!/bin/sh
set -e

# Resolve a URL de conexão (prioriza admin com permissão de DDL)
DB_URL="${SUPABASE_DB_ADMIN_URL:-$SUPABASE_DB_URL}"

if [ -z "$DB_URL" ]; then
  echo "❌ [db-migrate] Nenhuma URL de banco configurada em SUPABASE_DB_ADMIN_URL ou SUPABASE_DB_URL."
  exit 1
fi

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
if [ ! -d "$MIGRATIONS_DIR" ]; then
  # Fallback se executado fora do container Docker
  MIGRATIONS_DIR="./supabase/migrations"
fi

echo "🚀 [db-migrate] Conectando ao banco de dados..."

# 1. Garante schema e tabela de rastreamento de migrations
psql "$DB_URL" -v ON_ERROR_STOP=1 << 'EOSQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text PRIMARY KEY,
    name text
);
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS applied_at timestamptz DEFAULT now();
EOSQL

# 2. Se o banco já possui tabelas (ex: public.organizations existe), mas a tabela de migrations
# tem poucas migrations registradas (< 50), significa que foi criado via baseline.sql/dump.
# Registramos as migrations do snapshot inicial (< 20260906020000 / migration 0222) como aplicadas
# para não tentar reexecutar DDLs de 2024 que já estão no schema inicial.
HAS_ORG=$(psql "$DB_URL" -t -A -c "SELECT to_regclass('public.organizations') IS NOT NULL;")
COUNT_APPLIED=$(psql "$DB_URL" -t -A -c "SELECT count(*) FROM supabase_migrations.schema_migrations;")

if [ "$HAS_ORG" = "t" ] && [ "$COUNT_APPLIED" -lt 50 ]; then
  echo "📦 [db-migrate] Banco existente detectado. Carimbando migrations do baseline inicial (< 0222)..."
  (
    echo "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES "
    FIRST=1
    for f in "$MIGRATIONS_DIR"/*.sql; do
      fname=$(basename "$f")
      ver=$(echo "$fname" | cut -d'_' -f1)
      if [ "$ver" \< "20260906020000" ]; then
        name=$(echo "$fname" | sed "s/^${ver}_//" | sed 's/\.sql$//')
        if [ "$FIRST" -eq 1 ]; then
          FIRST=0
        else
          echo ","
        fi
        printf "('%s', '%s')" "$ver" "$name"
      fi
    done
    echo " ON CONFLICT (version) DO NOTHING;"
  ) | psql "$DB_URL" >/dev/null
fi

# 3. Busca lista de versões já aplicadas no banco
APPLIED=$(psql "$DB_URL" -t -A -c "SELECT version FROM supabase_migrations.schema_migrations;")

echo "🔎 [db-migrate] Verificando migrations pendentes..."

PENDING=0
for f in $(ls -1 "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  fname=$(basename "$f")
  ver=$(echo "$fname" | cut -d'_' -f1)

  # Pula se já estiver registrada no banco
  if echo "$APPLIED" | grep -qx "$ver"; then
    continue
  fi

  name=$(echo "$fname" | sed "s/^${ver}_//" | sed 's/\.sql$//')
  echo "⏳ [db-migrate] Aplicando migration pendente: $fname"

  # Executa a migration com fail-closed em caso de erro
  if psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"; then
    psql "$DB_URL" -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('$ver', '$name') ON CONFLICT (version) DO NOTHING;" >/dev/null
    echo "✅ [db-migrate] Migration $fname aplicada com sucesso."
    PENDING=$((PENDING + 1))
  else
    echo "❌ [db-migrate] Falha ao aplicar migration $fname. Interrompendo deploy."
    exit 1
  fi
done

if [ "$PENDING" -eq 0 ]; then
  echo "✨ [db-migrate] Todas as migrations já estão aplicadas! Nenhuma ação necessária."
else
  echo "🎉 [db-migrate] Concluído: $PENDING migration(s) pendente(s) aplicada(s) com sucesso!"
fi
