/**
 * Módulo de agendamento — regras de negócio puras.
 *
 * Este módulo exporta as funções de cálculo de disponibilidade, detecção
 * de conflitos e validação de slots. Todas as funções são puras (sem side
 * effects, sem acesso a DB) e totalmente testáveis.
 *
 * Os callers (tools MCP, cron, rotas) são responsáveis por:
 * 1. Buscar provider_schedules e appointments do banco
 * 2. Converter timestamps para o timezone do provider
 * 3. Chamar estas funções com os dados já processados
 */
export {
  type TimeWindow,
  type Slot,
  type ScheduleWindow,
  type ExistingAppointment,
  timeToMinutes,
  minutesToTime,
  computeAvailableSlots,
  intervalsOverlap,
  validateAppointmentSlot,
} from "./availability";
