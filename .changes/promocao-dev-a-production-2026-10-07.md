---
impacto: capacidade_nova
secao: alterado
titulo: Sync com o produto (829 commits) promovido à production
---

Esta promoção leva a `production` ao sync da `dev` com a `main` do produto (`c71a27af`, 829 commits à frente do espelho anterior): 21 migrations novas do produto (faixa 0543–0590) aplicadas pelo `db-migrate` antes do app subir, com parada em erro em vez de aplicação parcial. Nenhuma migration do fork nesta leva (o bloco 9001–9017 já estava na production pelos PRs #33–35).

Para quem opera no Dokploy, o que muda na prática: contatos pessoais (`is_personal`, Spec 21 — pessoal não recebe aviso nem entra no RAG), toggle de canal desativado com dedupe no banco, nome de sessão WAHA com teto recusado pelo banco, acervo de histórico do WAHA como opção por conexão, videochamada via Jitsi (URL pública de runtime), preços dos Gemini lite no motor de custo (o teto volta a enxergar a 3.x), casca mobile em `dvh` com área segura do iOS, e lista do inbox sem skeleton no refetch. Imagens `conecta-*` mantidas — nada muda nos nomes que o deploy puxa; WAHA segue pinado em `latest-2026.9.2`.

Antes de promover: `pg_dump` do banco, como sempre. Depois do deploy, conferir `GET /api/v1/health` (`version` = SHA da promoção), sessões WAHA `WORKING` em engine `NOWEB`, e `count(*) schema_migrations` batendo com o número de arquivos.
