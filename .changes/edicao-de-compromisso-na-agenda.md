---
impacto: capacidade_nova
secao: adicionado
titulo: Compromisso da agenda se edita pela tela
---

O detalhe do compromisso só confirmava presença, adiava e cancelava — corrigir o nome, trocar o paciente, mudar o tipo ou ajustar a observação exigia cancelar e marcar de novo. Agora o detalhe tem o botão **Editar compromisso**: ele abre o formulário já preenchido (título, paciente, horário, tipo, observação) e grava pelo `PATCH /api/v1/agenda/agendamentos`, mandando somente os campos que realmente mudaram e com a mesma proteção de revisão concorrente dos botões de presença.

Trocar o paciente pede confirmação antes de gravar, avisando que o convite na agenda do Google muda junto (o anterior sai, o novo entra) — e a conversa vinculada anda junto com o paciente, para o compromisso novo não apontar para o atendimento de outra pessoa. Trocar o tipo recalcula o fim pela nova duração e revalida a disponibilidade, como uma remarcação. Marcar com paciente e sem título passa a usar o nome do cliente como título, na tela, na IA e na integração.
