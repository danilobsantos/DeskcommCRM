/**
 * PUSH GOOGLE PARA PROFISSIONAL EXTERNO (migration 9014) — medido no Postgres,
 * sob `set role` e JWT de verdade.
 *
 * O que só o banco prova (unit cobre o executor com HTTP fake, nunca o SQL):
 *
 * 1. O `claim` resolve o destino pelo VÍNCULO (`k.provider_id`), não por
 *    `user_id` — sem vínculo, estaciona com frase acionável em vez de
 *    "Escolha uma agenda" eterna.
 * 2. O índice parcial do push cobre provider (sem ele o cron nunca enxerga).
 * 3. Um profissional = uma agenda: o segundo vínculo é 23505.
 * 4. Quem resolve conflito de provider é `manager+` — `agent` comum é 403, e
 *    o trigger `decision` reconhece a resolução da secretária (sem isso ela
 *    morria em `google_metadata_private`).
 * 5. Cross-tenant: provider de outra org não resolve destino aqui, e `anon`
 *    não executa nada.
 *
 * Escritas saem por superuser com autocommit ou `asUser` com COMMIT — nunca
 * pelo leitor com rollback, que evaporaria o efeito medido.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GOV_AGENT_B, GOV_MANAGER, GOV_ORG, seedGov } from "./gov-helpers";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 4,
});

const ORG_VIZINHA = randomUUID();
const PROVIDER = randomUUID();
const PROVIDER_SEM_VINCULO = randomUUID();
const CONEXAO = randomUUID();
const APPT_VINCULADO = randomUUID();
const APPT_SEM_VINCULO = randomUUID();

/** Chamada com JWT de sessão e COMMIT — para escritas que o teste vai reler. */
async function asUser(user: string, sqlText: string, args: unknown[]) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user, role: "authenticated" }),
    ]);
    const r = await c.query(sqlText, args);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

/** Leitura com papéis/JWT e rollback — só para recusas (nada a persistir). */
async function comoRecusa(
  role: "authenticated" | "anon",
  sub: string | null,
  sqlText: string,
  args: unknown[],
) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      sub ? JSON.stringify({ sub, role }) : JSON.stringify({ role }),
    ]);
    return await c.query(sqlText, args);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

const CLAIM = "select fn_google_appointment($1, $2, 'claim', '{}') result";
const RESOLVE = "select public.fn_google_resolve($1, $2, $3, $4, $5, 'local')";

beforeAll(async () => {
  seedGov();
  await pool.query(
    "insert into organizations(id, slug, display_name, legal_name) values ($1, $2, 'Vizinha', 'Vizinha') on conflict do nothing",
    [ORG_VIZINHA, `vizinha-9014-${ORG_VIZINHA}`],
  );
  for (const [id, org] of [
    [PROVIDER, GOV_ORG],
    [PROVIDER_SEM_VINCULO, GOV_ORG],
  ] as const) {
    await pool.query(
      "insert into providers(id, organization_id, name) values ($1, $2, 'Prof 9014') on conflict do nothing",
      [id, org],
    );
  }
  await pool.query(
    `insert into calendar_connections(id, organization_id, user_id, provider, account_email, status)
     values ($1, $2, $3, 'google_calendar', 'central-9014@invariant.test', 'healthy') on conflict do nothing`,
    [CONEXAO, GOV_ORG, GOV_MANAGER],
  );
  await pool.query(
    `insert into calendar_connection_calendars(id, organization_id, connection_id, external_calendar_id, name, counts_for_conflicts, available, access_role, provider_id)
     values ($1, $2, $3, 'prof-9014', 'Prof 9014', true, true, 'writer', $4) on conflict do nothing`,
    [randomUUID(), GOV_ORG, CONEXAO, PROVIDER],
  );
  const tipo = (
    await pool.query("select id from public.calendar_event_types where organization_id = $1 limit 1", [
      GOV_ORG,
    ])
  ).rows[0]?.id as string;
  for (const [id, provider] of [
    [APPT_VINCULADO, PROVIDER],
    [APPT_SEM_VINCULO, PROVIDER_SEM_VINCULO],
  ] as const) {
    await pool.query(
      `insert into calendar_appointments(id, organization_id, event_type_id, title, starts_at, ends_at, time_zone, status, provider_id)
       values ($1, $2, $3, 'Consulta 9014', '2030-03-12T13:00:00Z', '2030-03-12T13:30:00Z', 'America/Sao_Paulo', 'confirmed', $4)
       on conflict do nothing`,
      [id, GOV_ORG, tipo, provider],
    );
  }
});

afterAll(() => pool.end());

describe("claim do push conhece provider", () => {
  it("com vínculo: recebe identidade da conta central", async () => {
    const r = await pool.query(CLAIM, [GOV_ORG, APPT_VINCULADO]);
    expect(r.rows[0]?.result?.google_connection_id).toBe(CONEXAO);
    expect(r.rows[0]?.result?.google_calendar_id).toBe("prof-9014");
    expect(String(r.rows[0]?.result?.google_event_id)).toMatch(/^deskcommapp/);
  });

  it("sem vínculo: estaciona com frase acionável, sem exceção", async () => {
    await pool.query(CLAIM, [GOV_ORG, APPT_SEM_VINCULO]);
    const r = await pool.query(
      "select google_sync_error, google_event_id from public.calendar_appointments where id = $1",
      [APPT_SEM_VINCULO],
    );
    expect(r.rows[0]?.google_event_id).toBeNull();
    expect(String(r.rows[0]?.google_sync_error)).toContain("Ligue este profissional");
  });

  it("o índice parcial do push cobre provider", async () => {
    const r = await pool.query(
      "select pg_get_indexdef(oid) as d from pg_class where relname = 'calendar_appointments_pendente_no_google_idx'",
    );
    expect(r.rows[0]?.d).toContain("provider_id");
  });

  it("um profissional = uma agenda: o segundo vínculo é 23505", async () => {
    await expect(
      pool.query(
        `insert into calendar_connection_calendars(organization_id, connection_id, external_calendar_id, name, provider_id)
         values ($1, $2, 'outra-9014', 'Outra', $3)`,
        [GOV_ORG, CONEXAO, PROVIDER],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("provider de outra org não resolve destino aqui", async () => {
    await expect(pool.query(CLAIM, [ORG_VIZINHA, APPT_VINCULADO])).rejects.toMatchObject({
      code: "P0002",
    });
  });
});

describe("quem resolve conflito de provider", () => {
  async function comConflito(appt: string) {
    await pool.query(
      `update public.calendar_appointments
          set google_conflict = jsonb_build_object('reason', 'shared', 'revision', revision::text, 'local_revision', google_local_revision::text, 'etag', google_etag, 'groups', '[]'::jsonb)
        where id = $1`,
      [appt],
    );
    const atual = await pool.query(
      "select revision::text as r, google_local_revision::text as l, google_etag as e from public.calendar_appointments where id = $1",
      [appt],
    );
    return atual.rows[0] as { r: string; l: string; e: string | null };
  }

  it("manager resolve e o trigger reconhece (sem google_metadata_private)", async () => {
    const v = await comConflito(APPT_VINCULADO);
    await asUser(GOV_MANAGER, RESOLVE, [GOV_ORG, APPT_VINCULADO, v.r, v.l, v.e]);
    const r = await pool.query(
      "select google_conflict->'resolution'->>'choice' as c from public.calendar_appointments where id = $1",
      [APPT_VINCULADO],
    );
    expect(r.rows[0]?.c).toBe("local");
  });

  it("agent comum é 403 em linha de provider", async () => {
    const v = await comConflito(APPT_VINCULADO);
    await expect(
      comoRecusa("authenticated", GOV_AGENT_B, RESOLVE, [GOV_ORG, APPT_VINCULADO, v.r, v.l, v.e]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("anon não executa nem resolve nem ocupa", async () => {
    await expect(comoRecusa("anon", null, CLAIM, [GOV_ORG, APPT_VINCULADO])).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      comoRecusa("anon", null, RESOLVE, [GOV_ORG, APPT_VINCULADO, "1", "1", null]),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
