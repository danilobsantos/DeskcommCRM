---
impacto: capacidade_nova
secao: corrigido
titulo: Compromissos de profissionais externos voltam a sincronizar com o Google
---

O envio ao Google de compromissos atendidos por profissionais externos parou de funcionar: a tarefa de sincronização recusava com erro interno antes de resolver a agenda de destino. A causa era uma atualização de banco que reescreveu a função de sincronização a partir de uma versão antiga, sem os trechos do profissional. A função foi republicada com os dois comportamentos (destino pelo vínculo do profissional e limpeza de erro de rodada ociosa). Não é preciso configurar nada.
