---
impacto: capacidade_nova
secao: alterado
titulo: Promoção da dev à production com produto 1.72.0 e apêndice do baseline em dia
---

Esta promoção leva a `production` ao estado da `dev`: o produto da 1.63.x à 1.72.0 (265 commits — radar conhecendo demandas com deep-link, escopo de contato no turno do agente, HMAC no webhook do WAHA, profissionais externos na agenda) mais a quitação das dívidas do apêndice do `baseline.sql` (sessão WAHA curta, catálogo Gemini 3.x com `gemini-3.1-flash-lite`, tabela `providers`, trava do logo dark) e a migration 9012 (travas de suporte em `providers`).

Para quem opera no Dokploy, o prático: `pg_dump` antes, como sempre. A 9012 aplica sozinha pelo `db-migrate` antes do app subir — troca a policy de escrita de `providers` para a função `_full` e aplica as travas de suporte; suporte em modo somente-leitura passa a ser bloqueado de verdade também nessa tabela, sem ação manual. O apêndice do baseline só muda instalação fresca (quem instala do zero agora nasce com providers, catálogo e sessão curta); quem atualiza não sente. As imagens `conecta-*` são mantidas — nada muda nos nomes que o deploy puxa.
