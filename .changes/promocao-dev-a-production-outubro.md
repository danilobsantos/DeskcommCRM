---
impacto: capacidade_nova
secao: alterado
titulo: Promoção da dev à production com update mais seguro e WAHA 9.2
---

Esta promoção leva a `production` ao estado da `dev` (cerca de 209 migrations, da 0238 à 0533 mais o bloco 9009–9011): suspensão tipada de organização, `support_readonly` sem escrita, escada de transcrição de áudio, catálogo de temas por gancho, motivo de perda "pediu para não receber" e o painel de preflight do update.

Para quem opera no Dokploy, três mudanças práticas. Primeiro, o `update.sh` agora faz preflight antes de parar qualquer coisa, confere as regras de isolamento em três versões do script e reverte os pins de versão sozinho se algo não subir — atualização cega virou exceção. Segundo, o compose do Dokploy não compila mais na VPS (`build:` removido, `pull_policy: always`): o deploy puxa as imagens `conecta-*` publicadas. Terceiro, o WAHA sobe de `latest-2026.7.2` para `latest-2026.9.2` (tag fixa por versão; sessões preservadas no volume, religamento automático já configurado).

Antes de promover: `pg_dump` do banco. As migrations aplicam pelo `db-migrate` antes do app subir, com parada em erro em vez de aplicação parcial. As imagens `conecta-*` são mantidas — nada muda nos nomes que o deploy puxa.
