"use client";

/**
 * O campo do logo — subir, ver nas DUAS superfícies, e remover.
 *
 * ── Por que a prévia mostra o logo sobre CLARO e ESCURO ──────────────────────
 *
 * O modo de falha campeão de logo em produto com dois temas é o arquivo escuro
 * com fundo transparente: fica perfeito na tela onde a pessoa subiu e some no
 * outro tema, que ela nunca abre. Descobrir isso pelo relato de um cliente é
 * caro; descobrir na hora do upload é grátis.
 *
 * E a prévia é a imagem REAL, renderizada pelo navegador sobre as duas
 * superfícies do produto. Foi a alternativa escolhida contra um analisador de
 * luminância no servidor: aquele exigiria decodificar PNG (bytes controlados por
 * quem sobe, mais guarda de bomba de descompressão), seria cego para PNG
 * entrelaçado e para JPEG, e terminaria escrevendo em português o que estas duas
 * caixas mostram com precisão total e zero linha de parser.
 *
 * As duas cores vêm da RÉGUA DO PRODUTO (`--color-surface` de cada tema), nunca
 * digitadas: são as mesmas superfícies onde o logo de fato aparece — a barra
 * lateral e o cartão do login. Um par de hexes escritos aqui viraria a quinta
 * cópia de uma cor que o produto já declara em um lugar só.
 *
 * ── Por que o upload é IMEDIATO, e não parte do "Salvar" do formulário ───────
 *
 * O arquivo tem rota própria (`/api/v1/marca/logo`) porque o que atravessa é
 * multipart, não JSON, e porque o ponteiro é gravado por um escritor próprio no
 * banco — a função da marca substitui o objeto inteiro e apagaria o logo. Juntar
 * os dois no mesmo botão significaria segurar bytes em memória do navegador até
 * alguém clicar em Salvar, e perder o arquivo em toda navegação acidental.
 *
 * ── Dois logos (light e dark) ───────────────────────────────────────────────
 *
 * Cada tema pode ter o próprio logo. O campo dark é OPCIONAL: se vazio, o logo
 * light é usado nos dois temas (backward compat). A prévia mostra cada logo
 * sobre o seu fundo para que a pessoa veja o resultado real antes de sair.
 */

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { melhorFrenteSobre } from "@/lib/branding/contraste";
import { TAMANHO_MAXIMO_DO_LOGO } from "@/lib/branding/logo";
import { REGUA_DO_PRODUTO } from "@/lib/branding/regua-do-produto";
import { useT } from "@/hooks/i18n/useT";

/** A superfície onde o logo de fato aparece, em cada tema. Lida, nunca digitada. */
function superficie(tema: "claro" | "escuro"): string {
  const encontrada = REGUA_DO_PRODUTO[tema].base.find((b) => b.chave === "--color-surface");
  return encontrada?.hex ?? REGUA_DO_PRODUTO[tema].base[0]?.hex ?? "#ffffff";
}

const SUPERFICIE_CLARA = superficie("claro");
const SUPERFICIE_ESCURA = superficie("escuro");

export type EscopoDoLogo = "instalacao" | "organizacao";
type VarianteDoLogo = "light" | "dark";

interface Props {
  readonly escopo: EscopoDoLogo;
  /**
   * O logo que ESTA camada gravou, já como URL pública. `url: null` = esta
   * camada não tem logo próprio — e aí quem aparece é `logoHerdado`.
   *
   * ⚠️ É um OBJETO, e não a string solta, e isso NÃO é enfeite: quem repõe o
   * estado local (lá embaixo) precisa distinguir "o servidor não falou" de "o
   * servidor falou e repetiu o mesmo valor". Com `string | null`, identidade é
   * igualdade — um render novo dizendo `null` para uma camada que já estava
   * `null` seria indistinguível de nenhum render, e a prévia ficaria grudada no
   * que o cliente escreveu. Com um objeto criado no call site, TODO render novo
   * do servidor traz identidade nova e volta ao comando.
   */
  readonly logoDaCamada: { readonly url: string | null };
  /** Logo da camada para o tema escuro. */
  readonly logoDaCamadaDark: { readonly url: string | null };
  /**
   * O que o produto mostra quando esta camada não tem nada. `null` = ninguém tem
   * logo, e a interface aparece com o NOME em texto.
   */
  readonly logoHerdado: string | null;
  /** Logo herdado para o tema escuro. */
  readonly logoHerdadoDark: string | null;
  /** Uma frase dizendo de quem é o logo herdado ("do sistema", "da instalação"). */
  readonly origemDoHerdado: string;
  /** O nome em vigor — vira o `alt` da prévia e o texto do caso sem logo. */
  readonly nomeEmVigor: string;
}

/** Mensagem por código de recusa da rota. */
const ERRO_EM_PORTUGUES: Record<string, string> = {
  unauthenticated: "Sua sessão expirou. Entre de novo para trocar o logo.",
  forbidden_role: "Você não tem permissão para trocar este logo.",
  forbidden_tenant: "Nenhuma empresa ativa nesta sessão.",
  mfa_required: "Confirme o segundo fator nesta sessão e tente de novo.",
  rate_limited: "Muitas trocas seguidas. Tente de novo em alguns minutos.",
};

interface InputDeLogoProps {
  readonly escopo: EscopoDoLogo;
  readonly variante: VarianteDoLogo;
  readonly label: string;
  readonly entradaRef: React.RefObject<HTMLInputElement | null>;
  readonly temLogo: boolean;
  readonly enviando: boolean;
  readonly onEnviar: (arquivo: File, variante: VarianteDoLogo) => void;
  readonly onRemover: (variante: VarianteDoLogo) => void;
  readonly t: (chave: string) => string;
}

function InputDeLogo({
  escopo,
  variante,
  label,
  entradaRef,
  temLogo,
  enviando,
  onEnviar,
  onRemover,
  t,
}: InputDeLogoProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={`logo-${escopo}-${variante}`}>{label}</Label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={entradaRef}
          id={`logo-${escopo}-${variante}`}
          type="file"
          accept="image/png,image/jpeg"
          disabled={enviando}
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) void onEnviar(arquivo, variante);
          }}
          className="max-w-xs text-sm file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-border file:bg-surface-elevated file:px-3 file:py-1.5 file:text-sm"
        />
        {temLogo ? (
          <Button type="button" variant="outline" onClick={() => void onRemover(variante)} disabled={enviando}>
            {t("Remover")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function CampoDeLogo({
  escopo,
  logoDaCamada,
  logoDaCamadaDark,
  logoHerdado,
  logoHerdadoDark,
  origemDoHerdado,
  nomeEmVigor,
}: Props) {
  const t = useT();
  const router = useRouter();
  const entradaLight = useRef<HTMLInputElement>(null);
  const entradaDark = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const hidratado = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [, startTransition] = useTransition();

  // Estado local para cada variante — o servidor define, o cliente atualiza após upload.
  const [logoGravadoLight, setLogoGravadoLight] = useState<string | null>(logoDaCamada.url);
  const [ultimoDoServidorLight, setUltimoDoServidorLight] = useState(logoDaCamada);
  if (logoDaCamada !== ultimoDoServidorLight) {
    setUltimoDoServidorLight(logoDaCamada);
    setLogoGravadoLight(logoDaCamada.url);
  }

  const [logoGravadoDark, setLogoGravadoDark] = useState<string | null>(logoDaCamadaDark.url);
  const [ultimoDoServidorDark, setUltimoDoServidorDark] = useState(logoDaCamadaDark);
  if (logoDaCamadaDark !== ultimoDoServidorDark) {
    setUltimoDoServidorDark(logoDaCamadaDark);
    setLogoGravadoDark(logoDaCamadaDark.url);
  }

  // O que aparece em cada preview: próprio da camada > herdado > fallback para a outra variante.
  const emVigorLight = logoGravadoLight ?? logoHerdado;
  const emVigorDark = logoGravadoDark ?? logoHerdadoDark ?? logoGravadoLight ?? logoHerdado;

  async function logoDaResposta(resposta: Response): Promise<string | null | undefined> {
    const corpo = (await resposta.json().catch(() => null)) as
      | { data?: { logo_url?: string | null } }
      | null;
    return corpo?.data?.logo_url;
  }

  async function razaoDaFalha(resposta: Response): Promise<string> {
    const corpo = (await resposta.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    const codigo = corpo?.error?.code ?? "";
    return t(ERRO_EM_PORTUGUES[codigo] ?? corpo?.error?.message ?? "Não consegui trocar o logo agora.");
  }

  async function enviar(arquivo: File, variante: VarianteDoLogo) {
    setEnviando(true);
    try {
      const corpo = new FormData();
      corpo.set("escopo", escopo);
      corpo.set("variant", variante);
      corpo.set("file", arquivo);
      const resposta = await fetch("/api/v1/marca/logo", { method: "POST", body: corpo });
      if (!resposta.ok) {
        toast.error(await razaoDaFalha(resposta));
        return;
      }
      toast.success(t("Logo atualizado."));
      const gravado = await logoDaResposta(resposta);
      if (gravado !== undefined) {
        if (variante === "dark") setLogoGravadoDark(gravado);
        else setLogoGravadoLight(gravado);
      }
      startTransition(() => router.refresh());
    } finally {
      setEnviando(false);
      const entrada = variante === "dark" ? entradaDark : entradaLight;
      if (entrada.current) entrada.current.value = "";
    }
  }

  async function remover(variante: VarianteDoLogo) {
    setEnviando(true);
    try {
      const resposta = await fetch(`/api/v1/marca/logo?escopo=${escopo}&variant=${variante}`, { method: "DELETE" });
      if (!resposta.ok) {
        toast.error(await razaoDaFalha(resposta));
        return;
      }
      toast.success(t("Logo removido."));
      const gravado = await logoDaResposta(resposta);
      if (gravado !== undefined) {
        if (variante === "dark") setLogoGravadoDark(gravado);
        else setLogoGravadoLight(gravado);
      }
      startTransition(() => router.refresh());
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4" data-campo-de-logo={escopo} data-hidratado={hidratado ? "" : undefined}>
      <InputDeLogo
        escopo={escopo}
        variante="light"
        label={t("Logo para aparência clara")}
        entradaRef={entradaLight}
        temLogo={!!logoGravadoLight}
        enviando={enviando}
        onEnviar={enviar}
        onRemover={remover}
        t={t}
      />
      <InputDeLogo
        escopo={escopo}
        variante="dark"
        label={t("Logo para aparência escura (opcional)")}
        entradaRef={entradaDark}
        temLogo={!!logoGravadoDark}
        enviando={enviando}
        onEnviar={enviar}
        onRemover={remover}
        t={t}
      />
      <p className="text-xs text-text-muted">
        {t("PNG ou JPG, até")} {Math.round(TAMANHO_MAXIMO_DO_LOGO / 1024)}{" "}
        {t(
          "KB. Prefira fundo transparente. SVG não é aceito: ele pode executar código quando aberto direto pelo endereço da imagem.",
        )}
      </p>
      {logoGravadoDark ? null : (
        <p className="text-xs text-text-muted">
          {t("Sem logo escuro, o sistema usa o logo claro nos dois temas.")}
        </p>
      )}

      <div className="space-y-2">
        <p className="text-sm text-text-muted">
          {logoGravadoLight || logoGravadoDark
            ? t("Como o logo aparece nas duas aparências do sistema:")
            : `${t("Sem logo próprio, o sistema usa o logo")} ${t(origemDoHerdado)}. ${t("Assim ele aparece:")}`}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              { rotulo: t("Aparência clara"), fundo: SUPERFICIE_CLARA, logo: emVigorLight },
              { rotulo: t("Aparência escura"), fundo: SUPERFICIE_ESCURA, logo: emVigorDark },
            ] as const
          ).map(({ rotulo, fundo, logo }) => (
            <div key={rotulo} className="space-y-1">
              <div
                data-previa-do-logo={rotulo === t("Aparência clara") ? "claro" : "escuro"}
                className="flex h-24 items-center justify-center rounded-sm border border-border px-4"
                style={{ backgroundColor: fundo }}
              >
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logo}
                    alt={nomeEmVigor}
                    className="max-h-12 w-auto max-w-full object-contain"
                  />
                ) : (
                  <span
                    className="text-sm font-semibold tracking-tight"
                    style={{ color: melhorFrenteSobre(fundo) }}
                  >
                    {nomeEmVigor}
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted">{t(rotulo)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
