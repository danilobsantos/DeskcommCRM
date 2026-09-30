"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

import type { ExcecaoDaAgenda } from "@/lib/agenda/dias-bloqueados";

export interface DiasBloqueadosFiltro {
  /** `yyyy-MM-dd` — a coluna no banco é `date`, sem hora. */
  de: string;
  ate: string;
  provider_id?: string;
  owner_user_id?: string;
}

/**
 * Os bloqueios do dono na janela — o que a grade desenha como "Fechado".
 *
 * Mesma família de chave de `DiasBloqueados` (`["agenda", "excecoes"]`): ele
 * invalida `["agenda"]` ao gravar, e a invalidação por prefixo alcança esta
 * query — fechar um dia repinta a grade sem código a mais. Falha em silêncio
 * de propósito: o marcador é camada informativa, e um toast de erro por ele
 * puniria quem só abriu a agenda com o dia fechado à mostra.
 */
export function useDiasBloqueados(filtro: DiasBloqueadosFiltro | null) {
  return useQuery({
    queryKey: ["agenda", "excecoes-grade", filtro],
    enabled: filtro !== null,
    queryFn: async (): Promise<ExcecaoDaAgenda[]> => {
      const qs = new URLSearchParams({ de: filtro!.de, ate: filtro!.ate });
      if (filtro!.provider_id) qs.set("provider_id", filtro!.provider_id);
      try {
        const r = await apiClient.get<{ data: ExcecaoDaAgenda[] }>(
          `/api/v1/agenda/excecoes?${qs.toString()}`,
        );
        return (
          (r as unknown as { data: ExcecaoDaAgenda[] }).data ??
          (r as unknown as ExcecaoDaAgenda[])
        );
      } catch {
        return [];
      }
    },
  });
}
