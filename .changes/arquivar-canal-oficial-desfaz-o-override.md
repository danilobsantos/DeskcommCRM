---
impacto: nada_mudou
secao: corrigido
titulo: Arquivar um canal oficial devolve o webhook do número à Meta
---
Conectar um canal oficial da Meta aponta o webhook daquele número para esta instalação. Ao
arquivar ou excluir o canal, essa configuração ficava órfã na Meta: o token do caminho do
webhook era rotacionado e a credencial apagada, e a Meta seguia entregando num endereço que
responde 404 para sempre — sem erro nenhum do nosso lado, porque a entrega nem chegava aqui.
Agora o número volta para a URL do app antes de a credencial ser apagada, que é a última
chance de a chamada ser autenticada. Se a Meta recusar, nada muda para o operador: o
arquivamento (ou a exclusão) que ele pediu acontece do mesmo jeito e a recusa fica no log e
na auditoria.
