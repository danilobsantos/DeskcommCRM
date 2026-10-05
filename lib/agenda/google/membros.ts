import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * QUEM SAIU DA EMPRESA PARA DE TER A AGENDA LIDA.
 *
 * `calendar_connections` guarda a agenda PESSOAL de uma pessoa, autorizada por ela via
 * OAuth. Quando o vínculo dela com a organização é revogado, a autorização do Google
 * continua válida — o token não sabe nada de RH. Sem este filtro, os dois crons seguem
 * lendo a agenda pessoal de um ex-funcionário para dentro da empresa da qual ele saiu,
 * indefinidamente.
 *
 * Medido antes de existir: `app/api/v1/team/` não mencionava `calendar_connections`
 * nenhuma vez, contra `revoked_at` aparecendo em 35 arquivos do produto. A revogação
 * parava tudo, menos isto.
 *
 * ⚠️ O FILTRO É AQUI, NO CONSUMO, e não só na rota de revogar — de propósito. Revogar é
 * um caminho; sair por outro (SQL direto de suporte, `update` de migração, uma segunda
 * rota amanhã) não passaria por aquele código. Aqui a leitura falha FECHADA: se a pessoa
 * não é membro ativo AGORA, a agenda dela não é lida, tenha ela saído por onde tiver.
 */
export async function apenasDeMembrosAtivos<T extends { organization_id: string; user_id: string }>(
  admin: ReturnType<typeof createAdminClient>,
  linhas: readonly T[],
): Promise<T[]> {
  if (linhas.length === 0) return [];

  const orgs = [...new Set(linhas.map((l) => l.organization_id))];
  const users = [...new Set(linhas.map((l) => l.user_id))];
  const { data, error } = await admin
    .from("user_organizations")
    .select("organization_id, user_id, revoked_at")
    .in("organization_id", orgs)
    .in("user_id", users);

  // Falha FECHADA: sem conseguir confirmar quem é membro, não sincroniza ninguém. O
  // contrário — sincronizar tudo quando a checagem falha — transformaria uma queda de
  // rede em vazamento de agenda pessoal.
  if (error || !data) return [];

  const ativos = new Set(
    (data as { organization_id: string; user_id: string; revoked_at: string | null }[])
      .filter((v) => v.revoked_at === null)
      .map((v) => `${v.organization_id}:${v.user_id}`),
  );
  return linhas.filter((l) => ativos.has(`${l.organization_id}:${l.user_id}`));
}

/**
 * O GÊMEO DA FUNÇÃO ACIMA PARA PROFISSIONAL EXTERNO (9014).
 *
 * O vínculo não tem humano para revogar: a agenda é da conta central da
 * clínica, não pessoal de ninguém — então não há vazamento de agenda pessoal
 * para fechar aqui. O que esta função fecha, em vez disso:
 *
 * 1. Profissional apagado: sem a linha em `providers`, o `claim` recusaria de
 *    qualquer jeito (`google_owner_unavailable`); pular no cron evita 50
 *    tentativas inúteis por rodada.
 * 2. Vínculo desfeito: sem a linha em `calendar_connection_calendars`, idem.
 * 3. Conexão caída ou ex-funcionária: a conta central pertence a alguém — se
 *    quem conectou saiu da organização (membro revogado), o OAuth dela para de
 *    escrever, pelo mesmo motivo da função acima.
 *
 * Falha FECHADA igual: erro de leitura não sincroniza ninguém.
 */
export async function apenasDeVinculosAtivos<
  T extends { organization_id: string; provider_id: string },
>(admin: ReturnType<typeof createAdminClient>, linhas: readonly T[]): Promise<T[]> {
  if (linhas.length === 0) return [];

  const orgs = [...new Set(linhas.map((l) => l.organization_id))];
  const providers = [...new Set(linhas.map((l) => l.provider_id))];

  const [{ data: existentes, error: erroProv }, { data: vinculos, error: erroVinc }] =
    await Promise.all([
      admin
        .from("providers")
        .select("organization_id, id")
        .in("organization_id", orgs)
        .in("id", providers),
      admin
        .from("calendar_connection_calendars")
        .select("organization_id, provider_id, calendar_connections!inner(status, user_id)")
        .in("organization_id", orgs)
        .in("provider_id", providers),
    ]);
  if (erroProv || erroVinc || !existentes || !vinculos) return [];

  const proviveis = new Set(
    (existentes as { organization_id: string; id: string }[]).map(
      (p) => `${p.organization_id}:${p.id}`,
    ),
  );

  // Dono da conexão ainda membro ativo — a mesma pergunta da função acima,
  // feita sobre quem CONECTOU a conta central, não sobre o dentista.
  const donos = [
    ...new Set(
      (vinculos as { calendar_connections: { user_id: string } | { user_id: string }[] }[]).map(
        (v) =>
          Array.isArray(v.calendar_connections)
            ? v.calendar_connections[0]?.user_id
            : v.calendar_connections?.user_id,
      ),
    ),
  ].filter((u): u is string => typeof u === "string");
  const { data: membros, error: erroMem } = await admin
    .from("user_organizations")
    .select("organization_id, user_id, revoked_at")
    .in("organization_id", orgs)
    .in("user_id", donos.length > 0 ? donos : ["00000000-0000-0000-0000-000000000000"]);
  if (erroMem || !membros) return [];
  const donosAtivos = new Set(
    (membros as { organization_id: string; user_id: string; revoked_at: string | null }[])
      .filter((v) => v.revoked_at === null)
      .map((v) => `${v.organization_id}:${v.user_id}`),
  );

  return linhas.filter((l) => {
    if (!proviveis.has(`${l.organization_id}:${l.provider_id}`)) return false;
    const vinculo = (
      vinculos as {
        organization_id: string;
        provider_id: string;
        calendar_connections: { status: string; user_id: string } | { status: string; user_id: string }[];
      }[]
    ).find((v) => v.organization_id === l.organization_id && v.provider_id === l.provider_id);
    if (!vinculo) return false;
    const conexao = Array.isArray(vinculo.calendar_connections)
      ? vinculo.calendar_connections[0]
      : vinculo.calendar_connections;
    if (!conexao || conexao.status !== "healthy") return false;
    return donosAtivos.has(`${l.organization_id}:${conexao.user_id}`);
  });
}
