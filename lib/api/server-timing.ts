/**
 * Instrumentação de timing server-side para diagnóstico de performance.
 *
 * Produz o header `Server-Timing` (RFC 6797 §5), que o DevTools exibe na aba
 * Network → Timing de cada request — sem precisar abrir log, APM ou dashboard.
 *
 * Uso em route handler:
 *
 * ```ts
 * import { ServerTiming } from "@/lib/api/server-timing";
 *
 * export async function GET(req: NextRequest) {
 *   const timing = new ServerTiming();
 *   const user = await timing.measure("auth", () => requireAuth());
 *   const data = await timing.measure("db", () => fetchConversations(orgId));
 *   const body = { data };
 *   return NextResponse.json(body, {
 *     headers: { "Server-Timing": timing.header() },
 *   });
 * }
 * ```
 *
 * No DevTools aparece: `auth;dur=42, db;dur=318`
 */

interface TimingEntry {
  name: string;
  dur: number;
  desc?: string;
}

export class ServerTiming {
  private entries: TimingEntry[] = [];

  /**
   * Mede a duração de `fn` e registra com o nome dado.
   * Retorna o resultado de `fn` — pode substituir direto na chamada original.
   */
  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.entries.push({
        name,
        dur: Math.round(performance.now() - t0),
      });
    }
  }

  /** Mede uma operação síncrona. */
  measureSync<T>(name: string, fn: () => T): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.entries.push({
        name,
        dur: Math.round(performance.now() - t0),
      });
    }
  }

  /** Registra uma entrada manualmente (quando o caller já mediu). */
  add(name: string, durationMs: number, desc?: string): void {
    this.entries.push({ name, dur: Math.round(durationMs), desc });
  }

  /** Serializa para o header `Server-Timing`. */
  header(): string {
    return this.entries
      .map((e) => {
        let val = `${e.name};dur=${e.dur}`;
        if (e.desc) val += `;desc="${e.desc}"`;
        return val;
      })
      .join(", ");
  }

  /** Verdadeiro se há pelo menos uma entrada registrada. */
  get hasEntries(): boolean {
    return this.entries.length > 0;
  }
}
