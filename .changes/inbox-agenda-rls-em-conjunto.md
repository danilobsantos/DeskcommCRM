---
impacto: nada_mudou
secao: corrigido
titulo: Inbox, agenda e tarefas deixam de recalcular a visibilidade uma vez por linha
---

O banco decidia quem vê cada conversa, compromisso e tarefa executando a mesma função de visibilidade para CADA linha — e o Realtime reavalia a regra a cada mudança. Numa inbox grande isso aparecia como lentidão e como erros de tempo limite. A regra passa a ser calculada uma vez por consulta, em conjunto: o resultado é o mesmo (inclusive o modo "Só os seus", a opção de agenda dos colegas e a sessão de suporte), e não é preciso configurar nada.

A foto do contato no aviso de mensagem nova também deixou de depender de um redirecionamento entre domínios que o navegador recusava; a rota entrega a URL assinada no próprio corpo.
