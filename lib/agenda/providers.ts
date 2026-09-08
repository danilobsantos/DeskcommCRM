/**
 * PROFISSIONAIS EXTERNOS — a superfície do dono sem login (migration 9003).
 *
 * Aqui moram: (1) a leitura da flag por tenant que liga/desliga a feature
 * (`settings.scheduling.providers_enabled`, default OFF) e (2) os schemas de
 * entrada do CRUD de provedor. O cálculo de horários e a coleta continuam em
 * `consulta.ts` / `horarios-livres.ts`, sem segunda implementação.
 */
import { z } from "zod";

import { availabilityScheduleSchema } from "@/lib/schemas/routing";

/**
 * A flag é OPT-IN por design: a agenda do base (atendentes + IA) não muda de
 * comportamento com isto desligado. Ligar apenas expõe a superfície de
 * profissionais externos — nav, tools e rotas.
 *
 * Lê `organizations.settings.scheduling` como um todo, para não casar "ausente"
 * com "desligado por decisão" (ausente também é desligado, mas a chave futura
 * viaja junto).
 */
export function settingsDeAgendamento(settings: unknown): {
  providers_enabled: boolean;
} {
  const s = (settings ?? {}) as { scheduling?: { providers_enabled?: unknown } | null };
  return { providers_enabled: s?.scheduling?.providers_enabled === true };
}

export function providersHabilitados(settings: unknown): boolean {
  return settingsDeAgendamento(settings).providers_enabled;
}

// `availabilityScheduleSchema` já defaulta timezone e windows internamente; a
// constante de valor vazio é o default do campo `schedule` quando a tela não o
// manda — espelha o `{}` do banco, mas normalizado.
const SCHEDULE_VAZIO = availabilityScheduleSchema.parse({});

export const providerCreateSchema = z.object({
  name: z.string().min(1).max(200),
  specialties: z.array(z.string().min(1).max(100)).default([]),
  schedule: availabilityScheduleSchema.default(SCHEDULE_VAZIO),
});
export type ProviderCreate = z.infer<typeof providerCreateSchema>;

export const providerUpdateSchema = providerCreateSchema
  .partial()
  .extend({ active: z.boolean().optional() });
export type ProviderUpdate = z.infer<typeof providerUpdateSchema>;