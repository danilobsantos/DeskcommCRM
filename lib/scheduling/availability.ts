/**
 * Regras de disponibilidade para agendamento.
 *
 * Calcula slots disponíveis para um profissional numa data específica,
 * intersectando as janelas de disponibilidade (`provider_schedules`) com
 * consultas existentes (`appointments`). Lógica pura — testável sem DB.
 *
 * Timezone: `provider_schedules` usa `time` (hora local do provider),
 * `appointments` usa `timestamptz` (absoluto). A conversão para locale
 * do provider acontece nos callers que lidam com dados reais do banco.
 * Aqui trabalhamos com valores JÁ convertidos.
 */

export interface TimeWindow {
  startMinutes: number; // 0-1439 (minutos desde meia-noite)
  endMinutes: number;
}

export interface Slot {
  startMinutes: number;
  endMinutes: number;
  /** ISO 8601 do início do slot (preenchido pelo caller com timezone real). */
  startIso?: string;
  /** ISO 8601 do fim do slot. */
  endIso?: string;
}

export interface ScheduleWindow {
  dayOfWeek: number; // 0=dom, 6=sab
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  slotDurationMinutes: number;
  active: boolean;
}

export interface ExistingAppointment {
  startMinutes: number;
  endMinutes: number;
  status: string;
}

/**
 * Converte "HH:MM" para minutos desde meia-noite.
 */
export function timeToMinutes(time: string): number {
  const parts = time.split(":");
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return h * 60 + m;
}

/**
 * Converte minutos desde meia-noite para "HH:MM".
 */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Gera slots disponíveis a partir de uma janela de disponibilidade,
 * subtraindo consultas existentes.
 *
 * @param window - Janela de disponibilidade do profissional
 * @param existing - Consultas já agendadas que conflitam (status scheduled/confirmed)
 * @param targetDayOfWeek - Dia da semana alvo (para filtrar janelas)
 * @returns Array de slots livres, ordenados por startMinutes
 */
export function computeAvailableSlots(
  window: ScheduleWindow,
  existing: ExistingAppointment[],
  targetDayOfWeek: number,
): Slot[] {
  if (!window.active || window.dayOfWeek !== targetDayOfWeek) {
    return [];
  }

  const windowStart = timeToMinutes(window.startTime);
  const windowEnd = timeToMinutes(window.endTime);
  const duration = window.slotDurationMinutes;

  if (windowStart >= windowEnd || duration <= 0) {
    return [];
  }

  // Gerar todos os slots possíveis na janela
  const allSlots: Slot[] = [];
  for (let start = windowStart; start + duration <= windowEnd; start += duration) {
    allSlots.push({ startMinutes: start, endMinutes: start + duration });
  }

  // Filtrar slots que conflitam com consultas existentes
  const activeAppointments = existing.filter(
    (a) => a.status === "scheduled" || a.status === "confirmed",
  );

  return allSlots.filter((slot) => {
    return !activeAppointments.some(
      (appt) => slot.startMinutes < appt.endMinutes && slot.endMinutes > appt.startMinutes,
    );
  });
}

/**
 * Verifica se dois intervalos de tempo se sobrepõem.
 */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Valida se um horário proposto está dentro das janelas de disponibilidade
 * do profissional e não conflita com consultas existentes.
 *
 * @returns null se válido, ou string com o motivo da recusa
 */
export function validateAppointmentSlot(
  startMinutes: number,
  endMinutes: number,
  windows: ScheduleWindow[],
  existing: ExistingAppointment[],
  dayOfWeek: number,
): string | null {
  if (startMinutes >= endMinutes) {
    return "Horário de início deve ser anterior ao horário de fim.";
  }

  // Verificar se está dentro de alguma janela ativa
  const inWindow = windows.some(
    (w) =>
      w.active &&
      w.dayOfWeek === dayOfWeek &&
      startMinutes >= timeToMinutes(w.startTime) &&
      endMinutes <= timeToMinutes(w.endTime),
  );

  if (!inWindow) {
    return "Horário fora da janela de disponibilidade do profissional.";
  }

  // Verificar conflito com consultas existentes
  const hasConflict = existing.some(
    (a) =>
      (a.status === "scheduled" || a.status === "confirmed") &&
      intervalsOverlap(startMinutes, endMinutes, a.startMinutes, a.endMinutes),
  );

  if (hasConflict) {
    return "Horário conflita com uma consulta já agendada.";
  }

  return null;
}
