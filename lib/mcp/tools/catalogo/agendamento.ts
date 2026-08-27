/**
 * Capacidades de AGENDAMENTO — o pacote "Agendar consultas e compromissos".
 *
 * Sete tools que permitem ao agente de IA gerenciar a agenda de profissionais:
 * listar, checar disponibilidade, criar, reagendar, cancelar e confirmar
 * consultas. O agente NUNCA inventa disponibilidade — sempre consulta via tool.
 *
 * Fala com o HUMANO que configura o agente — `rotulo`, `explicacao` e `oQueToca`.
 * O texto que vai ao MODELO é a `description` do HANDLER.
 */
import { declararTools } from "./tipos";

export const TOOLS_AGENDAMENTO = declararTools([
  {
    name: "scheduling_list_providers",
    category: "read",
    rotulo: "Ver profissionais disponíveis",
    explicacao:
      "Lista os dentistas e profissionais da clínica, com suas especialidades — para o agente saber quem atende cada tipo de problema.",
    oQueToca: "Agenda de profissionais",
    risco: "seguro",
    pacotes: ["agendar"],
  },
  {
    name: "scheduling_list_appointments",
    category: "read",
    rotulo: "Ver consultas agendadas",
    explicacao:
      "Mostra as consultas marcadas: o que está pendente, o que já aconteceu e o que foi cancelado.",
    oQueToca: "Agenda de consultas",
    risco: "seguro",
    pacotes: ["agendar"],
  },
  {
    name: "scheduling_check_availability",
    category: "read",
    rotulo: "Checar horários livres de um profissional",
    explicacao:
      "Mostra os horários disponíveis de um profissional numa data específica, para oferecer opções concretas ao paciente.",
    oQueToca: "Agenda de profissionais",
    risco: "seguro",
    pacotes: ["agendar"],
  },
  {
    name: "scheduling_create_appointment",
    category: "write",
    rotulo: "Agendar uma consulta",
    explicacao:
      "Marca uma consulta com um profissional num horário disponível. O agente sempre verifica disponibilidade antes de agendar.",
    oQueToca: "Agenda de consultas",
    risco: "atencao",
    pacotes: ["agendar"],
  },
  {
    name: "scheduling_update_appointment",
    category: "write",
    rotulo: "Reagendar uma consulta",
    explicacao:
      "Muda o horário de uma consulta que ainda não aconteceu, verificando conflitos antes.",
    oQueToca: "Agenda de consultas",
    risco: "atencao",
    pacotes: ["agendar"],
  },
  {
    name: "scheduling_cancel_appointment",
    category: "write",
    rotulo: "Cancelar uma consulta",
    explicacao:
      "Cancela uma consulta agendada, liberando o horário para outros pacientes.",
    oQueToca: "Agenda de consultas",
    risco: "atencao",
    pacotes: ["agendar"],
  },
  {
    name: "scheduling_confirm_appointment",
    category: "write",
    rotulo: "Confirmar presença do paciente",
    explicacao:
      "Marca a consulta como confirmada quando o paciente responde positivamente ao lembrete.",
    oQueToca: "Agenda de consultas",
    risco: "atencao",
    pacotes: ["agendar"],
  },
]);
