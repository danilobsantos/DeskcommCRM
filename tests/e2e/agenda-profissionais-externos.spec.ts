import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { test, expect, esperarARevelacao } from "./helpers/test";
import { lerCreds } from "./helpers/login-admin";

/**
 * PROFISSIONAIS EXTERNOS — editar, fechar dia e sumir da lista da IA.
 *
 * O que esta spec prova, ponta a ponta, como uma secretária faria:
 *
 *   1. A página `/app/agenda/profissionais` lista o profissional semeado.
 *   2. O botão "Editar" troca nome + especialidades (com reload, como o produto
 *      faz — recarregar aqui prova o servidor, que é o que está sob teste).
 *   3. Fechar o dia em "Dias fora da rotina" tira TODOS os horários daquele
 *      profissional naquele dia — medido pela MESMA rota que a tela e a IA
 *      usam (`GET /api/v1/agenda/horarios-livres`), antes (>0) e depois (=0).
 *   4. Inabilitar (Switch) tira o profissional do jogo: a consulta recusa com
 *      422, e o filtro `apenasAtivos` de `crm_list_providers` (a porta que a
 *      IA consulta) é provado em unit, porque a tool não tem rota HTTP.
 *
 * O que ela NÃO prova: o turno da IA oferecendo ou recusando (isso é da
 * `agente-marca-consulta`, com atendente-usuário). Aqui a IA entra só pela
 * ferramenta que ela leria. O push (escrita no Google) também fica de fora:
 * sem OAuth de verdade no CI, ele é provado em unit (transporte fake) e no
 * banco (invariante).
 *
 * Seed: a spec semeia o que precisa (flag `providers_enabled`, profissional
 * com jornada seg–sex SP, tipo `consulta-e2e` via `seed-e2e-agenda.ts`) —
 * idempotente, sem apagar nada, como manda o molde `agenda-marcar-pela-tela`.
 * O caso do Google semeia ainda: conexão + calendário + vínculo + evento
 * espelhado via service_role (só a via de LEITURA — horarios-livres e grade —
 * é exercitada, sem HTTP no Google).
 */
const RAIZ = path.resolve(__dirname, "../..");
const CREDS_PATH = path.join(RAIZ, ".e2e-creds.json");

const NOME_INICIAL = "Dra. E2E";
const NOME_EDITADO = "Dra. E2E Silva";
const ESPECIALIDADES = ["clínica geral", "prótese"];
const FUSO = "America/Sao_Paulo";

interface Creds {
  org_id: string;
  password: string;
  users: Record<string, { id: string; email: string; role: string } | undefined>;
  agenda?: { tipo_nome: string; tipo_slug: string };
}

/** Hoje em São Paulo, em AAAA-MM-DD — o dia civil da regra, não o do runner. */
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** O próximo dia útil (seg–sex) com pelo menos 2 dias de folga do aviso. */
function proximoDiaUtil(): string {
  const base = new Date(`${hojeSP()}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + 2);
  while (base.getUTCDay() === 0 || base.getUTCDay() === 6) {
    base.setUTCDate(base.getUTCDate() + 1);
  }
  return base.toISOString().slice(0, 10);
}

async function semear(): Promise<{ orgId: string; providerId: string; tipoId: string; dia: string }> {
  let creds = (
    fs.existsSync(CREDS_PATH) ? JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) : lerCreds()
  ) as Creds;
  if (!creds.agenda) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-agenda.ts"], { stdio: "inherit" });
    creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  }
  if (!creds.agenda) throw new Error("seed-e2e-agenda não gravou o bloco `agenda`");
  const orgId = creds.org_id;

  const sup = credenciaisSupabaseDeTeste();
  const admin = createClient(sup.url, sup.serviceRole, { auth: { persistSession: false } });

  // A flag é OPT-IN por tenant: sem ela a página redireciona para /app/agenda.
  // Merge não-destrutivo — o settings tem outras chaves que não são nossas.
  const { data: org } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  const settings = ((org as { settings: Record<string, unknown> } | null)?.settings ?? {}) as Record<
    string,
    unknown
  >;
  const scheduling = (settings.scheduling ?? {}) as Record<string, unknown>;
  await admin
    .from("organizations")
    .update({
      settings: {
        ...settings,
        scheduling: { ...scheduling, providers_enabled: true, providers_google_enabled: true },
      },
    })
    .eq("id", orgId);

  const jornada = {
    timezone: FUSO,
    windows: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: "09:00", end: "18:00" })),
  };
  // Apaga e recria, em vez de reusar: a spec RENOMEIA o profissional no meio,
  // então "reusar por nome" criaria um card novo a cada rodada (medido: seis
  // "Dra. E2E Silva" lado a lado). São linhas SÓ desta fixture (nomes fixos
  // "Dra. E2E*"), não dados de outra jornada — nada alheio é tocado.
  const { data: sobras } = await admin
    .from("providers")
    .select("id")
    .eq("organization_id", orgId)
    .in("name", [NOME_INICIAL, NOME_EDITADO]);
  const sobraIds = ((sobras ?? []) as Array<{ id: string }>).map((s) => s.id);
  if (sobraIds.length > 0) {
    await admin.from("calendar_availability_exceptions").delete().in("provider_id", sobraIds);
    await admin.from("providers").delete().in("id", sobraIds);
  }
  const { data: criado, error } = await admin
    .from("providers")
    .insert({
      organization_id: orgId,
      name: NOME_INICIAL,
      specialties: ["clínico"],
      schedule: jornada,
      active: true,
    })
    .select("id")
    .single();
  if (error ?? !criado) throw new Error(`seed do profissional falhou: ${error?.message}`);
  const providerId = (criado as { id: string }).id;

  const { data: tipo } = await admin
    .from("calendar_event_types")
    .select("id")
    .eq("organization_id", orgId)
    .eq("slug", creds.agenda.tipo_slug)
    .maybeSingle();
  if (!tipo) throw new Error(`tipo ${creds.agenda.tipo_slug} ausente — seed-e2e-agenda incompleto`);

  return { orgId, providerId, tipoId: (tipo as { id: string }).id, dia: proximoDiaUtil() };
}

test("profissional externo: editar, fechar o dia e sumir da lista da IA", async ({ page }) => {
  const { providerId, tipoId, dia } = await semear();
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;

  // `manager`, e NÃO o primeiro da lista: o `admin` do seed tem MFA com
  // challenge, e esta spec não é sobre login (molde `agenda-marcar-pela-tela`).
  const usuario = creds.users.manager;
  if (!usuario) throw new Error(".e2e-creds.json sem o usuário `manager`");

  // A rota exige datetime COM offset (`z.string().datetime({ offset: true })`):
  // data nua volta 422 de validação, que se leria como recusa do motor.
  const horariosDoDia = async (): Promise<number> => {
    const r = await page.request.get(
      `/api/v1/agenda/horarios-livres?event_type_id=${tipoId}&provider_id=${providerId}&de=${dia}T00:00:00-03:00&ate=${dia}T23:59:59-03:00`,
    );
    expect(r.ok(), `horarios-livres respondeu ${r.status()}`).toBe(true);
    const corpo = (await r.json()) as { data?: { slots?: unknown[] } };
    return corpo.data?.slots?.length ?? -1;
  };

  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(usuario.email);
  await page.getByLabel(/senha/i).fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });

  await page.goto("/app/agenda/profissionais");
  // Pelo testid do card, e não pelo nome: "Dra. E2E" aparece duas vezes na
  // tela (card + checkbox do fechamento) e o getByText reprovaria por
  // strict mode em vez de medir presença.
  await expect(page.getByTestId(`profissional-${providerId}`)).toBeVisible({ timeout: 20_000 });

  // ── o dia tem horário antes de fechar ──────────────────────────────────
  expect(await horariosDoDia()).toBeGreaterThan(0);

  // ── editar nome + especialidades ───────────────────────────────────────
  const cartao = page.getByTestId(`profissional-${providerId}`);
  await cartao.getByRole("button", { name: "Editar", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Nome").fill(NOME_EDITADO);
  await page.getByLabel(/especialidades/i).fill(ESPECIALIDADES.join(", "));
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  // O produto recarrega depois de salvar (mesmo padrão do "Horário"): esperar
  // o nome novo prova o servidor, não o estado local. Primeiro o NOME VELHO
  // desmontar — sem isso o `esperarARevelacao` pode rodar antes de o reload
  // nativo começar (DOM velho, sem caixa) e voltar na hora, e o getByText
  // seguinte vê a cópia escondida do servidor junto com a viva (strict mode).
  // Escopo no card: o nome aparece duas vezes na tela (card + checkbox).
  await page
    .getByRole("heading", { name: NOME_INICIAL })
    .waitFor({ state: "detached", timeout: 20_000 });
  // O nome NOVO anexado primeiro: sem isso o `esperarARevelacao` pode rodar no
  // documento novo ainda vazio (sem caixa S:) e voltar na hora, e o getByText
  // seguinte corre contra a hidratação — vendo a cópia escondida do servidor
  // junto com a viva (strict mode).
  await page
    .getByRole("heading", { name: NOME_EDITADO })
    .waitFor({ state: "attached", timeout: 20_000 });
  await esperarARevelacao(page);
  await expect(cartao.getByText(NOME_EDITADO)).toBeVisible({ timeout: 20_000 });
  await expect(cartao.getByText(ESPECIALIDADES.join(", "))).toBeVisible();

  // ── fechar o dia para ela ──────────────────────────────────────────────
  await page.getByLabel(NOME_EDITADO).check();
  await page.getByLabel("Dia inicial").fill(dia);
  await page.getByRole("button", { name: "Fechar dias" }).click();
  await expect(page.getByTestId("resultado-do-lote")).toContainText("1 bloqueio(s) gravado(s)", {
    timeout: 20_000,
  });

  // ── sem horário depois de fechar ───────────────────────────────────────
  expect(await horariosDoDia()).toBe(0);

  // ── o dia fechado aparece MARCADO na agenda ─────────────────────────────
  // A grade mostra a jornada de UM dono por vez: isola a profissional no
  // filtro para os marcadores a seguirem (mesmo dono da consulta).
  await page.goto("/app/agenda");
  await expect(page.getByTestId("tela-agenda")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`botao-pessoa-${providerId}`).click();
  // Mês: a janela de 6 semanas sempre contém o dia — sem navegação.
  await page.getByTestId("visao-mes").click();
  const seloMes = page.getByTestId(`dia-fechado-${dia}`);
  await expect(seloMes).toBeVisible({ timeout: 20_000 });
  await expect(seloMes).toContainText("Fechado");
  // Semana: o dia pode estar na próxima — avança no máximo 2 vezes.
  await page.getByTestId("visao-semana").click();
  for (let i = 0; i < 2; i++) {
    if (await page.getByTestId(`coluna-dia-${dia}`).count()) break;
    await page.getByTestId("periodo-seguinte").click();
  }
  const seloSemana = page.getByTestId(`dia-fechado-${dia}`);
  await expect(seloSemana).toBeVisible({ timeout: 20_000 });
  await expect(seloSemana).toHaveAttribute("title", /Fechado/);

  // ── inabilitar some da lista que a IA lê ───────────────────────────────
  // De volta à gestão: o `cartao` mora em /app/agenda/profissionais, e os
  // marcadores acima navegaram para /app/agenda.
  await page.goto("/app/agenda/profissionais");
  await expect(cartao).toBeVisible({ timeout: 20_000 });
  await cartao.getByRole("switch").click();
  await expect(cartao.getByText("Inativo")).toBeVisible({ timeout: 20_000 });

  // `crm_list_providers` não tem rota HTTP — o filtro `apenasAtivos` dela é
  // provado em unit (`listaProfissionais`, em
  // `tests/unit/agenda-profissionais-externos.test.ts`). Aqui mede-se o efeito
  // que a IA sentiria: inativo não tem horário em dia nenhum — a consulta
  // recusa com 422 (`jornada_mal_configurada`, "profissional inativo").
  const r = await page.request.get(
    `/api/v1/agenda/horarios-livres?event_type_id=${tipoId}&provider_id=${providerId}&de=${dia}T00:00:00-03:00&ate=${dia}T23:59:59-03:00`,
  );
  expect(r.status()).toBe(422);
});

test("profissional externo: excluir barra com futura e passa sem ela", async ({ page }) => {
  // O `semear()` apaga e recria a fixture (nomes "Dra. E2E*"), então este caso
  // não depende do anterior: cada um parte de um profissional novo, ativo e
  // sem nada marcado.
  const { providerId, tipoId, dia } = await semear();
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  const usuario = creds.users.manager;
  if (!usuario) throw new Error(".e2e-creds.json sem o usuário `manager`");

  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(usuario.email);
  await page.getByLabel(/senha/i).fill(creds.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });

  // Uma futura de verdade, marcada pela API com o primeiro slot livre.
  const slots = await page.request.get(
    `/api/v1/agenda/horarios-livres?event_type_id=${tipoId}&provider_id=${providerId}&de=${dia}T00:00:00-03:00&ate=${dia}T23:59:59-03:00`,
  );
  const corpoSlots = (await slots.json()) as { data?: { slots?: Array<{ inicio: string }> } };
  const primeiro = corpoSlots.data?.slots?.[0]?.inicio;
  if (!primeiro) throw new Error(`sem slot livre em ${dia} para semear a futura`);
  const marcado = await page.request.post("/api/v1/agenda/agendamentos", {
    data: { event_type_id: tipoId, provider_id: providerId, starts_at: primeiro },
  });
  expect(marcado.ok(), `marcar respondeu ${marcado.status()}`).toBe(true);
  const corpoMarcado = (await marcado.json()) as { data?: { id?: string } };
  const compromissoId = corpoMarcado.data?.id;
  if (!compromissoId) throw new Error("marcação não devolveu id");

  await page.goto("/app/agenda/profissionais");
  const cartao = page.getByTestId(`profissional-${providerId}`);
  await expect(cartao).toBeVisible({ timeout: 20_000 });

  // ── com futura, a exclusão é barrada e o card fica ──────────────────────
  await cartao.getByRole("button", { name: "Excluir profissional" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toContainText("consultas futuras");
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(cartao).toBeVisible({ timeout: 20_000 });

  // ── sem futura (cancelada), exclui e o card some ────────────────────────
  const cancelado = await page.request.delete("/api/v1/agenda/agendamentos", {
    data: { id: compromissoId, reason: "caso e2e: liberando o profissional" },
  });
  expect(cancelado.ok(), `cancelar respondeu ${cancelado.status()}`).toBe(true);
  await cartao.getByRole("button", { name: "Excluir profissional" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(cartao).toBeHidden({ timeout: 20_000 });
});

test("profissional externo: vínculo Google mostra selo e bloqueia os horários", async ({ page }) => {
  // Só a via de LEITURA é exercitada: conexão, calendário, vínculo e evento
  // entram por service_role (sem OAuth de verdade), e a prova é o que a
  // secretária vê — selo no card + zero slots — pela mesma rota da tela e da IA.
  const { orgId, providerId, tipoId, dia } = await semear();
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  const usuario = creds.users.manager;
  if (!usuario) throw new Error(".e2e-creds.json sem o usuário `manager`");

  const sup = credenciaisSupabaseDeTeste();
  const admin = createClient(sup.url, sup.serviceRole, { auth: { persistSession: false } });
  const conexaoId = randomUUID();
  const calendarioNome = "Agenda E2E Dentista";
  await admin.from("calendar_connections").insert({
    id: conexaoId,
    organization_id: orgId,
    user_id: usuario.id,
    provider: "google_calendar",
    account_email: `e2e-9014-${orgId}@invariant.test`,
    status: "healthy",
  });
  const { data: calendario } = await admin
    .from("calendar_connection_calendars")
    .insert({
      organization_id: orgId,
      connection_id: conexaoId,
      external_calendar_id: `e2e-cal-${providerId}`,
      name: calendarioNome,
      counts_for_conflicts: true,
      available: true,
      access_role: "writer",
      provider_id: providerId,
    })
    .select("id")
    .single();
  if (!calendario) throw new Error("seed do calendário vinculado falhou");
  // O dia inteiro tomado no Google (09:00–18:00 SP = 12:00–21:00Z).
  await admin.from("calendar_external_events").insert({
    organization_id: orgId,
    connection_id: conexaoId,
    external_calendar_id: `e2e-cal-${providerId}`,
    external_event_id: `e2e-evt-${providerId}-${dia}`,
    starts_at: `${dia}T12:00:00Z`,
    ends_at: `${dia}T21:00:00Z`,
    status: "confirmed",
    transparency: "opaque",
  });

  try {
    await page.goto("/login");
    await page.getByLabel(/e-?mail/i).fill(usuario.email);
    await page.getByLabel(/senha/i).fill(creds.password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL(/\/app(\/|$)/, { timeout: 20_000 });

    await page.goto("/app/agenda/profissionais");
    const cartao = page.getByTestId(`profissional-${providerId}`);
    await expect(cartao).toBeVisible({ timeout: 20_000 });
    // O selo do vínculo, com o nome da agenda.
    await expect(cartao.getByText(`Google: ${calendarioNome}`)).toBeVisible({ timeout: 20_000 });

    // O dia inteiro tomado lá fora: a mesma rota da tela e da IA não oferece nada.
    const r = await page.request.get(
      `/api/v1/agenda/horarios-livres?event_type_id=${tipoId}&provider_id=${providerId}&de=${dia}T00:00:00-03:00&ate=${dia}T23:59:59-03:00`,
    );
    expect(r.ok(), `horarios-livres respondeu ${r.status()}`).toBe(true);
    const corpo = (await r.json()) as { data?: { slots?: unknown[] } };
    expect(corpo.data?.slots ?? null, "o Google tomado não bloqueou a grade do dentista").toEqual([]);
  } finally {
    // Limpeza na ordem reversa da FK (evento → calendário → conexão). O
    // profissional sai pelo `semear()` da próxima rodada.
    await admin.from("calendar_external_events").delete().eq("connection_id", conexaoId);
    await admin.from("calendar_connection_calendars").delete().eq("connection_id", conexaoId);
    await admin.from("calendar_connections").delete().eq("id", conexaoId);
  }
});
