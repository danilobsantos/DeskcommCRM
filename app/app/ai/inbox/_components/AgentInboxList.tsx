"use client";

import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useAgentInbox,
  useResolveAllInboxItems,
  useUpdateInboxItem,
  type AgentInboxItem,
  type FiltroDeGravidade,
} from "@/hooks/ai/useAgentInbox";
import { kindLabel, SEVERITY_LABEL, type AgentInboxSeverity } from "@/lib/ai/agent-inbox-copy";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import { Bell, Check } from "@/lib/ui/icons";
import { useT } from "@/hooks/i18n/useT";
import { ApiError } from "@/lib/api/types";

const SEVERITY_VARIANT: Record<AgentInboxSeverity, "info" | "warning" | "error"> = {
  info: "info",
  warn: "warning",
  critical: "error",
};

const FILTROS_DE_GRAVIDADE: FiltroDeGravidade[] = ["todas", "critical", "warn", "info"];

const PASSO_DO_CARREGAR_MAIS = 50;

export function AgentInboxList({ canResolve }: { canResolve: boolean }) {
  const t = useT();
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const [filtro, setFiltro] = useState<FiltroDeGravidade>("todas");
  const [limite, setLimite] = useState(PASSO_DO_CARREGAR_MAIS);
  const { data: cachedData, error, isLoading, isError, refetch, isFetching } = useAgentInbox(tab, {
    gravidade: filtro,
    limite,
  });
  const acessoNegado = error instanceof ApiError && (error.status === 401 || error.status === 403);
  const data = acessoNegado ? undefined : cachedData;
  const update = useUpdateInboxItem();
  const resolveAll = useResolveAllInboxItems();
  // O "Carregar mais" é limite cumulativo (a ordem por camadas sai do
  // servidor): tem mais quando o excedente `+1` da rota acusou — ou, em
  // resposta antiga sem o campo, quando a página veio cheia.
  const temMais = data ? (data.has_more ?? data.items.length >= limite) : false;

  function trocarAba(v: "open" | "resolved") {
    setTab(v);
    setLimite(PASSO_DO_CARREGAR_MAIS);
  }

  function trocarFiltro(v: FiltroDeGravidade) {
    setFiltro(v);
    setLimite(PASSO_DO_CARREGAR_MAIS);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(v) => trocarAba(v as "open" | "resolved")}>
          <TabsList>
            <TabsTrigger value="open">
              {t("Abertos")}{data ? ` (${data.open_count})` : ""}
            </TabsTrigger>
            <TabsTrigger value="resolved">{t("Resolvidos")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {canResolve && tab === "open" && data && data.items.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            disabled={resolveAll.isPending}
            onClick={() => resolveAll.mutate()}
          >
            <Check size={14} aria-hidden />
            {t("Marcar todos resolvidos")}
          </Button>
        ) : null}
      </div>

      {/* Filtro por gravidade: chips que afunilam a fila sem trocar de aba. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("Filtrar por gravidade")}>
        {FILTROS_DE_GRAVIDADE.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filtro === f ? "default" : "outline"}
            data-testid={`filtro-severidade-${f}`}
            onClick={() => trocarFiltro(f)}
          >
            {f === "todas" ? t("Todos") : t(SEVERITY_LABEL[f])}
          </Button>
        ))}
      </div>

      {isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4 text-sm">
          <p className="min-w-0 flex-1">{t(acessoNegado ? "Seu acesso aos avisos não está disponível. Confira sua sessão e tente novamente." : data ? "Não foi possível atualizar os avisos. A lista abaixo pode estar desatualizada." : "Não foi possível carregar os avisos. Tente novamente.")}</p>
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>{t("Tentar novamente")}</Button>
        </div>
      ) : null}
      {update.isError ? <p role="alert" className="text-sm text-destructive">{t("Não foi possível atualizar este aviso. Tente novamente.")}</p> : null}
      {/* O lote pode falhar depois de resolver PARTE dos avisos: a mensagem manda
          conferir a lista em vez de afirmar que nada mudou. Sem isto o clique em
          "Marcar todos resolvidos" não deixaria rastro nenhum quando errasse. */}
      {resolveAll.isError ? <p role="alert" className="text-sm text-destructive">{t("Não foi possível resolver todos os avisos. Confira a lista e tente novamente.")}</p> : null}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError && !data ? null : !data || data.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <Bell size={28} className="text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">
            {tab === "open" ? t("Nenhum aviso em aberto") : t("Nenhum aviso resolvido")}
          </p>
          <p className="text-xs text-muted-foreground">
            {tab === "open"
              ? t("Quando o assistente precisar de você, o aviso aparece aqui.")
              : t("Avisos que você marcar como resolvidos ficam aqui.")}
          </p>
        </div>
      ) : (
        <>
        {tab === "open" && filtro === "todas" ? (
          <p className="-mb-2 text-xs text-muted-foreground">
            {t("Os mais graves primeiro; entre iguais, os mais recentes.")}
          </p>
        ) : null}
        <ul className="divide-y divide-border rounded-lg border border-border">
          {data.items.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              canResolve={canResolve}
              pending={update.isPending}
              onToggle={(status) => update.mutate({ id: item.id, status })}
            />
          ))}
        </ul>
        {temMais ? (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => setLimite((l) => l + PASSO_DO_CARREGAR_MAIS)}
            >
              {t("Carregar mais")}
            </Button>
          </div>
        ) : null}
        </>
      )}
    </div>
  );
}

function InboxRow({
  item,
  canResolve,
  pending,
  onToggle,
}: {
  item: AgentInboxItem;
  canResolve: boolean;
  pending: boolean;
  onToggle: (status: "open" | "resolved") => void;
}) {
  const localeDaData = useLocaleDeData();
  const t = useT();
  const when = formatDistanceToNowStrict(new Date(item.created_at), {
    addSuffix: true,
    locale: localeDaData,
  });
  // Nome/número vêm PRONTOS do servidor (nunca por t(): dado de gente, como
  // título e corpo — ver o comentário abaixo). Linha ausente = sem contato.
  const nomeDoCard = item.contato?.nome?.trim() || null;
  const numeroDoCard = item.contato?.telefone?.trim() || null;
  const contatoDoCard =
    nomeDoCard && numeroDoCard && numeroDoCard !== nomeDoCard
      ? `${nomeDoCard} • ${phoneForDisplay(numeroDoCard)}`
      : (nomeDoCard ?? (numeroDoCard ? phoneForDisplay(numeroDoCard) : null));
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3" data-testid="inbox-item">
      <Badge variant={SEVERITY_VARIANT[item.severity]} className="mt-0.5 shrink-0">
        {t(SEVERITY_LABEL[item.severity])}
      </Badge>
      <div className="min-w-0 flex-1 basis-48 break-words">
        {/* TÍTULO E CORPO SAEM COMO VIERAM — nunca por t().
            São LINHAS de `agent_inbox_items`, escritas pelo runtime no momento do
            evento e recheadas com dado de gente: nome do cliente, número, motivo do
            handoff, o que o operador cadastrou. É a mesma regra que já vale para nome
            de funil, rótulo de etapa e conteúdo de mensagem — e a mesma que o PR #600
            aplicou à Agenda. Passar isso pelo dicionário não traduz nada (a chave é a
            frase inteira, que nunca casa) e, quando casa, troca a palavra que a pessoa
            cadastrou por outra que ela não sabe procurar.
            O que continua traduzido é o que é NOSSO: severidade, rótulo do kind,
            orientação e rótulo do destino. */}
        <p className="text-sm font-medium">{item.title}</p>
        {contatoDoCard ? (
          <p className="text-xs font-medium" data-testid="inbox-contato">
            {contatoDoCard}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {kindLabel(item.kind, t)} · {when}
        </p>
        {item.body ? <p className="mt-1 text-xs text-muted-foreground">{item.body}</p> : null}
        {item.destination.orientacao ? <p className="mt-2 text-xs text-muted-foreground">{t(item.destination.orientacao)}</p> : null}
        {item.destination.estado === "disponivel" ? (
          <Button asChild size="sm" variant="link" className="mt-1 h-auto whitespace-normal px-0 text-left">
            <Link href={item.destination.href}>{t(item.destination.rotulo)}</Link>
          </Button>
        ) : null}
      </div>
      {canResolve ? (
        item.status === "resolved" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => onToggle("open")}>
            {t("Reabrir")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onToggle("resolved")}>
            <Check size={14} aria-hidden />
            {t("Marcar resolvido")}
          </Button>
        )
      ) : null}
    </li>
  );
}
