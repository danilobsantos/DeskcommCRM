"use client";
import { MeetDoCompromisso, type MeetingDetail } from "./MeetDoCompromisso";
import { SincronizacaoDoCompromisso, type SyncDetail } from "./SincronizacaoDoCompromisso";
import { VinculoDaMarcacao } from "./VinculoDaMarcacao";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { apiClient } from "@/lib/api/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { rotuloDoLocal } from "@/lib/agenda/locais";
import type { Pessoa } from "./tipos";

type Detalhe = {
  meeting?: MeetingDetail | null;
  google_sync?: SyncDetail;
  id: string;
  title: string;
  description: string | null;
  /**
   * A anotação INTERNA do compromisso — o resumo que o assistente grava ao
   * marcar. Distinta de `description`, que é a observação publicável e sobe
   * para o calendário do cliente; esta fica no CRM, e é o que quem vai atender
   * precisa ler. A coluna era gravada e não aparecia em tela nenhuma.
   */
  notes: string | null;
  location_kind: string | null;
  location_details: string | null;
  starts_at: string;
  ends_at: string;
  time_zone: string;
  status: string;
  revision: number;
  contact_id: string | null;
  conversation_id: string | null;
  event_type_id: string | null;
  /**
   * Quem atende — um lado só (`dono_unico`): `owner_user_id` (atendente) ou
   * `provider_id` (profissional externo). A tela resolve os dois num seletor
   * único e manda o par (novo + null no outro lado) no PATCH.
   */
  owner_user_id: string | null;
  provider_id: string | null;
  outcome_source_kind: string | null;
  outcome_recorded_at: string | null;
  recovery: {
    result: string;
    enrollment_id: string | null;
    invalidated_at: string | null;
    enrollment_status: string | null;
    cancel_reason: string | null;
  } | null;
  evidence_messages: Array<{ id: string; body: string | null; sent_at: string }>;
};
const RESULTS: Record<string, string> = {
  started: "Recuperação iniciada",
  other_flow: "Não iniciada: outro acompanhamento já está ativo.",
  ambiguous: "Não iniciada: mais de um fluxo foi configurado para esta falta.",
  not_configured: "Não iniciada: configure um fluxo e habilite-o em um assistente publicado.",
  stale: "Não iniciada: o atendimento ou a resposta do cliente mudou.",
  no_contact: "Sem contato vinculado. Este compromisso não inicia uma recuperação.",
};
export function DetalheDoCompromisso({
  id,
  onClose,
  podeEditar = true,
  pessoas,
}: {
  id: string | null;
  onClose: () => void;
  podeEditar?: boolean;
  /**
   * O roster da grade (equipe + profissionais externos). Ausente = a tela não
   * oferece a troca de profissional — o PATCH continua aceitando por API.
   */
  pessoas?: Pessoa[];
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const qc = useQueryClient();
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [conflict, setConflict] = useState(false);
  // EDIÇÃO DE COMPROMISSO (9015): rascunho local dos campos editáveis. Nasce
  // do que o GET devolve ao ABRIR a edição (não no mount: o dado chega depois,
  // e após cada salvamento a revisão muda e o rascunho tem de renascer).
  const [editando, setEditando] = useState(false);
  const [editTitulo, setEditTitulo] = useState("");
  const [editPaciente, setEditPaciente] = useState("");
  const [editConversa, setEditConversa] = useState("");
  const [editTipo, setEditTipo] = useState("");
  const [editInicio, setEditInicio] = useState("");
  const [editObservacao, setEditObservacao] = useState("");
  // Quem atende: o id na lista única (`pessoas`). Vazio = sem responsável
  // atual e sem escolha — nesse caso o PATCH não leva o par (a rota recusa
  // zerar os dois lados, então "não escolher" é "não mexer").
  const [editProfissional, setEditProfissional] = useState("");
  const [confirmandoTroca, setConfirmandoTroca] = useState(false);
  const tipos = useQuery({
    queryKey: ["agenda", "tipos"],
    enabled: editando,
    queryFn: async () =>
      (
        await apiClient.get<{
          data: Array<{ id: string; name: string; duration_minutes: number; is_active: boolean }>;
        }>(`/api/v1/agenda/tipos`)
      ).data,
  });
  const tiposAtivos = (tipos.data ?? []).filter((ti) => ti.is_active);
  const query = useQuery({
    queryKey: ["agenda", "detalhe", id],
    enabled: !!id,
    refetchInterval: 5000,
    queryFn: async () =>
      (await apiClient.get<{ data: Detalhe }>(`/api/v1/agenda/agendamentos/${id}`)).data,
  });
  const a = query.data;
  const formatoDeData =
    a &&
    new Intl.DateTimeFormat(tagDoIdioma, {
      timeZone: a.time_zone,
      dateStyle: "medium",
      timeStyle: "short",
      hourCycle: "h23",
    });
  const staleDraft = conflict || (draftRevision !== null && a?.revision !== draftRevision);
  function beginDraft() {
    if (draftRevision === null && a) setDraftRevision(a.revision);
  }
  function resetDraft() {
    setEvidence("");
    setReason("");
    setDraftRevision(null);
    setConflict(false);
    // Sair da edição junto: o dado mudou (ou o rascunho morreu) e o formulário
    // precisa renascer do GET na próxima abertura.
    setEditando(false);
    setConfirmandoTroca(false);
  }
  function mutationFailed(error: unknown) {
    showApiError(error);
    setConflict(true);
    void query.refetch();
  }
  const mutation = useMutation({
    mutationFn: async (decision: { revision: number; patch: Record<string, unknown> }) =>
      apiClient.patch("/api/v1/agenda/agendamentos", {
        id,
        revision: decision.revision,
        ...decision.patch,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agenda"] });
      void qc.invalidateQueries({ queryKey: ["agent-inbox"] });
      resetDraft();
    },
    onError: mutationFailed,
  });
  const cancel = useMutation({
    mutationFn: async (decision: { revision: number; reason: string }) =>
      apiClient.delete("/api/v1/agenda/agendamentos", { id, ...decision }),
    onSuccess: () => {
      resetDraft();
      void qc.invalidateQueries({ queryKey: ["agenda"] });
    },
    onError: mutationFailed,
  });
  function decide(patch: Record<string, unknown>) {
    if (a && !staleDraft) mutation.mutate({ revision: draftRevision ?? a.revision, patch });
  }
  /**
   * EDIÇÃO DE COMPROMISSO (9015). O `datetime-local` fala no fuso do NAVEGADOR
   * e o `starts_at` viaja em UTC: a ida e a volta passam por `Date`, sem
   * formatação manual de fuso — o mesmo instante, duas escritas.
   */
  function paraInputDataHora(iso: string): string {
    const d = new Date(iso);
    const dois = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
  }
  function abrirEdicao() {
    if (!a) return;
    beginDraft();
    setEditTitulo(a.title);
    setEditPaciente(a.contact_id ?? "");
    setEditConversa(a.conversation_id ?? "");
    setEditTipo(a.event_type_id ?? "");
    setEditInicio(paraInputDataHora(a.starts_at));
    setEditObservacao(a.description ?? "");
    // Só pré-seleciona quem está no roster: dono fora da equipe (ex.:
    // revogado) não tem <option> — pré-selecionar o id o mostraria em branco e
    // ligaria o Salvar sem mudança visível. Vazio = "não mexer".
    const responsavel = a.provider_id ?? a.owner_user_id ?? "";
    setEditProfissional(pessoas?.some((p) => p.id === responsavel) ? responsavel : "");
    setConfirmandoTroca(false);
    setEditando(true);
  }
  function salvarEdicao(confirmado: boolean) {
    if (!a || staleDraft) return;
    const patch: Record<string, unknown> = {};
    const titulo = editTitulo.trim();
    // Compara o horário com precisão de MINUTO: o input não tem segundos e o
    // compromisso pode ter, e "igual a menos de um minuto" não é mudança.
    const minuto = (iso: string) => Math.floor(Date.parse(iso) / 60000);
    if (titulo && titulo !== a.title) patch.title = titulo;
    if ((editPaciente || null) !== a.contact_id) {
      patch.contact_id = editPaciente || null;
      // A conversa anda JUNTO com o paciente: trocar sem soltar deixava o
      // compromisso novo apontando para o atendimento de outra pessoa. A troca
      // parte do que o seletor de conversa mostra (vazio, ou a conversa
      // escolhida para o paciente novo) — nunca da conversa do anterior.
      patch.conversation_id = editConversa || null;
    } else if ((editConversa || null) !== (a.conversation_id ?? null)) {
      patch.conversation_id = editConversa || null;
    }
    if (editTipo && editTipo !== a.event_type_id) patch.event_type_id = editTipo;
    // Trocar o profissional manda o PAR (novo + null no outro lado): mandar
    // só um lado com o outro preenchido é recusado na rota (`agenda_dono_duplo`).
    // Sem confirmação — diferente do paciente, não troca convidado — e a
    // disponibilidade do novo é revalidada no handler.
    const responsavelAtual = a.provider_id ?? a.owner_user_id ?? null;
    if (editProfissional && editProfissional !== responsavelAtual) {
      const pessoaNova = pessoas?.find((p) => p.id === editProfissional);
      if (pessoaNova?.tipo === "profissional") {
        patch.provider_id = editProfissional;
        patch.owner_user_id = null;
      } else {
        patch.owner_user_id = editProfissional;
        patch.provider_id = null;
      }
    }
    if (editInicio && minuto(new Date(editInicio).toISOString()) !== minuto(a.starts_at)) {
      patch.starts_at = new Date(editInicio).toISOString();
    }
    if ((editObservacao.trim() || null) !== (a.description?.trim() || null)) {
      patch.description = editObservacao.trim() || null;
    }
    if (Object.keys(patch).length === 0) {
      setEditando(false);
      return;
    }
    // Trocar o paciente PEDE CONFIRMAÇÃO: o convite na agenda do Google muda
    // junto (o anterior sai, o novo entra) e isto não se desfaz sozinho.
    if (patch.contact_id !== undefined && !confirmado) {
      setConfirmandoTroca(true);
      return;
    }
    setConfirmandoTroca(false);
    decide(patch);
  }
  const editouAlgo =
    !!a &&
    (editTitulo.trim() !== a.title ||
      (editPaciente || null) !== a.contact_id ||
      (editConversa || null) !== (a.conversation_id ?? null) ||
      (editTipo !== "" && editTipo !== a.event_type_id) ||
      (editProfissional !== "" && editProfissional !== (a.provider_id ?? a.owner_user_id ?? null)) ||
      (editInicio !== "" &&
        Math.floor(Date.parse(new Date(editInicio).toISOString()) / 60000) !==
          Math.floor(Date.parse(a.starts_at) / 60000)) ||
      (editObservacao.trim() || null) !== (a.description?.trim() || null));
  return (
    <Sheet
      open={!!id}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          {/*
            O EDITAR MORA NO CABEÇALHO, ao lado do título — e não no fim da
            folha, abaixo do cancelar, onde ninguém procura. Só quando há o
            que editar: com o compromisso cancelado a rota recusa tudo, então
            o botão some junto com o resto.
          */}
          <div className="flex items-center justify-between gap-2 pr-8">
            <SheetTitle>{a?.title ?? t("Compromisso")}</SheetTitle>
            {podeEditar && a && a.status !== "cancelled" && !editando ? (
              <Button variant="outline" size="sm" onClick={abrirEdicao} disabled={staleDraft}>
                {t("Editar compromisso")}
              </Button>
            ) : null}
          </div>
        </SheetHeader>
        {/*
          Respiro entre o cabeçalho (título + Editar) e o cartão de
          sincronização: sem ele os dois blocos colavam.
        */}
        {(a?.google_sync || a?.meeting) && (
          <div className="mt-4 space-y-4">
            {a?.google_sync && (
              <SincronizacaoDoCompromisso
                key={a.id}
                id={a.id}
                sync={a.google_sync}
                onSaved={() => void query.refetch()}
              />
            )}
            {a?.meeting && (
              <MeetDoCompromisso
                id={a.id}
                revision={a.google_sync?.revision ?? String(a.revision)}
                meeting={a.meeting}
                onSaved={() => void query.refetch()}
              />
            )}
          </div>
        )}
        {query.isPending ? (
          <p>{t("Carregando…")}</p>
        ) : query.isError ? (
          <div role="alert">
            <p>{t("Este compromisso está indisponível para você.")}</p>
            <Button onClick={() => void query.refetch()}>{t("Tentar novamente")}</Button>
          </div>
        ) : a && formatoDeData ? (
          <div className="mt-5 space-y-5 text-sm">
            {/*
              EDIÇÃO DE COMPROMISSO (9015). O formulário abre AQUI, logo abaixo
              da sincronização — e não no fim da folha, onde ninguém procura.
              Os campos editáveis — título, paciente, horário, tipo, profissional e
              observação —
              com a mesma revisão otimista dos botões de presença (`decide` +
              `staleDraft`): quem salvou por fora no meio do caminho continua
              recebendo o 409 e o aviso. O que muda no banco publicável sobe ao
              Google no próximo giro do push, e a troca de paciente pede
              confirmação antes.
            */}
            {podeEditar && a.status !== "cancelled" && editando ? (
              <div className="space-y-4 rounded-lg border p-3">
                <label className="block text-sm">
                  {t("Título")}
                  <input
                    data-testid="editar-titulo"
                    className="mt-2 w-full rounded-md border bg-surface p-2"
                    value={editTitulo}
                    maxLength={200}
                    onChange={(e) => {
                      beginDraft();
                      setEditTitulo(e.target.value);
                    }}
                  />
                </label>
                <VinculoDaMarcacao
                  contactId={editPaciente}
                  conversationId={editConversa}
                  onChange={(contact, conversation) => {
                    beginDraft();
                    setEditPaciente(contact);
                    setEditConversa(conversation);
                  }}
                />
                <label className="block">
                  {t("Horário")}
                  <input
                    data-testid="editar-horario"
                    type="datetime-local"
                    className="mt-2 w-full rounded-md border bg-surface p-2"
                    value={editInicio}
                    onChange={(e) => {
                      beginDraft();
                      setEditInicio(e.target.value);
                    }}
                  />
                </label>
                <label className="block">
                  {t("Tipo de agendamento")}
                  <select
                    data-testid="editar-tipo"
                    className="mt-2 w-full rounded-md border bg-surface p-2"
                    value={editTipo}
                    onChange={(e) => {
                      beginDraft();
                      setEditTipo(e.target.value);
                    }}
                  >
                    {tiposAtivos.length === 0 ? (
                      <option value={a.event_type_id ?? ""}>{t("Carregando tipos…")}</option>
                    ) : (
                      tiposAtivos.map((ti) => (
                        <option key={ti.id} value={ti.id}>
                          {ti.name} · {ti.duration_minutes}min
                        </option>
                      ))
                    )}
                  </select>
                </label>
                {tipos.isError ? (
                  <p role="alert">{t("Não foi possível carregar os tipos. Tente novamente.")}</p>
                ) : null}
                {pessoas && pessoas.length > 0 ? (
                  <label className="block">
                    {t("Profissional")}
                    <select
                      data-testid="editar-profissional"
                      className="mt-2 w-full rounded-md border bg-surface p-2"
                      value={editProfissional}
                      onChange={(e) => {
                        beginDraft();
                        setEditProfissional(e.target.value);
                      }}
                    >
                      {editProfissional ? null : (
                        <option value="">{t("Selecionar…")}</option>
                      )}
                      <optgroup label={t("Equipe")}>
                        {pessoas
                          .filter((p) => p.tipo !== "profissional")
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nome}
                            </option>
                          ))}
                      </optgroup>
                      {pessoas.some((p) => p.tipo === "profissional") ? (
                        <optgroup label={t("Profissionais")}>
                          {pessoas
                            .filter((p) => p.tipo === "profissional")
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nome}
                              </option>
                            ))}
                        </optgroup>
                      ) : null}
                    </select>
                  </label>
                ) : null}
                <label className="block">
                  {t("Observação")}{" "}
                  <span className="font-normal opacity-70">({t("opcional")})</span>
                  <textarea
                    data-testid="editar-observacao"
                    rows={2}
                    className="mt-2 w-full rounded-md border bg-surface p-2"
                    value={editObservacao}
                    placeholder={t("Como no Google Agenda: o que vai para o calendário")}
                    onChange={(e) => {
                      beginDraft();
                      setEditObservacao(e.target.value);
                    }}
                  />
                </label>
                <p className="text-xs text-text-muted">
                  {t("O que mudar aqui é atualizado na agenda do Google.")}
                </p>
                {confirmandoTroca ? (
                  <div
                    role="alertdialog"
                    aria-label={t("Confirmar troca de paciente")}
                    className="space-y-2 rounded-lg border p-3"
                  >
                    <p>
                      {t(
                        "Trocar o paciente deste compromisso? O convite na agenda do Google será atualizado: o paciente anterior sai e o novo entra.",
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        data-testid="confirmar-troca-paciente"
                        disabled={mutation.isPending || staleDraft}
                        onClick={() => salvarEdicao(true)}
                      >
                        {t("Confirmar troca")}
                      </Button>
                      <Button variant="outline" onClick={() => setConfirmandoTroca(false)}>
                        {t("Voltar")}
                      </Button>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    data-testid="salvar-edicao"
                    disabled={!editouAlgo || mutation.isPending || staleDraft}
                    onClick={() => salvarEdicao(false)}
                  >
                    {t("Salvar alterações")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditando(false);
                      setConfirmandoTroca(false);
                    }}
                  >
                    {t("Fechar edição")}
                  </Button>
                </div>
              </div>
            ) : null}
            <p data-testid="compromisso-horario">
              {formatoDeData.formatRange(new Date(a.starts_at), new Date(a.ends_at))}
            </p>
            {rotuloDoLocal(a.location_kind, a.location_details) ? (
              <p data-testid="compromisso-local">
                {rotuloDoLocal(a.location_kind, a.location_details)}
              </p>
            ) : null}
            {a.description?.trim() ? (
              <p data-testid="compromisso-observacao" className="whitespace-pre-wrap">
                {a.description}
              </p>
            ) : null}
            {/*
              A anotação INTERNA — o resumo que o assistente grava ao marcar, e o
              que quem vai atender precisa ler. É distinta da observação acima:
              aquela sobe para o calendário do cliente, esta fica no CRM. Com
              rótulo, e não o texto solto, porque as duas são texto livre no mesmo
              painel e sem rótulo ninguém sabe qual delas é interna.
            */}
            {a.notes?.trim() ? (
              <div data-testid="compromisso-anotacao">
                <p className="text-sm text-text-muted">{t("Anotação")}</p>
                <p className="whitespace-pre-wrap">{a.notes}</p>
              </div>
            ) : null}
            <p>
              {t(
                (
                  {
                    pending: "Aguardando confirmação",
                    confirmed: "Agendado",
                    completed: "Compareceu",
                    no_show: "Faltou",
                    cancelled: "Cancelado",
                  } as Record<string, string>
                )[a.status] ?? a.status,
              )}
            </p>
            {a.contact_id ? (
              <Link href={`/app/contacts/${a.contact_id}`} className="underline">
                {t("Ver contato")}
              </Link>
            ) : (
              <p>{t("Compromisso pessoal, sem cliente vinculado.")}</p>
            )}
            {a.outcome_recorded_at ? (
              <p>
                {t("Presença registrada pela equipe")}:{" "}
                {formatoDeData.format(new Date(a.outcome_recorded_at))}
              </p>
            ) : (
              <p>
                {t(
                  "O horário sozinho não confirma falta. A equipe precisa registrar o que aconteceu.",
                )}
              </p>
            )}
            {a.recovery ? (
              <div className="rounded-lg border p-3" role="status">
                <p>
                  {t(
                    a.recovery.invalidated_at && a.recovery.result === "started"
                      ? "Recuperação iniciada e interrompida porque o cliente respondeu."
                      : a.recovery.enrollment_status &&
                          ["cancelled", "completed", "dead"].includes(a.recovery.enrollment_status)
                        ? "Recuperação encerrada. Revise o próximo passo."
                        : (RESULTS[a.recovery.result] ?? "Revise o próximo passo."),
                  )}
                </p>
                {a.recovery.cancel_reason ? (
                  <p className="mt-2 text-sm">{a.recovery.cancel_reason}</p>
                ) : null}
                {a.recovery.enrollment_id ? (
                  <Link
                    className="underline"
                    href={`/app/ai/followups/enrollments/${a.recovery.enrollment_id}`}
                  >
                    {t("Abrir acompanhamento")}
                  </Link>
                ) : (
                  <Link className="underline" href="/app/ai/followups">
                    {t("Revisar acompanhamentos")}
                  </Link>
                )}
              </div>
            ) : a.status === "no_show" && a.contact_id && a.outcome_recorded_at ? (
              <div role="status" className="rounded-lg border p-3">
                <p>
                  {t("Falta confirmada. O resultado da recuperação ainda não está disponível.")}
                </p>
                <Link className="underline" href="/app/ai/followups">
                  {t("Revisar acompanhamentos")}
                </Link>
              </div>
            ) : null}
            {staleDraft ? (
              <div role="alert" className="space-y-2 rounded-lg border p-3">
                <p>
                  {t(
                    "O compromisso mudou ou a alteração não foi concluída. Revise os dados antes de decidir novamente.",
                  )}
                </p>
                <Button variant="outline" onClick={resetDraft}>
                  {t("Descartar rascunho e revisar")}
                </Button>
              </div>
            ) : null}
            {podeEditar && a.status !== "cancelled" ? (
              <div className="space-y-4">
                <label className="block">
                  {t("Mensagem do cliente usada como evidência (opcional)")}
                  <select
                    className="mt-2 w-full rounded-md border bg-surface p-2"
                    aria-label={t("Mensagem de evidência")}
                    value={evidence}
                    onChange={(e) => {
                      beginDraft();
                      setEvidence(e.target.value);
                    }}
                  >
                    <option value="">{t("Confirmação da equipe, sem mensagem")}</option>
                    {a.evidence_messages.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.body?.slice(0, 140) ?? t("Mensagem sem texto")}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-text-muted">
                  {t("Ao confirmar, você valida o significado da mensagem para este compromisso.")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["completed", "Compareceu"],
                      ["no_show", "Faltou"],
                    ] as const
                  ).map(([status, label]) => (
                    <Button
                      key={status}
                      onClick={() =>
                        decide({
                          status,
                          ...(evidence ? { outcome_message_id: evidence } : {}),
                        })
                      }
                      disabled={
                        mutation.isPending ||
                        staleDraft ||
                        Date.parse(a.starts_at) > query.dataUpdatedAt ||
                        a.status === status
                      }
                    >
                      {t(label)}
                    </Button>
                  ))}
                </div>
                {/*
                  O SIM que faltava. `pending` é pré-reserva: o horário já está
                  segurado, e só vira compromisso quando alguém aprova. A rota
                  aceita `confirmed` desde sempre, a IA escreve por
                  `crm_confirm_appointment` — e a tela, não. Sem este botão, num
                  negócio com `requires_confirmation` o pedido ou é confirmado
                  pelo cliente via IA, ou expira em `agenda-expira-pendentes`.
                */}
                {a.status === "pending" ? (
                  <Button
                    data-testid="confirmar-compromisso"
                    disabled={mutation.isPending || staleDraft}
                    onClick={() => decide({ status: "confirmed" })}
                  >
                    {t("Confirmar horário")}
                  </Button>
                ) : null}
                {["pending", "confirmed"].includes(a.status) ? (
                  <Button
                    variant="outline"
                    disabled={mutation.isPending || staleDraft}
                    onClick={() =>
                      decide({
                        confirmation_next_at: new Date(Date.now() + 60 * 60_000).toISOString(),
                      })
                    }
                  >
                    {t("Lembrar em uma hora")}
                  </Button>
                ) : null}
                <label className="block">
                  {t("Motivo do cancelamento")}
                  <input
                    className="mt-2 w-full rounded-md border bg-surface p-2"
                    value={reason}
                    onChange={(e) => {
                      beginDraft();
                      setReason(e.target.value);
                    }}
                  />
                </label>
                <Button
                  variant="outline"
                  disabled={!reason.trim() || cancel.isPending || staleDraft}
                  onClick={() => cancel.mutate({ revision: draftRevision ?? a.revision, reason })}
                >
                  {t("Cancelar agendamento")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
