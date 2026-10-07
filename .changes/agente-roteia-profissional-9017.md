---
impacto: capacidade_nova
secao: adicionado
titulo: Agente marca na agenda do profissional certo
---

Quando o cliente pedia atendimento com um profissional específico (dentista, corretor), a IA consultava a agenda do atendente padrão e desistia com "vou verificar com a equipe" — medido em produção: 20 consultas sem dono e zero marcações em 1h. O playbook de agendamento agora ensina o roteamento (`crm_list_providers` → `provider_id` no `find` e no `book`), e a ferramenta de consulta-e-marca aceita `provider_id`. Sem ele, consulta e marcação continuam na agenda do atendente, como sempre.
