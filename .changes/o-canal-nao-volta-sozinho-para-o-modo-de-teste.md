---
impacto: nada_mudou
secao: corrigido
titulo: O canal não volta sozinho para o modo de teste depois de aberto ao público
---

O modo de acesso da IA de um canal mora em três chaves de metadata: uma diz se o
canal está aberto, em allowlist por origem ou em lista de testadores; outra diz
se ele está em pré-go-live. Ao abrir o canal ao público, a segunda chave era
gravada sempre com o mesmo valor — "em teste" — mesmo quando o canal já não
estava em teste. Sozinha, a chave errada não mudava nada. Na volta, sim: o script
que liga o allowlist POR ORIGEM gravava só a primeira chave, então o canal
reaparecia em modo de teste com a lista de testadores antiga, em vez de atender
quem tem autorização por origem. A IA parava de responder a quem deveria atender
sem erro nenhum na tela, e o próprio simulador do script prometia que o contato
seria atendido.

Agora as duas chaves andam juntas nas duas pontas: abrir ao público tira o canal
do teste, e o script escreve o alvo nos dois campos — recusando a gravação se o
motor continuaria lendo modo de teste. O simulador do script passou a prometer o
mesmo veredito que o motor executa.

Canais que hoje estão abertos com a chave velha continuam abertos: ela sai na
próxima gravação da tela ou do script. Você não precisa fazer nada para adotar.

Achado e corrigido por @webtecnica.
