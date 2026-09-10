"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";
type Vinculos = {
  contacts: Array<{ id: string; name: string }>;
  conversations: Array<{ id: string; created_at: string; status: string }>;
};
export function VinculoDaMarcacao({
  contactId,
  conversationId,
  onChange,
}: {
  contactId: string;
  conversationId: string;
  onChange: (contact: string, conversation: string) => void;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["agenda", "vinculos", contactId, search],
    queryFn: async () =>
      (
        await apiClient.get<{ data: Vinculos }>(
          `/api/v1/agenda/vinculos?${new URLSearchParams(contactId ? { contact_id: contactId } : { q: search })}`,
        )
      ).data,
  });
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border bg-surface-elevated/30 p-3">
      <div>
        <label
          htmlFor="busca-cliente"
          className="block text-xs font-medium text-text-muted"
        >
          {t("Buscar cliente")}
        </label>
        <input
          id="busca-cliente"
          type="text"
          className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text placeholder:text-text-subtle transition-colors duration-fast hover:border-border-strong focus:border-border-strong focus:outline-hidden"
          placeholder={t("Buscar cliente")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            onChange("", "");
          }}
        />
      </div>
      <div>
        <label
          htmlFor="quem-sera-atendido"
          className="block text-xs font-medium text-text-muted"
        >
          {t("Quem será atendido")}
        </label>
        <select
          id="quem-sera-atendido"
          aria-label={t("Quem será atendido")}
          className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text transition-colors duration-fast hover:border-border-strong focus:border-border-strong focus:outline-hidden"
          value={contactId}
          onChange={(e) => onChange(e.target.value, "")}
        >
          <option value="">{t("Compromisso pessoal, sem cliente")}</option>
          {query.data?.contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {contactId ? (
        <div>
          <label
            htmlFor="conversa-vinculada"
            className="block text-xs font-medium text-text-muted"
          >
            {t("Conversa vinculada (opcional)")}
          </label>
          <select
            id="conversa-vinculada"
            aria-label={t("Conversa vinculada (opcional)")}
            className="mt-1.5 h-9 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text transition-colors duration-fast hover:border-border-strong focus:border-border-strong focus:outline-hidden"
            value={conversationId}
            onChange={(e) => onChange(contactId, e.target.value)}
          >
            <option value="">{t("Sem conversa vinculada")}</option>
            {query.data?.conversations.map((c, i) => (
              <option key={c.id} value={c.id}>
                {t("Conversa")} {i + 1} · {new Date(c.created_at).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {query.isError ? (
        <p role="alert" className="text-xs text-error">
          {t("Não foi possível carregar os vínculos. Tente novamente.")}
        </p>
      ) : null}
    </div>
  );
}
