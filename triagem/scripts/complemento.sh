#!/usr/bin/env bash
# Mecaniza o passe 4 do TRIAGEM.md — o complemento do CI, PR a PR.
# Uso: complemento.sh <numero-do-pr>
# Saída: linhas "CHAVE<TAB>VALOR". Toda linha é medição, nenhuma é veredito.
set -uo pipefail
N="$1"
cd "$(git rev-parse --show-toplevel)"

DIFF=$(gh pr diff "$N" 2>/dev/null)
FILES=$(gh pr view "$N" --json files --jq '.files[].path' 2>/dev/null)
SHA=$(git rev-parse "refs/tri/$N" 2>/dev/null || gh pr view "$N" --json headRefOid --jq .headRefOid 2>/dev/null)

p(){ printf '%s\t%s\n' "$1" "$2"; }

p pr "$N"
p sha "$SHA"

# --- prévia do merge (passe 3): gates rodam no merge, não na branch ---
if ! git cat-file -e "${SHA}^{commit}" 2>/dev/null; then
  p previa_merge "NAO MEDIDO — objeto $SHA ausente no clone (rode: git fetch origin pull/$N/head)"
else
  MT=$(git merge-tree --write-tree origin/main "$SHA" 2>&1); MTRC=$?
  if [ $MTRC -eq 0 ]; then p previa_merge "LIMPA tree=$(echo "$MT" | head -1)"
  else
    p previa_merge "CONFLITO rc=$MTRC"
    echo "$MT" | grep -oE '^(CONFLICT[^)]*\)|[0-9]+ [0-9a-f]+ [123]\t.*)' | head -10 | sed 's/^/\tconflito\t/'
  fi
fi

# --- 1. tripla de migration ---
MIG=$(echo "$FILES" | grep -c '^supabase/migrations/[0-9].*\.sql$')
if [ "$MIG" -gt 0 ]; then
  BL=$(echo "$FILES" | grep -c '^supabase/baseline.sql$')
  MF=$(echo "$FILES" | grep -c '^supabase/migrations/MANIFEST.md$')
  p migration_tripla "migrations=$MIG baseline=$BL manifest=$MF $([ "$BL" -ge 1 ] && [ "$MF" -ge 1 ] && echo COMPLETA || echo INCOMPLETA)"
  for f in $(echo "$FILES" | grep '^supabase/migrations/[0-9].*\.sql$'); do
    NUM=$(basename "$f" | sed -E 's/^[0-9]+_([0-9]{4})_.*/\1/')
    COLIDE=$(git ls-tree --name-only origin/main supabase/migrations/ | grep -c "_${NUM}_")
    p migration_num "$NUM arquivo=$(basename "$f") colide_na_main=$COLIDE"
  done
  # constraint sem dedup prévio
  echo "$DIFF" | grep -qiE '^\+.*(add constraint|unique \(|check \()' && p migration_constraint "SIM — confira dedup ANTES da constraint"
  echo "$DIFF" | grep -qiE '^\+.*(create table|add column)' && \
    { echo "$DIFF" | grep -qiE 'if not exists' && p migration_idempotente "tem 'if not exists'" || p migration_idempotente "SEM 'if not exists' — reprova update.sh"; }
else p migration_tripla "n/a"; fi

# --- 2. RLS de tabela tenant-aware nova ---
NOVAS=$(echo "$DIFF" | grep -iE '^\+\s*create table' | sed -E 's/.*create table[^a-z_]*(if not exists )?//I' | awk '{print $1}' | tr -d '(' | sort -u)
if [ -n "$NOVAS" ]; then
  p tabela_nova "$(echo "$NOVAS" | tr '\n' ' ')"
  echo "$DIFF" | grep -qi 'enable row level security' && p rls_enable "SIM" || p rls_enable "AUSENTE — bloqueador"
  echo "$DIFF" | grep -qi 'tenant_isolation_' && p rls_policy "SIM" || p rls_policy "AUSENTE"
  echo "$DIFF" | grep -q 'rls-isolation.test.ts' && p rls_lista_fixa "tabela acrescentada ao TABLES" || p rls_lista_fixa "NAO acrescentada ao TABLES de rls-isolation.test.ts"
else p tabela_nova "n/a"; fi

# --- security definer exposta ---
if echo "$DIFF" | grep -qi 'security definer'; then
  echo "$DIFF" | grep -qiE 'revoke execute on function.*from.*(public|anon)' && p definer_revoke "tem revoke" || p definer_revoke "security definer SEM revoke — as DUAS origens"
fi

# --- 4. console.log (no-console é warn, o CI não reprova) ---
CL=$(echo "$DIFF" | grep -cE '^\+[^-].*console\.log')
p console_log "$CL $([ "$CL" -gt 0 ] && echo '— DoD 8, nenhum gate reprova' || echo)"

# --- 5. env var nova ---
if echo "$FILES" | grep -qE '^(lib/env.ts|\.env\.example)$'; then
  E1=$(echo "$FILES" | grep -c '^lib/env.ts$'); E2=$(echo "$FILES" | grep -c '^\.env\.example$')
  p env_var "env.ts=$E1 .env.example=$E2 $([ "$E1" = "$E2" ] && echo 'os dois' || echo 'SÓ UM — o outro falta')"
  echo "$DIFF" | grep -E '^\+' | grep -E 'z\.string\(\)' | grep -v 'optional\|default' | head -3 | sed 's/^/\tenv_required\t/'
fi

# --- 6. kit self-host ---
echo "$FILES" | grep -qE '^(hostgator-setup-kit/|docker-compose|Dockerfile|scripts/.*\.sh)' \
  && p kit_selfhost "SIM — exige install fresh + update idempotente + GET externo" || p kit_selfhost "n/a"

# --- 8. catraca de canal ---
if echo "$FILES" | grep -qE '\.(ts|tsx)$'; then
  KD=$(git show origin/main:scripts/lint-channels.ts 2>/dev/null | grep -oE '"[^"]+\.(ts|tsx)"' | tr -d '"' | sort -u)
  HIT=$(comm -12 <(echo "$FILES" | sort -u) <(echo "$KD" | sort -u) | tr '\n' ' ')
  [ -n "${HIT// /}" ] && p catraca_canal "toca KNOWN_DEBT: $HIT" || p catraca_canal "nao toca KNOWN_DEBT"
fi

# --- 9. workflows de fork ---
echo "$FILES" | grep -q '^\.github/workflows/' && p workflow_fork "SIM — leitura linha a linha obrigatoria" || p workflow_fork "n/a"
echo "$DIFF" | grep -q 'pull_request_target' && p workflow_target "pull_request_target NO DIFF — bloqueador"

# --- 7. falha-em-verde ---
echo "$DIFF" | grep -qiE '^\+.*(healthcheck|conclu[ií]d|sucesso|success|"ok"|status.*online)' \
  && p falha_em_verde "o PR declara sucesso em algum ponto — qual sonda? mede o caminho do usuario?"

# --- passe 12: versao ---
FR=$(echo "$FILES" | grep -c '^\.changes/')
p fragmento ".changes=$FR $([ "$FR" -gt 0 ] && echo "$(echo "$DIFF" | grep -oE '^\+(tipo|impacto): *[a-z_]+' | head -1)" || echo 'AUSENTE — escrever se muda comportamento')"
CH=$(echo "$DIFF" | grep -cE '^\+## \[[0-9]+\.[0-9]+\.[0-9]+\]')
p changelog_a_mao "$CH $([ "$CH" -gt 0 ] && echo '— BLOQUEADOR' || echo '(vazio e o esperado)')"

# --- DoD 14: tela nova tem porta ---
NOVAPAG=$(echo "$FILES" | grep -cE '^app/.*/page\.tsx$')
if [ "$NOVAPAG" -gt 0 ]; then
  echo "$FILES" | grep -q 'lib/navigation/registry.ts' && p porta_navegacao "registry.ts tocado" || p porta_navegacao "$NOVAPAG page.tsx SEM tocar lib/navigation/registry.ts"
fi

# --- teste acompanha comportamento ---
TS=$(echo "$FILES" | grep -cE '(\.test\.ts|\.spec\.ts)$')
SRC=$(echo "$FILES" | grep -cE '^(app|lib|components|hooks|workers)/.*\.(ts|tsx)$' )
p teste "arquivos_de_teste=$TS arquivos_de_fonte=$SRC $([ "$SRC" -gt 0 ] && [ "$TS" -eq 0 ] && echo '— muda fonte SEM teste' || echo)"

# ---------------------------------------------------------------------------
# Pré-requisito: o head do PR tem de existir no clone, senão TODA prévia do
# merge sai como "CONFLITO" e o número é do instrumento, não do PR.
#   git fetch origin --force $(for n in $(gh pr list --state open --limit 100 \
#     --json number --jq '.[].number'); do printf "pull/%s/head:refs/tri/%s " "$n" "$n"; done)
# Medido em 14/set: sem isso, 74 de 74 prévias sairiam vermelhas.
