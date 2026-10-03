"use client";
/**
 * A tela dos dias fora da rotina — os que FECHAM e os que ABREM.
 *
 * Existe porque `calendar_availability_exceptions` era respeitada pelo motor de
 * horários livres desde a migration 0177 e **não tinha como receber uma linha**:
 * nem rota, nem tela, nem action. Quem precisasse fechar a agenda num feriado
 * marcava um compromisso falso de dia inteiro — que polui a agenda, conta como
 * atendimento e aparece na timeline do lead.
 *
 * ## Por que ABRIR também mora aqui
 *
 * A coluna `is_unavailable` sempre teve os dois sentidos, a rota sempre aceitou
 * os dois (`POST /api/v1/agenda/excecoes` audita `agenda.dia_bloqueado` OU
 * `agenda.dia_aberto`) e a lista abaixo sempre soube rotular o segundo
 * ("aberto excepcionalmente"). Só o formulário não: ele mandava
 * `is_unavailable: true` e dia inteiro, fixos. Metade da capacidade existia no
 * banco, na rota, no motor e na listagem, e não tinha por onde entrar —
 * invariante 6 do Sistema Vivo.
 *
 * Quem paga por isso é quem NÃO trabalha em jornada semanal fixa. Medido numa
 * instalação real (clínica com atendimento em dias irregulares, cada dia numa
 * unidade): a jornada semanal fica vazia de propósito, para todo dia nascer
 * fechado, e cada data de atendimento é uma exceção ABERTA. Essa agenda não
 * tinha como ser montada pela tela — só por SQL.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

type Excecao = {
  id: string;
  user_id: string | null;
  provider_id: string | null;
  exception_date: string;
  is_unavailable: boolean;
  start_minute: number;
  end_minute: number;
  reason: string | null;
};

type ProfissionalOpcao = { id: string; nome: string };

const DIA_INTEIRO = { start_minute: 0, end_minute: 1440 };

/**
 * Um ano de repetição semanal, e o motivo é o dedo escorregando na data: um
 * "2036" digitado sem querer viraria 520 requisições e 520 linhas para apagar
 * uma a uma. Cinquenta e três cobre o ano inteiro, que é o horizonte de quem
 * publica agenda.
 */
const TETO_DA_REPETICAO = 53;

/** "0..1440" vira "o dia todo"; o resto vira "09:00–12:00". */
function faixa(e: Excecao, t: (s: string) => string): string {
  if (e.start_minute === 0 && e.end_minute === 1440) return t("o dia todo");
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${hhmm(e.start_minute)}–${hhmm(e.end_minute)}`;
}

/**
 * As datas de uma repetição SEMANAL, da primeira até o limite, inclusive.
 *
 * Meio-dia UTC de propósito: `new Date("2026-10-01")` nasce à meia-noite UTC e,
 * somado a fusos a oeste, volta um dia ao ser formatado. Ancorar no meio-dia tira
 * o horário de verão e a virada de dia da conta — a aritmética aqui é de DIAS.
 */
function datasSemanais(inicio: string, ate: string, teto: number): string[] {
  const fim = new Date(`${ate}T12:00:00Z`).getTime();
  const datas: string[] = [];
  for (let d = new Date(`${inicio}T12:00:00Z`); d.getTime() <= fim; d.setUTCDate(d.getUTCDate() + 7)) {
    if (datas.length >= teto) break;
    datas.push(d.toISOString().slice(0, 10));
  }
  return datas;
}

/** "14:00" vira 840 — o caminho inverso do `faixa` acima. */
function emMinutos(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Os dias CORRIDOS de `inicio` até `fim`, inclusive — o "período" de umas
 * férias ou de um congresso. Mesmo truque de meio-dia UTC do semanal acima:
 * a aritmética aqui é de DIAS, não de instantes.
 */
function datasConsecutivas(inicio: string, fim: string, teto: number): string[] {
  const limite = new Date(`${fim}T12:00:00Z`).getTime();
  const datas: string[] = [];
  for (let d = new Date(`${inicio}T12:00:00Z`); d.getTime() <= limite; d.setUTCDate(d.getUTCDate() + 1)) {
    if (datas.length >= teto) break;
    datas.push(d.toISOString().slice(0, 10));
  }
  return datas;
}

export function DiasBloqueados({
  podeEditar,
  profissionais,
}: {
  podeEditar: boolean;
  /**
   * Com a lista, vira o fechamento de PROFISSIONAL externo: só fecha (sem o
   * modo abrir), para um ou mais selecionados, num dia ou num período corrido.
   * Sem ela, é o comportamento original — a agenda do próprio usuário.
   */
  profissionais?: ProfissionalOpcao[];
}) {
  const t = useT();
  const qc = useQueryClient();
  const modoProfissional = profissionais !== undefined;
  const [data, setData] = useState("");
  const [motivo, setMotivo] = useState("");
  const [modo, setModo] = useState<"fechar" | "abrir">("fechar");
  const [de, setDe] = useState("08:00");
  const [ate, setAte] = useState("12:00");
  const [repetirAte, setRepetirAte] = useState("");
  const [atePeriodo, setAtePeriodo] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [resultado, setResultado] = useState<{ criados: number; pulados: number } | null>(null);

  const abrindo = !modoProfissional && modo === "abrir";
  // O CHECK do banco é `end_minute > start_minute`; barrar aqui troca um 422 por
  // um botão que não deixa errar.
  const faixaInvalida = abrindo && emMinutos(ate) <= emMinutos(de);

  const query = useQuery({
    queryKey: ["agenda", "excecoes"],
    queryFn: async () =>
      (await apiClient.get<{ data: Excecao[] }>("/api/v1/agenda/excecoes")).data,
  });

  // A mesma lista do GET serve aos dois modos; cada um só enxerga as linhas do
  // seu dono — sem isso, o fechamento do dentista apareceria na tela "minha
  // agenda" e vice-versa.
  const lista = (query.data ?? []).filter((e) =>
    modoProfissional ? e.provider_id != null : e.provider_id == null,
  );
  const nomeDoProfissional = new Map((profissionais ?? []).map((p) => [p.id, p.nome]));

  const invalidar = () => {
    // A agenda também muda: um dia fechado tira horários da consulta.
    void qc.invalidateQueries({ queryKey: ["agenda"] });
  };

  const criar = useMutation({
    mutationFn: async () => {
      const faixa = abrindo
        ? { start_minute: emMinutos(de), end_minute: emMinutos(ate) }
        : // Dia FECHADO é sempre inteiro — fechar meio dia é o caso de quem ABRE
          // o outro meio, e esse caminho é o de cima.
          DIA_INTEIRO;
      const dias = modoProfissional
        ? atePeriodo && atePeriodo >= data
          ? datasConsecutivas(data, atePeriodo, TETO_DA_REPETICAO)
          : [data]
        : repetirAte
          ? datasSemanais(data, repetirAte, TETO_DA_REPETICAO)
          : [data];
      // Um pedido por (dono, dia): no modo profissional, um por profissional
      // por dia. O lote continua sendo da tela — ver comentário abaixo.
      const donos = modoProfissional ? selecionados : [null];
      const alvos: Array<{ dono: string | null; dia: string }> = [];
      for (const dono of donos) for (const dia of dias) alvos.push({ dono, dia });

      // O QUE JÁ EXISTE É PULADO, e não recusado.
      //
      // A tabela não tem unicidade por data — de propósito, porque um dia pode
      // ter duas faixas abertas (manhã num lugar, tarde noutro). Sem esta
      // conferência, repetir duas vezes o mesmo trimestre dobraria cada linha
      // em silêncio, e o dono só descobriria pela lista crescendo. A chave leva
      // o profissional junto (o mesmo feriado vale para cada um separado); no
      // modo usuário ela é vazia dos dois lados, como sempre foi — incluir
      // `user_id` aqui quebraria a dedupe em produção, onde as linhas o têm.
      const chave = (dono: string | null, e: Pick<Excecao, "provider_id" | "exception_date" | "start_minute" | "end_minute" | "is_unavailable">) =>
        `${dono ?? e.provider_id ?? ""}|${e.exception_date}|${e.start_minute}|${e.end_minute}|${e.is_unavailable}`;
      const jaTem = new Set(
        lista
          .filter((e) => e.is_unavailable === !abrindo)
          .map((e) => chave(null, e)),
      );
      const novos = alvos.filter(
        (a) =>
          !jaTem.has(
            `${a.dono ?? ""}|${a.dia}|${faixa.start_minute}|${faixa.end_minute}|${!abrindo}`,
          ),
      );

      // Em série, e não em paralelo: são poucas requisições e o servidor de
      // quem se auto-hospeda é pequeno. Cada dia é uma linha real e uma linha
      // de auditoria — o lote é da tela, não do banco.
      for (const { dono, dia } of novos) {
        await apiClient.post("/api/v1/agenda/excecoes", {
          exception_date: dia,
          is_unavailable: !abrindo,
          ...(dono ? { provider_id: dono } : {}),
          ...faixa,
          ...(motivo.trim() ? { reason: motivo.trim() } : {}),
        });
      }
      return { criados: novos.length, pulados: alvos.length - novos.length };
    },
    onSuccess: (r) => {
      setData("");
      setMotivo("");
      setRepetirAte("");
      setAtePeriodo("");
      setResultado(r);
      invalidar();
    },
    onError: showApiError,
  });

  const remover = useMutation({
    mutationFn: (id: string) => apiClient.delete("/api/v1/agenda/excecoes", { id }),
    onSuccess: invalidar,
    onError: showApiError,
  });

  // Fechar para N profissionais exige escolher QUEM: sem ninguém marcado o
  // botão não deixa errar (padrão começa vazio de propósito — fechar a agenda
  // de todo mundo sem querer não se desfaz com um clique).
  const semAlvo = modoProfissional && selecionados.length === 0;

  const alternarProfissional = (id: string) =>
    setSelecionados((atuais) =>
      atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id],
    );

  return (
    <section className="space-y-3 rounded-xl border p-4" data-testid="dias-bloqueados">
      <h2 className="font-semibold">{t("Dias fora da rotina")}</h2>
      <p className="text-sm text-text-muted">
        {modoProfissional
          ? t(
              "Feche um dia ou um período (feriado, férias, motivo particular) para um ou mais profissionais. Em dia fechado a IA deixa de oferecer horários com ele, e o que já estava marcado continua marcado, para você decidir o que fazer com cada um.",
            )
          : t(
              "Feche um dia (feriado, férias, viagem) ou abra um dia que a sua jornada semanal não cobre. Em dia fechado o sistema deixa de oferecer horários, e o que já estava marcado continua marcado, para você decidir o que fazer com cada um.",
            )}
      </p>

      {podeEditar ? (
        <div className="flex flex-wrap items-end gap-2">
          {modoProfissional ? (
            <fieldset className="block">
              <span className="block text-sm">{t("Profissionais")}</span>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 rounded-md border p-2">
                {(profissionais ?? []).map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={selecionados.includes(p.id)}
                      onChange={() => alternarProfissional(p.id)}
                    />
                    {p.nome}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <label className="block">
              <span className="block text-sm">{t("O que fazer")}</span>
              <select
                aria-label={t("O que fazer")}
                className="mt-1 rounded-md border p-2"
                data-testid="modo-do-dia"
                value={modo}
                onChange={(e) => setModo(e.target.value === "abrir" ? "abrir" : "fechar")}
              >
                <option value="fechar">{t("Fechar o dia")}</option>
                <option value="abrir">{t("Abrir para atendimento")}</option>
              </select>
            </label>
          )}
          <label className="block">
            <span className="block text-sm">{modoProfissional ? t("Dia inicial") : t("Dia")}</span>
            <input
              aria-label={modoProfissional ? t("Dia inicial") : t("Dia")}
              className="mt-1 rounded-md border p-2"
              type="date"
              value={data}
              onChange={(e) => {
                setData(e.target.value);
                setResultado(null);
              }}
            />
          </label>
          {abrindo ? (
            <>
              <label className="block">
                <span className="block text-sm">{t("Das")}</span>
                <input
                  aria-label={t("Das")}
                  className="mt-1 rounded-md border p-2"
                  type="time"
                  value={de}
                  onChange={(e) => setDe(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="block text-sm">{t("Até")}</span>
                <input
                  aria-label={t("Até")}
                  className="mt-1 rounded-md border p-2"
                  type="time"
                  value={ate}
                  onChange={(e) => setAte(e.target.value)}
                />
              </label>
            </>
          ) : null}
          <label className="block flex-1">
            <span className="block text-sm">{t("Motivo (opcional)")}</span>
            <input
              aria-label={t("Motivo (opcional)")}
              className="mt-1 w-full rounded-md border p-2"
              maxLength={200}
              placeholder={t("Ex.: feriado")}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </label>
          {modoProfissional ? (
            <label className="block">
              <span className="block text-sm">{t("Até (opcional)")}</span>
              <input
                aria-label={t("Até (opcional)")}
                className="mt-1 rounded-md border p-2"
                type="date"
                min={data || undefined}
                value={atePeriodo}
                onChange={(e) => setAtePeriodo(e.target.value)}
              />
            </label>
          ) : (
            <label className="block">
              <span className="block text-sm">{t("Repetir toda semana até (opcional)")}</span>
              <input
                aria-label={t("Repetir toda semana até (opcional)")}
                className="mt-1 rounded-md border p-2"
                type="date"
                min={data || undefined}
                value={repetirAte}
                onChange={(e) => setRepetirAte(e.target.value)}
              />
            </label>
          )}
          <Button
            // Alvo de toque generoso: esta tela também é usada no celular.
            className="min-h-11"
            disabled={!data || criar.isPending || faixaInvalida || semAlvo}
            onClick={() => criar.mutate()}
          >
            {abrindo ? t("Abrir este dia") : modoProfissional ? t("Fechar dias") : t("Fechar este dia")}
          </Button>
          {faixaInvalida ? (
            <p className="w-full text-sm text-destructive">
              {t("A hora final precisa ser maior que a inicial.")}
            </p>
          ) : null}
          {resultado ? (
            // Dizer QUANTOS, e quantos já existiam, é o que diferencia "repeti
            // sem querer" de "não aconteceu nada". No modo profissional cada
            // (profissional, dia) é um bloqueio próprio.
            <p className="w-full text-sm text-text-muted" data-testid="resultado-do-lote">
              {modoProfissional
                ? `${resultado.criados} ${t("bloqueio(s) gravado(s)")}`
                : `${resultado.criados} ${t("dia(s) gravado(s)")}`}
              {resultado.pulados > 0 ? ` · ${resultado.pulados} ${t("já existia(m)")}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {query.isError ? (
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("Tentar novamente")}
        </Button>
      ) : query.isLoading ? (
        <p>{t("Carregando…")}</p>
      ) : lista.length === 0 ? (
        <p className="text-sm text-text-muted">{t("Nenhum dia fora da rotina daqui para a frente.")}</p>
      ) : (
        <ul className="space-y-1">
          {lista.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {modoProfissional && e.provider_id
                  ? `${nomeDoProfissional.get(e.provider_id) ?? t("Profissional")} · `
                  : ""}
                {new Date(`${e.exception_date}T12:00:00`).toLocaleDateString()} · {faixa(e, t)}
                {e.is_unavailable ? "" : ` · ${t("aberto excepcionalmente")}`}
                {e.reason ? ` · ${e.reason}` : ""}
              </span>
              {podeEditar ? (
                <Button
                  variant="ghost"
                  className="min-h-11"
                  disabled={remover.isPending}
                  onClick={() => remover.mutate(e.id)}
                >
                  {t("Reabrir")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
