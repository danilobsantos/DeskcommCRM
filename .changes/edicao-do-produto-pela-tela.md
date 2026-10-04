---
impacto: capacidade_nova
secao: adicionado
titulo: O produto se edita pela tela do catálogo
---

Quem administra corrigia um preço ou uma descrição do catálogo só reimportando a planilha — e a importação, de propósito, não grava `descricao` nem `ativo`. Agora a tela Produtos tem o botão **Editar**: ele abre o formulário já preenchido com o que está cadastrado e grava pelo `PATCH /api/v1/products/:id` que a API já aceitava, mandando para o servidor somente os campos que realmente mudaram (sem mudança, a tela avisa e não faz chamada nenhuma).

Produtos sincronizados de uma integração (`origem` que não seja `manual` nem `planilha`) abrem o formulário **somente leitura**, com o aviso de que a edição vale na origem: a próxima sincronização sobrescreveria o que fosse mudado aqui. As fotos continuam editáveis pelo botão de sempre, porque a integração não mexe nelas.

Contribuição de @webtecnica.
