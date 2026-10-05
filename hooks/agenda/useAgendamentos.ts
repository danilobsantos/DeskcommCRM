"use client";

import { useQuery } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

import type { Agendamento } from "@/components/agenda/tipos";

interface AgendamentoListado {
  revision?: number;
  id: string;
  titulo: string;
  iniciaEm: string;
  terminaEm: string;
  fuso: string;
  situacao: string;
  donoId: string | null;
  contatoId: string | null;
  contatoNome: string | null;
  origem?: "ui" | "google_sync";
}

interface AgendamentosResponse {
  data: AgendamentoListado[];
  meta?: { proximo?: string | null };
}

export interface RecorteDaGrade {
  de: string;
  ate: string;
  owner_user_id?: string;
  provider_id?: string;
}

export function useAgendamentos(recorte: RecorteDaGrade | null) {
  return useQuery({
    queryKey: ["agenda", "agendamentos", recorte],
    enabled: recorte !== null,
    queryFn: async (): Promise<Agendamento[]> => {
      const todos: Agendamento[] = [];
      let cursor: string | undefined;
      do {
        const qs = new URLSearchParams({ de: recorte!.de, ate: recorte!.ate });
        if (recorte!.owner_user_id) qs.set("owner_user_id", recorte!.owner_user_id);
        if (recorte!.provider_id) qs.set("provider_id", recorte!.provider_id);
        if (cursor) qs.set("depois_de", cursor);
        const r = await apiClient.get<AgendamentosResponse>(
          `/api/v1/agenda/agendamentos?${qs.toString()}`,
        );
        const lista =
          (r as unknown as { data?: AgendamentoListado[] }).data ??
          (r as unknown as AgendamentoListado[]);
        for (const a of lista ?? []) {
          todos.push({
            id: a.id,
            revision: a.revision,
            titulo: a.titulo,
            responsavelId: a.donoId ?? "",
            comeca: a.iniciaEm,
            termina: a.terminaEm,
            origem: a.origem ?? "ui",
            situacao: a.situacao as Agendamento["situacao"],
            quemSeraAtendido: a.contatoNome ?? undefined,
          });
        }
        cursor = r.meta?.proximo ?? undefined;
      } while (cursor);
      return todos;
    },
  });
}
