---
impacto: nada_mudou
secao: corrigido
titulo: O logo da organização volta a salvar quando o banco tem o overload legado
---

Em bancos que chegaram ao logo dual por migrações incrementais, a função que
grava o logo da organização ficou com DOIS overloads: a versão de antes (3
argumentos) e a nova (4 argumentos). Quem chamasse a antiga — o que acontece no
rollback de imagem — fazia o banco responder "não consigo escolher qual função",
e o logo deixava de gravar, com a tela acusando erro ao salvar.

A migration nova derruba a versão legada e deixa só a de 4 argumentos, que
resolve as duas chamadas. A atualização normal da stack aplica isto sozinho.

Para quem opera uma instalação, nada muda no dia a dia: nenhuma configuração
nova, nenhum passo manual. O `update.sh` já aplica o baseline.