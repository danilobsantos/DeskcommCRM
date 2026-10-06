import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { apiClient } from "@/lib/api/client";
import { useAgendamentos } from "./useAgendamentos";

vi.mock("@/lib/api/client", () => ({ apiClient: { get: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

describe("agenda em organização com mais de uma página", () => {
  it("só publica a grade após ler todos os compromissos e preserva blocos externos", async () => {
    const linha = (id: string, origem?: "google_sync") => ({
      id, titulo: id, iniciaEm: "2026-10-06T10:00:00Z", terminaEm: "2026-10-06T11:00:00Z",
      donoId: null, contatoNome: null, situacao: "confirmed", origem,
    });
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ data: [linha("primeiro"), linha("ocupado", "google_sync")], meta: { proximo: "cursor-2" } })
      .mockResolvedValueOnce({ data: [linha("segundo")], meta: { proximo: null } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAgendamentos({
      de: "2026-10-06T00:00:00Z", ate: "2026-10-07T00:00:00Z",
    }), { wrapper });

    await waitFor(() => expect(result.current.data?.map((a) => a.id)).toEqual(["primeiro", "ocupado", "segundo"]));
    expect(result.current.data?.[1]?.origem).toBe("google_sync");
    expect(apiClient.get).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiClient.get).mock.calls[1]?.[0]).toContain("depois_de=cursor-2");
  });
});
