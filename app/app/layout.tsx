import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isMfaEnrolled, loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { DEFAULT_VISIBILITY_MODE, type VisibilityMode } from "@/lib/auth/types";
import { empresaExigeMfa, exigeCadastroDeMfa } from "@/lib/auth/politica-mfa";
import { AuthProvider } from "@/hooks/auth/AuthProvider";
import { AppShell } from "./_components/AppShell";
import { EstiloDaMarcaDaOrganizacao } from "./_components/EstiloDaMarcaDaOrganizacao";
import { MfaEnrollGate } from "@/components/auth/MfaEnrollGate";
import { cssDaMarca, ESCOPO_DA_ORGANIZACAO } from "@/lib/branding/css";
import { marcaDaInstalacao } from "@/lib/branding/instalacao";
import { resolverMarcaDaOrganizacao } from "@/lib/branding/organizacao";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  IMPERSONATE_COOKIE_NAME,
  verifyImpersonateCookie,
} from "@/lib/impersonate/cookie";
import {
  ImpersonateBanner,
  type ImpersonatingInfo,
} from "@/components/app/ImpersonateBanner";
import { ConexaoCaidaBanner } from "@/components/app/ConexaoCaidaBanner";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { listarConexoesCaidas, type ConexaoCaida } from "@/lib/channels/health";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await loadAuthUser();
  if (!user) redirect("/login");

  let activeOrg = await resolveActiveOrg(user);

  const admin = createAdminClient();

  // Paraleliza leituras independentes de banco, cookies e marca.
  // A conexão caiu? A consulta mora no seam (`lib/channels/health`), não aqui:
  // await listarConexoesCaidas(admin, activeOrg.orgId)
  const orgPromise = activeOrg
    ? admin
        .from("organizations")
        .select("onboarded_at, status, settings")
        .eq("id", activeOrg.orgId)
        .maybeSingle()
    : Promise.resolve({ data: null });

  const conexoesPromise = activeOrg
    ? listarConexoesCaidas(admin, activeOrg.orgId)
    : Promise.resolve([] as ConexaoCaida[]);

  const cookiesPromise = cookies();
  const mfaPromise = isMfaEnrolled();
  const paPromise = user.is_platform_admin
    ? admin
        .from("platform_admins")
        .select("mfa_required")
        .eq("user_id", user.id)
        .is("revoked_at", null)
        .maybeSingle()
    : Promise.resolve(null);
  const brandInstalacaoPromise = marcaDaInstalacao();

  const [{ data: orgRow }, conexoesCaidas, store, enrolled, paRes, brandInstalacao] =
    await Promise.all([
      orgPromise,
      conexoesPromise,
      cookiesPromise,
      mfaPromise,
      paPromise,
      brandInstalacaoPromise,
    ]);

  // EPIC-02: gate /app/* on completed onboarding.
  // EPIC-11: gate /app/* on org not being suspended (S-11.08).
  if (orgRow && !orgRow.onboarded_at) redirect("/onboarding");
  if (orgRow?.status === "suspended") redirect("/account-suspended");

  let cssDaOrganizacao: string | null = null;

  if (activeOrg) {
    // G4-02: expõe visibility_mode ao client (inbox decide visões visíveis).
    // Fonte confiável (admin client, org do cookie validado) — nunca do body.
    const mode = (orgRow?.settings as { visibility_mode?: VisibilityMode } | null)
      ?.visibility_mode;
    activeOrg = { ...activeOrg, visibility_mode: mode ?? DEFAULT_VISIBILITY_MODE };

    // `marcaDaInstalacao()` é memoizada por TTL no PROCESSO (`lib/branding/
    // instalacao.ts`), e a derivação da cor é cacheada por régua+semente em
    // `resolve.ts` — a marca custa uma consulta a cada 30s e um lookup de Map
    // por render, não uma derivação de rampa por requisição.
    const marca = resolverMarcaDaOrganizacao(
      orgRow?.settings ?? null,
      brandInstalacao,
      env,
    );

    // SÓ quando a cor veio mesmo da organização.
    if (marca.origens.cor === "organizacao") {
      cssDaOrganizacao = cssDaMarca(marca.cor, ESCOPO_DA_ORGANIZACAO).css;
    }

    const marcaDoTenant = {
      ...(marca.origens.nome === "organizacao" ? { nome: marca.name } : {}),
      ...(marca.origens.logoUrl === "organizacao" && marca.logoUrl !== null
        ? { logoUrl: marca.logoUrl }
        : {}),
      // `logoUrlDark` tem o MESMO destino do logo claro: sem ele, o logo escuro
      // do tenant era descartado aqui e a barra caía no logo escuro da
      // INSTALAÇÃO em todo tema escuro — o tenant não via o logo próprio dele
      // nunca, e "nem sempre" a logo acompanhava o tema (só sem personalização).
      ...(marca.origens.logoUrlDark === "organizacao" && marca.logoUrlDark !== null
        ? { logoUrlDark: marca.logoUrlDark }
        : {}),
    };
    if (Object.keys(marcaDoTenant).length > 0) {
      activeOrg = { ...activeOrg, marca: marcaDoTenant };
    }
  }

  // Read sidebar collapsed state SSR to avoid flash.
  const collapsed = store.get("sidebar_collapsed")?.value === "1";

  // Impersonate (S-11.07): verify cookie server-side and resolve tenant name.
  // Middleware already validates HMAC + expiry on /app/*; we re-verify here as
  // defence-in-depth and to extract the payload safely.
  let impersonating: ImpersonatingInfo | null = null;
  const impCookie = store.get(IMPERSONATE_COOKIE_NAME)?.value;
  if (impCookie) {
    const result = verifyImpersonateCookie(impCookie);
    if (result.valid && result.payload) {
      const { data: org } = await admin
        .from("organizations")
        .select("display_name")
        .eq("id", result.payload.tenantId)
        .maybeSingle();
      if (org) {
        impersonating = {
          tenantId: result.payload.tenantId,
          tenantName: org.display_name,
          expiresAt: new Date(result.payload.exp * 1000).toISOString(),
        };
      }
    }
  }

  // A decisão lê a política da plataforma e da empresa sem reconsultar `settings`
  const plataformaExige = (paRes?.data?.mfa_required as boolean | undefined) ?? null;
  const empresaExige = empresaExigeMfa(orgRow?.settings);
  const needsMfaGate = exigeCadastroDeMfa({
    role: activeOrg?.role,
    isPlatformAdmin: user.is_platform_admin,
    plataformaExige,
    empresaExige,
  });

  const shell = <AppShell sidebarCollapsed={collapsed}>{children}</AppShell>;

  return (
    // O idioma envolve a árvore inteira e recebe o código PRONTO — ele não
    // pergunta quem está logado. Ver `lib/i18n/IdiomaProvider`: foi o
    // acoplamento com a autenticação que derrubou 32 casos.
    <IdiomaProvider locale={user.idioma}>
    <AuthProvider user={user} activeOrg={activeOrg}>
      {/*
        O MARCADOR da marca da organização — o elemento cuja existência define o
        escopo `body:has([data-marca-org])` (lib/branding/css.ts).

        `contents` não gera caixa: no box tree os filhos continuam sendo filhos
        diretos do `<body>`, então nada de layout, `position` ou `flex` muda. O
        que este elemento existe para fazer é EXISTIR — e sumir junto com esta
        subárvore quando o logout navega para `/login`.

        Envolve TUDO, e não a div do `AppShell`, porque aquela div é irmã dos dois
        banners e é SUBSTITUÍDA quando o `MfaEnrollGate` bloqueia (ele renderiza
        um `fixed inset-0` no lugar dos children). O admin de tenant recém-criado
        veria a tela de cadastro de MFA — a PRIMEIRA tela dele — com a cor da
        instalação, e depois o resto do produto com a dele.
      */}
      <div data-marca-org="" className="contents">
        <EstiloDaMarcaDaOrganizacao css={cssDaOrganizacao} />
        <ImpersonateBanner impersonating={impersonating} />
        <ConexaoCaidaBanner caidas={conexoesCaidas} />
        {needsMfaGate ? (
          // Gate always mounted for MFA-required roles; it latches the blocking
          // decision client-side so the enroll Server Action's revalidation
          // can't tear down the recovery-codes screen mid-flow.
          <MfaEnrollGate enrolled={enrolled}>{shell}</MfaEnrollGate>
        ) : (
          shell
        )}
      </div>
    </AuthProvider>
    </IdiomaProvider>
  );
}
