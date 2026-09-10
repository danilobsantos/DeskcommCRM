"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { showApiError } from "@/components/feedback/ApiErrorToast";
export interface CalendarCatalog {
  connections: Array<{
    id: string;
    account_email: string;
    status: string;
    last_sync_error: string | null;
    calendar_selection_revision: string;
  }>;
  calendars: Array<{
    id: string;
    connection_id: string;
    name: string;
    is_destination: boolean;
    counts_for_conflicts: boolean;
    can_read: boolean;
    can_write: boolean;
    available: boolean;
    access_role: string | null;
    allowed_conference_types?: string[] | null;
    last_sync_at: string | null;
    sync_error: string | null;
    reading: boolean;
    sync_coverage: { window_start: string; window_end: string } | null;
  }>;
}
export function AgendasConectadas() {
  const t = useT();
  const locale = useTagDeIdioma();
  const query = useQuery({
    queryKey: ["agenda", "calendarios"],
    queryFn: async () =>
      (await apiClient.get<{ data: CalendarCatalog }>("/api/v1/agenda/google/calendarios")).data,
  });
  const [draft, setDraft] = useState<{
    sources: string[];
    destination: string;
    revisions: Array<{ connection_id: string; revision: string }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const data = query.data;
  const sources =
    draft?.sources ?? data?.calendars.filter((c) => c.counts_for_conflicts).map((c) => c.id) ?? [];
  const destination = draft?.destination ?? (data?.calendars.filter((c) => c.is_destination).length === 1 ? data.calendars.find((c) => c.is_destination)?.id : "") ?? "";
  const start = () =>
    draft ?? {
      sources,
      destination,
      revisions:
        data?.connections.map((c) => ({
          connection_id: c.id,
          revision: c.calendar_selection_revision,
        })) ?? [],
    };
  async function execute(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      setDraft(null);
      await query.refetch();
    } catch (e) {
      showApiError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4" aria-label={t("Suas agendas Google")}>
      <div>
        <h2 className="text-sm font-semibold text-text">{t("Suas agendas Google")}</h2>
        <p className="mt-1 text-xs text-text-muted">
          {t(
            "Escolha quais agendas ocupam seus horários e onde publicar novos compromissos. Os já publicados permanecem na agenda original.",
          )}
        </p>
      </div>
      {query.isLoading && <p className="text-xs text-text-muted">{t("Carregando agendas…")}</p>}
      {query.isError && (
        <div role="alert" className="space-y-2">
          <p className="text-xs text-error">{t("Não foi possível carregar suas agendas.")}</p>
          <Button onClick={() => void query.refetch()} variant="outline" size="sm">
            {t("Tentar novamente")}
          </Button>
        </div>
      )}
      {data?.connections.length === 0 && (
        <Link className="text-xs text-accent underline underline-offset-2 hover:text-accent-hover" href="/app/agenda">
          {t("Conecte sua conta pela Agenda")}
        </Link>
      )}
      {data?.connections.map((connection) => (
        <div key={connection.id} className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-text break-all">{connection.account_email}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void execute(() =>
                  apiClient.post("/api/v1/agenda/google/calendarios/atualizar", {
                    connection_id: connection.id,
                  }),
                )
              }
              disabled={busy}
            >
              {t("Atualizar lista e sincronização")}
            </Button>
          </div>
          {connection.last_sync_error && (
            <p role="alert" className="text-xs text-error">
              {connection.last_sync_error}
            </p>
          )}
          {data.calendars
            .filter((c) => c.connection_id === connection.id)
            .map((calendar) => (
              <div key={calendar.id} className="space-y-1.5 rounded-md border border-border bg-surface-elevated/30 p-3">
                <p className="text-sm font-medium text-text break-words">{calendar.name}</p>
                <p className="text-xs text-text-muted">{t(calendar.allowed_conference_types == null ? "Google Meet: atualize a lista para conferir" : calendar.allowed_conference_types.includes("hangoutsMeet") ? "Permite criar links do Google Meet" : "Esta agenda não permite criar Google Meet")}</p>
                <div className="flex flex-wrap gap-4 text-xs text-text">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sources.includes(calendar.id)}
                      disabled={busy || (!calendar.can_read && !sources.includes(calendar.id))}
                      onChange={(e) =>
                        setDraft({
                          ...start(),
                          sources: e.target.checked
                            ? [...sources, calendar.id]
                            : sources.filter((id) => id !== calendar.id),
                        })
                      }
                    />
                    {t("Conta como ocupado")}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="calendar-destination"
                      checked={destination === calendar.id}
                      disabled={busy || !calendar.can_write}
                      onChange={() => setDraft({ ...start(), destination: calendar.id })}
                    />
                    {t("Destino dos novos compromissos")}
                  </label>
                </div>
                {!calendar.can_write && (
                  <p className="text-xs text-text-muted">
                    {t(
                      calendar.can_read
                        ? "Leitura permitida. Esta agenda não está disponível para publicação."
                        : "Esta permissão não oferece a leitura de eventos necessária. Revise o acesso no Google.",
                    )}
                  </p>
                )}
                <p className="text-xs text-text-muted">
                  {calendar.last_sync_at
                    ? `${t("Última sincronização")}: ${new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(calendar.last_sync_at))}`
                    : t("Ainda não sincronizada")}
                </p>
                {calendar.reading && (
                  <p className="text-xs text-text-muted">
                    {t("Leitura em andamento; a cobertura será confirmada ao terminar.")}
                  </p>
                )}
                {calendar.sync_error && (
                  <p role="alert" className="text-xs text-error">
                    {calendar.sync_error}
                  </p>
                )}
              </div>
            ))}
        </div>
      ))}
      {!!data?.connections.length && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() =>
              void execute(() => apiClient.patch("/api/v1/agenda/google/calendarios", start()))
            }
            disabled={busy || !draft || !destination}
          >
            {t("Salvar agendas")}
          </Button>
          {draft && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(null);
                void query.refetch();
              }}
              disabled={busy}
            >
              {t("Descartar alterações")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
