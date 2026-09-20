---
impacto: nada_mudou
secao: corrigido
titulo: O verificador de banco avisa quando não consegue rodar, em vez de parecer que passou
---

Uma ferramenta interna de verificação do banco podia terminar **sem ter executado teste nenhum** e ainda assim deixar um registro cheio de marcas de sucesso: ela preparava o banco, aplicava o esquema duas vezes, e só então descobria que faltava a peça que roda os testes — num aviso perdido no meio de centenas de linhas verdes.

Quem lesse o resultado concluiria que tudo passou. Nada passou: nada rodou.

Agora ela recusa na primeira linha, diz o que faltou e qual comando usar. Não muda nada para quem opera uma instalação — é ferramenta de quem desenvolve.
