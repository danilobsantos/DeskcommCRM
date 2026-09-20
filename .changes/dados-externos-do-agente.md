---
impacto: capacidade_nova
secao: adicionado
titulo: Conecte um banco de dados de outro sistema e explore-o de dentro do CRM
---

Quando o seu outro sistema escreve num PostgreSQL — um segundo CRM, um ERP, a
base que a operação usa —, esses dados eram invisíveis aqui dentro. É ali que
costuma morar o que o cliente pergunta: pedido, assinatura, matrícula, saldo.

Agora essa base pode ser cadastrada e consultada pelo próprio CRM. O caminho é
**Organização › Dados e acesso › Dados externos**. Qualquer pessoa da equipe vê
a lista e explora os dados; só um administrador cadastra, edita ou remove a
conexão.

- **Somente leitura, de verdade.** A conexão roda em transação de leitura
  obrigatória, com tempo limite, e só aceita consultas de seleção. Nada que o
  CRM faz altera o banco de origem.
- **A senha é cifrada** com a mesma chave que o sistema já usa para as chaves de
  IA, e nunca é mostrada de volta — ao editar, o campo de senha nasce vazio.
  Nenhuma variável de ambiente nova, nenhum passo manual de atualização.
- **Nada de schema fixo.** As tabelas e os campos são lidos na hora, então
  quando o outro sistema muda, a tela já enxerga o novo formato.
- **Os tetos são seus.** Linhas por consulta, filtros e tamanho de resposta são
  configurados por conexão, dentro de faixas seguras.

Nada muda para quem não cadastrar nenhuma conexão: sem conexão, o recurso não
faz nada. Quem instala ou atualiza numa VPS recebe pelo procedimento de sempre
(`update.sh`) — a mudança de banco entra junto do baseline.

Trabalho de @vgamkt, recortado do PR #1130.
