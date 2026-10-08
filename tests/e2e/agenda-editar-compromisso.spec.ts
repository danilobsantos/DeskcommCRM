import { randomInt, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { test, expect, type Page } from "./helpers/test";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";

/**
 * EDITAR COMPROMISSO PELA TELA (9015) — título, paciente, horário, tipo,
 * profissional e observação gravam pelo PATCH e aparecem no detalhe; a troca
 * de paciente pede confirmação antes de sair (a de profissional, não).
 *
 * O molde de fixture é o de `agenda-presenca-recuperacao.spec.ts`: org, dono
 * admin, tipo com jornada e contato criados via service role, e o detalhe
 * aberto direto por `/app/agenda?compromisso=<id>`.
 */
const credentials = credenciaisSupabaseDeTeste();
const db = createClient(credentials.url, credentials.serviceRole, {
  auth: { persistSession: false },
});
const password = `Local-${randomUUID()}!`;
test.use({ trace: "on" });
test.describe.configure({ timeout: 180_000 });
const orgs: string[] = [],
  users: string[] = [];

async function insert(table: string, value: Record<string, unknown>) {
  const { data, error } = await db.from(table).insert(value).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function fixture() {
  const email = `edicao-${randomUUID()}@invariant.test`;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error;
  const user = data.user.id;
  users.push(user);
  const org = await insert("organizations", {
    slug: `edicao-${randomUUID()}`,
    display_name: "Agenda edicao",
    legal_name: "Agenda edicao",
    onboarded_at: new Date().toISOString(),
  });
  orgs.push(org);
  await insert("user_organizations", {
    organization_id: org,
    user_id: user,
    role: "admin",
    accepted_at: new Date().toISOString(),
  });
  const session = await insert("channel_sessions", {
    organization_id: org,
    waha_session_name: randomUUID(),
    display_name: "Canal de teste",
    status: "WORKING",
    webhook_secret_encrypted: "\\x00",
  });
  const tipo30 = await insert("calendar_event_types", {
    organization_id: org,
    name: "Consulta de edicao",
    slug: `consulta-edicao-${randomUUID()}`,
    duration_minutes: 30,
    minimum_notice_minutes: 0,
    booking_window_days: 60,
    is_active: true,
    default_owner_user_id: user,
  });
  const tipo60 = await insert("calendar_event_types", {
    organization_id: org,
    name: "Sessao longa de edicao",
    slug: `sessao-edicao-${randomUUID()}`,
    duration_minutes: 60,
    minimum_notice_minutes: 0,
    booking_window_days: 60,
    is_active: true,
    default_owner_user_id: user,
  });
  const availability = await db.from("attendant_availability").upsert(
    {
      organization_id: org,
      user_id: user,
      is_available: true,
      schedule: {
        timezone: "America/Sao_Paulo",
        windows: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: "00:00", end: "23:59" })),
      },
    },
    { onConflict: "organization_id,user_id" },
  );
  if (availability.error) throw availability.error;
  return { org, user, email, session, tipo30, tipo60 };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function contato(f: Fixture, name: string) {
  return insert("contacts", {
    organization_id: f.org,
    name,
    display_name: name,
    phone_number: `+55119${randomInt(10000000, 99999999)}`,
  });
}

/** Amanhã às 14:00 de São Paulo, em ISO. Longe de virada de dia e de notice. */
function amanha14hSP(): Date {
  const agoraSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const alvo = new Date(agoraSP);
  alvo.setDate(alvo.getDate() + 1);
  alvo.setHours(14, 0, 0, 0);
  // Diferença entre o relógio SP e o UTC agora, aplicada ao alvo.
  const offset = new Date().getTime() - agoraSP.getTime();
  return new Date(alvo.getTime() + offset);
}

async function agendamento(f: Fixture, contactId: string, title: string) {
  const inicio = amanha14hSP();
  return insert("calendar_appointments", {
    organization_id: f.org,
    contact_id: contactId,
    event_type_id: f.tipo30,
    owner_user_id: f.user,
    title,
    status: "confirmed",
    starts_at: inicio.toISOString(),
    ends_at: new Date(inicio.getTime() + 30 * 60000).toISOString(),
    time_zone: "America/Sao_Paulo",
  });
}

async function entrar(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByLabel(/senha/i).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/app(?:\/|$)/, { timeout: 60_000 });
}

async function abrirEdicao(page: Page, id: string, titulo: string) {
  await page.goto(`/app/agenda?compromisso=${id}`);
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: titulo, exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Editar compromisso" }).click();
  await expect(page.getByTestId("editar-titulo")).toBeVisible({ timeout: 10_000 });
}

test("editar título e observação grava e repinta o detalhe", async ({ page }) => {
  const f = await fixture();
  const paciente = await contato(f, "Paciente Edicao");
  const id = await agendamento(f, paciente, "Consulta de edicao");
  await entrar(page, f.email);
  await abrirEdicao(page, id, "Consulta de edicao");

  await page.getByTestId("editar-titulo").fill("Paciente Edicao");
  await page.getByTestId("editar-observacao").fill("Retorno de 6 meses");

  const patch = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/agenda/agendamentos" && r.request().method() === "PATCH",
  );
  await page.getByTestId("salvar-edicao").click();
  expect((await patch).status()).toBe(200);

  // O PATCH invalida ["agenda"] e o detalhe repinta com o que foi gravado.
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Paciente Edicao", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("compromisso-observacao")).toContainText("Retorno de 6 meses");
});

test("trocar o tipo recalcula o fim e o horário repinta", async ({ page }) => {
  const f = await fixture();
  const paciente = await contato(f, "Paciente Tipo");
  const id = await agendamento(f, paciente, "Consulta de edicao");
  await entrar(page, f.email);
  await abrirEdicao(page, id, "Consulta de edicao");

  const antes = await page.getByTestId("compromisso-horario").textContent();
  await expect(page.getByTestId("editar-tipo")).toBeVisible({ timeout: 10_000 });
  // As opções chegam da rota de tipos; sem esperar, o select ainda mostra
  // "Carregando tipos…" e a troca não registra.
  await expect(page.getByTestId("editar-tipo")).toContainText(/Sessao longa/);
  await page.getByTestId("editar-tipo").selectOption({ label: "Sessao longa de edicao · 60min" });

  const patch = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/agenda/agendamentos" && r.request().method() === "PATCH",
  );
  await page.getByTestId("salvar-edicao").click();
  expect((await patch).status()).toBe(200);

  // 30min → 60min: o fim anda meia hora e o texto do horário muda.
  await expect
    .poll(async () => page.getByTestId("compromisso-horario").textContent(), {
      timeout: 20_000,
      message: "o horário não repintou depois da troca de tipo",
    })
    .not.toBe(antes);
});

test("trocar o paciente pede confirmação antes de gravar", async ({ page }) => {
  const f = await fixture();
  const pacienteA = await contato(f, "Paciente Origem");
  const pacienteB = await contato(f, "Paciente Destino");
  const id = await agendamento(f, pacienteA, "Consulta de edicao");
  await entrar(page, f.email);
  await abrirEdicao(page, id, "Consulta de edicao");

  // O seletor é o mesmo da marcação: digita, escolhe na lista.
  await page.getByTestId("quem-sera-atendido").fill("Paciente Destino");
  await page.getByRole("option", { name: "Paciente Destino" }).click();
  await page.getByTestId("salvar-edicao").click();

  // A confirmação aparece ANTES de qualquer PATCH…
  await expect(
    page.getByRole("alertdialog", { name: "Confirmar troca de paciente" }),
  ).toBeVisible({ timeout: 10_000 });

  const patch = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/agenda/agendamentos" && r.request().method() === "PATCH",
  );
  await page.getByTestId("confirmar-troca-paciente").click();
  const resposta = await patch;
  expect(resposta.status()).toBe(200);

  // …e o detalhe passa a apontar para o contato novo.
  const verContato = page.getByRole("dialog").getByRole("link", { name: "Ver contato" });
  await expect(verContato).toHaveAttribute("href", `/app/contacts/${pacienteB}`, {
    timeout: 20_000,
  });
});

test("trocar o profissional grava o par SEM confirmação e mantém o horário", async ({ page }) => {
  const f = await fixture();
  const paciente = await contato(f, "Paciente Profissional");
  const prov = await insert("providers", {
    organization_id: f.org,
    name: "Dr. Externo Edicao",
    active: true,
    schedule: {
      timezone: "America/Sao_Paulo",
      windows: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, start: "00:00", end: "23:59" })),
    },
  });
  const id = await agendamento(f, paciente, "Consulta de edicao");
  await entrar(page, f.email);
  await abrirEdicao(page, id, "Consulta de edicao");

  // O seletor nasce no atendente atual; a troca vai para o grupo Profissionais.
  await expect(page.getByTestId("editar-profissional")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("editar-profissional").selectOption(prov);

  const patch = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/agenda/agendamentos" && r.request().method() === "PATCH",
  );
  await page.getByTestId("salvar-edicao").click();
  expect((await patch).status()).toBe(200);

  // Sem alertdialog no caminho: profissional não troca convidado.
  await expect(page.getByTestId("editar-profissional")).toBeHidden({ timeout: 20_000 });

  const { data, error } = await db
    .from("calendar_appointments")
    .select("owner_user_id, provider_id")
    .eq("id", id)
    .single();
  if (error) throw error;
  expect(data.provider_id).toBe(prov);
  expect(data.owner_user_id).toBeNull();
});
