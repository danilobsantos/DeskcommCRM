---
impacto: nada_mudou
secao: corrigido
titulo: O build do E2E e o smoke do LLM recusam na primeira linha quando falta o binário
---

Duas ferramentas internas podiam morrer no meio do trabalho por um motivo que já se sabia na primeira linha: o binário que faz o serviço não estava instalado. O build do E2E anunciava `==> Buildando contra ...` e só então esbarrava na falta do `next`; o smoke do LLM subia `==> subindo pgvector ...` para cair adiante. Nos dois, o que ficava na tela era o anúncio de um passo que não chegou a rodar.

Agora as duas recusam antes de qualquer trabalho, dizem qual binário falta e mandam rodar `pnpm install`.

Não muda nada para quem opera uma instalação — é ferramenta de quem desenvolve.
