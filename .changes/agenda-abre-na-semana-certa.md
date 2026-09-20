---
impacto: nada_mudou
secao: corrigido
titulo: A Agenda abre na semana certa, mesmo à noite de sábado
---

Quem abrisse a Agenda no fim da noite de sábado via, por um instante, a semana
seguinte — e só então a tela se corrigia sozinha. Acontecia porque o servidor
calculava a semana pelo relógio dele, em UTC, enquanto a tela usava o fuso de
quem estava olhando.

Agora a semana é calculada no fuso configurado: o da pessoa, em
**Configurações › Perfil**, e o da empresa, em **Configurações › Empresa**,
quando a pessoa não escolheu nenhum. Se o fuso gravado for inválido, a Agenda
abre no padrão em vez de falhar.

Nada a fazer na atualização.
