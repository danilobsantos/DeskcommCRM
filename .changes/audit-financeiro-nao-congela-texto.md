---
impacto: nada_mudou
secao: corrigido
titulo: O que a equipe escreve sobre um cliente deixa de ficar congelado no registro de auditoria
---

Três ações do módulo financeiro — alterar uma comanda, estornar uma comanda e
lançar pontos de fidelidade — gravavam no registro de auditoria o texto livre que
a equipe escreve **sobre a pessoa**: a observação da comanda, o motivo do estorno,
a justificativa dos pontos.

O registro de auditoria é a única tabela do sistema que ninguém pode alterar nem
apagar — nem o próprio servidor, por desenho, para que ele sirva de prova. É o que
o torna confiável, e é também o que torna isso um problema: quando um cliente
exerce o direito de ser esquecido, a anonimização apaga a observação da comanda e
**não alcança** a cópia que ficou na auditoria. A frase sobrevivia ao pedido, pelo
tempo inteiro de retenção.

Agora a auditoria guarda o que descreve o **ato** — que a observação mudou, que
houve motivo e de que tamanho, quantos pontos foram lançados — e nunca o texto. A
pergunta que a auditoria existe para responder ("quem alterou a comanda 42, e
quando?") continua respondida. O texto em si segue guardado onde a anonimização
chega: na própria comanda e no extrato de fidelidade.

Quem opera não precisa fazer nada. Registros gravados antes desta versão continuam
como estão — eles não podem ser reescritos, e essa é exatamente a razão do
conserto.
