/**
 * PUSH PARA PROFISSIONAL EXTERNO (9014) — o executor publica no calendário do
 * vínculo com transporte fake (o CI não tem Google de verdade).
 *
 * O que se prova aqui, e por que com fake em vez de mockar o executor: o
 * `reconcileAppointment` inteiro roda — `claim → GET 404 → POST → commit` — e
 * a única ficção é o HTTP. Se o `parse` do snapshot voltasse a exigir
 * `owner_user_id` (o defeito que a 9014 remove), este teste quebra no primeiro
 * `parse`, antes de qualquer HTTP.
 */
import { describe, expect, it, vi } from "vitest";

import { reconcileAppointment } from "@/lib/agenda/google/sync-executor";
import { googleRpc } from "@/lib/agenda/google/sync-store";

vi.mock("@/lib/agenda/google/sync-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/agenda/google/sync-store")>();
  return { ...original, googleRpc: vi.fn() };
});

const ORG = "123e4567-e89b-42d3-a456-426614174001";
const APPT = "123e4567-e89b-42d3-a456-426614174000";

function snapshotBase() {
  return {
    meeting_allowed_types: null,
    meeting_state: "not_requested",
    meeting_request_id: null,
    meeting_requested_at: null,
    meeting_received_at: null,
    meeting_next_attempt_at: null,
    meeting_url: null,
    id: APPT,
    organization_id: ORG,
    owner_user_id: null,
    provider_id: "123e4567-e89b-42d3-a456-426614174003",
    contact_id: null,
    title: "Consulta",
    description: null,
    starts_at: "2026-03-09T12:00:00Z",
    ends_at: "2026-03-09T12:30:00Z",
    time_zone: "America/Sao_Paulo",
    status: "confirmed",
    location_kind: "in_person",
    location_details: null,
    guest_email: null,
    revision: "1",
    // EDIÇÃO DE COMPROMISSO (9015): o schema do snapshot cresceu — sem estes
    // dois campos o parse recusa e o teste quebra antes de qualquer HTTP.
    revision_started_at: "2026-03-09T11:00:00Z",
    google_synced_at: null,
    google_local_revision: "1",
    google_synced_local_revision: "0",
    google_connection_id: "123e4567-e89b-42d3-a456-426614174002",
    google_calendar_id: "dra.ana@gmail.com",
    // Identidade do evento = `deskcommapp` + id sem traços (o transporte
    // recusa resposta de outra identidade — ver teste de escrita).
    google_event_id: "deskcommapp123e4567e89b42d3a456426614174000",
    google_etag: null,
    google_base_projection: null,
    google_conflict: null,
    google_pending_write: { reservation: true },
    claim: { token: "123e4567-e89b-42d3-a456-426614174005", epoch: "1", lease_until: new Date(Date.now() + 60000).toISOString() },
  };
}

describe("reconcileAppointment publica compromisso de provider", () => {
  it("claim com owner null passa no parse e o POST sai no calendário do vínculo", async () => {
    vi.mocked(googleRpc).mockResolvedValue(snapshotBase());
    const chamadas: { url: string; init?: RequestInit }[] = [];
    const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      chamadas.push({ url, init });
      if ((init?.method ?? "GET") === "GET") {
        // Evento ainda não existe → 404; o transporte então confere se o
        // CALENDÁRIO existe (GET sem /events/) — ele existe (200).
        if (url.includes("/events/")) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify({ id: "dra.ana@gmail.com" }));
      }
      // A identidade tem de ser a do compromisso (`deskcommapp` + id sem
      // traços): o transporte recusa "resposta de outra identidade".
      return new Response(
        JSON.stringify({
          id: "deskcommapp123e4567e89b42d3a456426614174000",
          etag: '"v1"',
          status: "confirmed",
          start: { dateTime: "2026-03-09T12:00:00Z" },
          end: { dateTime: "2026-03-09T12:30:00Z" },
        }),
      );
    });

    const resultado = await reconcileAppointment({} as never, ORG, APPT, {
      token: "fake",
      transport,
    });

    expect(resultado).toBe("processed");
    const posts = chamadas.filter((c) => c.init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(decodeURIComponent(posts[0]!.url)).toContain("/dra.ana@gmail.com/events");
  });

  it("snapshot de dono-usuário continua válido (caminho inalterado)", async () => {
    // Se o parse voltasse a exigir provider (o espelho do defeito antigo), o
    // caminho de usuário — 100% dos pushes de hoje — quebraria aqui.
    const { appointmentSnapshotSchema } = await import("@/lib/agenda/google/sync-store");
    const parsed = appointmentSnapshotSchema.safeParse({
      ...snapshotBase(),
      owner_user_id: "123e4567-e89b-42d3-a456-426614174004",
      provider_id: null,
    });
    expect(parsed.success).toBe(true);
  });
});
