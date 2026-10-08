---
impacto: capacidade_nova
secao: alterado
titulo: Sync com o produto (502 commits) promovido à production
---

Esta promoção leva a `production` ao sync da `dev` com a `main` do produto (`4d7b3f32`, 502 commits à frente de `c71a27af`): 12 migrations novas do produto aplicadas pelo `db-migrate` antes do app subir, com parada em erro em vez de aplicação parcial. Nenhuma migration do fork nesta leva (o bloco 9015–9019 já estava na production pelo PR #37).

Para quem opera no Dokploy, o que muda na prática: cobrança do revendedor (planos, assinaturas e régua via Stripe, com faixas e avisos na Central), uso de IA agregado no banco (custo por tenant passa a sair do banco, não só do runtime), publicar com login por assinatura, campos personalizados por fonte no formulário de captação, recorte da janela nas métricas, CPF cifrado em repouso, catálogo Gemini 3.x (3.1 Flash-Lite, 3.5 Flash-Lite, 3.6/3.7/3.8 Flash) com preços Standard no motor de custo, webhook de cobrança com avisos, compilador do módulo de dados, push só para quem vê a conversa, e catálogo oficial de extensões instalável. Na Central, os avisos passam a acumular contato (nome/número, do fork) com link de pagamento da cobrança (do produto) no mesmo card. Imagens `conecta-*` mantidas — nada muda nos nomes que o deploy puxa; WAHA segue pinado.

Antes de promover: `pg_dump` do banco, como sempre. Depois do deploy, conferir `GET /api/v1/health` (`version` = SHA da promoção), sessões WAHA `WORKING` em engine `NOWEB`, e `count(*) schema_migrations` batendo com o número de arquivos.
