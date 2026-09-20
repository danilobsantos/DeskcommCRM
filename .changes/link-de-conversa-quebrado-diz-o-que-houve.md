---
impacto: nada_mudou
secao: corrigido
titulo: Link de conversa quebrado passa a dizer o que aconteceu, em vez de abrir uma tela vazia
---

Abrir um link de conversa com endereço estragado — copiado pela metade, vindo de
um sistema externo, ou de uma conversa que já não existe — levava a uma tela que
parecia uma conversa de verdade e estava vazia. Não dava para saber se a conversa
não existia, se estava sem mensagens, ou se algo tinha falhado: os três estados
tinham a mesma aparência.

Agora a tela diz **"Conversa não encontrada ou fora do seu acesso"**, a mesma
mensagem que já aparecia quando o link aponta para conversa de outra empresa.

Nos bastidores, esse link também deixa de virar erro de servidor no registro da
instalação: quem administra a VPS para de ver falhas registradas que nunca foram
falha de nada — eram só um endereço mal formado.

Nada a fazer na atualização.
