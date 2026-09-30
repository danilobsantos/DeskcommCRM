/**
 * DIAS BLOQUEADOS NA GRADE — o mapa, sem React nem rede.
 *
 * `calendar_availability_exceptions` é lida pelo motor de horários desde a
 * migration 0177 e pela tela de gestão (`DiasBloqueados`) via
 * `GET /api/v1/agenda/excecoes`. A grade nunca a via: dia fechado parecia dia
 * sem vaga. Este módulo transforma as linhas da rota no mapa que a grade
 * desenha (`yyyy-MM-dd` → o que marcar), e o hook `useDiasBloqueados` busca.
 *
 * Três decisões que o mapa carrega:
 *
 * 1. Sem dono conhecido, sem marcador. A exceção é POR DONO (usuário ou
 *    profissional); marcar o dia de todo mundo porque alguém fechou o dele
 *    seria mentir — e mentira com selo é pior que ausência de selo. A grade
 *    continua mostrando os slots certos; o marcador é informação, não trava.
 * 2. Só dia INTEIRO fechado (`0..1440`, `is_unavailable: true`) marca. Faixa
 *    parcial e dia ABERTO excepcionalmente já aparecem nos slots (somem ou
 *    nascem) — marcá-los de novo seria redundância que compete com a verdade.
 * 3. O motivo (`reason`, texto livre, até 200) vai só para o `title`: o selo
 *    diz "Fechado", o porquê aparece no hover. Texto livre no layout quebraria
 *    a coluna e vazaría capricho de escrita para a grade.
 */
export interface ExcecaoDaAgenda {
  user_id: string | null;
  provider_id: string | null;
  exception_date: string;
  is_unavailable: boolean;
  start_minute: number;
  end_minute: number;
  reason: string | null;
}

export interface DiaBloqueado {
  /** O dia inteiro está fechado — sempre verdade neste mapa (ver decisão 2). */
  diaTodo: true;
  /** Motivos distintos, na ordem em que vieram, sem vazios. Vão ao `title`. */
  motivos: string[];
}

export interface DonoDoBloqueio {
  provider_id?: string;
  owner_user_id?: string;
}

export function mapaDeDiasBloqueados(
  excecoes: ExcecaoDaAgenda[],
  dono: DonoDoBloqueio | null,
): Record<string, DiaBloqueado> {
  const mapa: Record<string, DiaBloqueado> = {};
  if (!dono || (!dono.provider_id && !dono.owner_user_id)) return mapa;
  for (const e of excecoes) {
    if (!e.is_unavailable) continue;
    if (e.start_minute !== 0 || e.end_minute !== 1440) continue;
    // A constraint `calendar_exceptions_dono_unico` garante no máximo um
    // dono por linha; a comparação abaixo espelha o filtro do motor
    // (`consulta.ts`), que endereça por `provider_id` OU `user_id`.
    const ehDoDono = dono.provider_id
      ? e.provider_id === dono.provider_id
      : e.provider_id == null && e.user_id === dono.owner_user_id;
    if (!ehDoDono) continue;
    const atual = mapa[e.exception_date] ?? { diaTodo: true as const, motivos: [] };
    const motivo = (e.reason ?? "").trim();
    if (motivo && !atual.motivos.includes(motivo)) atual.motivos.push(motivo);
    mapa[e.exception_date] = atual;
  }
  return mapa;
}
