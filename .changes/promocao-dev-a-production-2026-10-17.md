---
impacto: capacidade_nova
secao: alterado
titulo: Sync com o produto (1.78.0–1.85.0, 1689 commits) promovido à production
---

Esta promoção leva a `production` ao sync da `dev` com a `main` do produto (`e36bfc9e8`, 1689 commits à frente de `4d7b3f32`): 56 migrations aplicadas pelo `db-migrate` antes do app subir (55 do produto, 0594 e 0614–0692, mais a `9020` do fork), com parada em erro em vez de aplicação parcial. A `9020` conserta uma perda silenciosa da `0654` do produto — a troca de profissional na agenda e o push do Google externo sobrevivem à troca de `40001` por `PT409`; sem mudança visível para quem opera.

Para quem opera no Dokploy, o que muda na prática: instalação em VPS ARM64; editar contato direto da lista; Inbox e Contatos com seleção múltipla e ações em lote; histórico da conversa em PDF; carteira do vendedor (dono do cliente, avisado por tarefa); aviso configurável fora do horário (uma vez por contato por período fechado); assinatura do ChatGPT nos agentes, com login próprio; fontes liberadas do banco de dados externo; módulo opcional Empresas; ícone da aba do navegador em Marca; busca dentro da conversa; passo "a IA decide" nas automações; janela de resposta separada por número; playbooks do catálogo com versões e aviso de adoção; e o caso aberto pela IA aparece no sino na hora.

**Conferir antes ou logo depois de atualizar:** reconectar a assinatura do ChatGPT em IA › Credenciais (1.78.0); webhook do WAHA em outro servidor aponta para `/api/v1/webhooks/waha/<token-do-canal>` (1.78.0); ponte de Tray/Loja Integrada/WooCommerce precisa gravar a origem `external` antes do `update.sh` (1.79.0); escolher o canal do lembrete nos serviços com reserva manual (1.81.0); aprovar pedidos de dados da Nuvemshop em Organização › LGPD (1.81.0); conferir a visibilidade da agenda dos colegas (1.83.0); definir o **Plano do cadastro** com a cobrança ligada (1.84.0); e conferir o teto de gasto de IA se usa o provedor personalizado (1.85.0). O detalhe de cada um está nas seções das versões no `CHANGELOG.md`.

Imagens `conecta-*` mantidas — nada muda nos nomes que o deploy puxa; WAHA segue pinado. Antes de promover: `pg_dump` do banco, como sempre. Depois do deploy, conferir `GET /api/v1/health` (`version` = SHA da promoção), sessões WAHA `WORKING` em engine `NOWEB`, e `count(*) schema_migrations` batendo com o número de arquivos.
