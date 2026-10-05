/**
 * VÍNCULO GOOGLE DO PROFISSIONAL EXTERNO — schemas (migration 9013).
 *
 * O vínculo mora em `calendar_connection_calendars.provider_id`: uma linha com
 * provider é "a agenda do Google deste dentista", na conta central da clínica.
 * A escrita vive na Server Action (`app/actions/agenda/provider-google.ts`),
 * que usa service role com filtro manual de `organization_id` — a tabela só
 * tem policy de SELECT, então client de sessão não escreve nela.
 */
import { z } from "zod";

export const vinculoGoogleSchema = z.object({
  provider_id: z.uuid(),
  calendar_id: z.uuid(),
});
export type VinculoGoogle = z.infer<typeof vinculoGoogleSchema>;

export const desvinculoGoogleSchema = z.object({
  provider_id: z.uuid(),
});
export type DesvinculoGoogle = z.infer<typeof desvinculoGoogleSchema>;
