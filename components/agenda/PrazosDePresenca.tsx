"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { showApiError } from "@/components/feedback/ApiErrorToast";
type Config = { confirmation_delay_minutes: number; unknown_protection_minutes: number };
export function PrazosDePresenca({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Config | null>(null);
  const query = useQuery({
    queryKey: ["agenda", "configuracao"],
    queryFn: async () =>
      (await apiClient.get<{ data: Config }>("/api/v1/agenda/configuracao")).data,
  });
  const mutation = useMutation({
    mutationFn: (value: Config) => apiClient.patch("/api/v1/agenda/configuracao", value),
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["agenda", "configuracao"] });
    },
    onError: showApiError,
  });
  const value = draft ?? query.data;
  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-text">{t("Confirmação de presença")}</h2>
        <p className="mt-1 text-xs text-text-muted">
          {t(
            "Depois do compromisso, peça confirmação à equipe. Sem confirmação, o sistema mantém a presença desconhecida e nunca presume falta.",
          )}
        </p>
      </div>
      {query.isError ? (
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          {t("Tentar novamente")}
        </Button>
      ) : value ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="confirmation-delay"
                className="block text-xs font-medium text-text-muted"
              >
                {t("Pedir confirmação após o fim (minutos)")}
              </label>
              <input
                id="confirmation-delay"
                aria-label={t("Pedir confirmação após o fim (minutos)")}
                className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm text-text outline-hidden transition-colors duration-fast hover:border-border-strong focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-55"
                type="number"
                min={1}
                max={10080}
                disabled={!podeEditar}
                value={value.confirmation_delay_minutes}
                onChange={(e) =>
                  setDraft({ ...value, confirmation_delay_minutes: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <label
                htmlFor="unknown-protection"
                className="block text-xs font-medium text-text-muted"
              >
                {t("Proteger de cobranças por silêncio após o fim (minutos)")}
              </label>
              <input
                id="unknown-protection"
                aria-label={t("Proteger de cobranças por silêncio após o fim (minutos)")}
                className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm text-text outline-hidden transition-colors duration-fast hover:border-border-strong focus:border-border-strong disabled:cursor-not-allowed disabled:opacity-55"
                type="number"
                min={1}
                max={10080}
                disabled={!podeEditar}
                value={value.unknown_protection_minutes}
                onChange={(e) =>
                  setDraft({ ...value, unknown_protection_minutes: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <p className="text-xs text-text-muted">
            {t(
              "Quando esse prazo acabar, a pendência continua visível. Outro compromisso vivo ainda protege o contato.",
            )}
          </p>
          {podeEditar ? (
            <div>
              <Button size="sm" disabled={!draft || mutation.isPending} onClick={() => mutation.mutate(value)}>
                {t("Salvar prazos")}
              </Button>
            </div>
          ) : null}
          {mutation.isSuccess && !draft ? (
            <p role="status" className="text-xs font-medium text-success">
              {t("Prazos salvos.")}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-text-muted">{t("Carregando…")}</p>
      )}
    </section>
  );
}
