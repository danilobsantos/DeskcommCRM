import { env } from "@/lib/env";

/**
 * Converte URLs de storage geradas internamente (ex: http://kong:8000/...)
 * para a URL pública (NEXT_PUBLIC_SUPABASE_URL), permitindo que o navegador
 * acesse a mídia sem falha de DNS (ERR_NAME_NOT_RESOLVED).
 */
export function toPublicStorageUrl(url: string): string {
  if (!url) return url;
  if (!env.NEXT_PUBLIC_SUPABASE_URL) return url;

  try {
    const parsed = new URL(url);
    const publicUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);

    // Se a URL gerada já aponta para o domínio público, mantém
    if (parsed.host === publicUrl.host) return url;

    let isInternal =
      parsed.hostname === "kong" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "host.docker.internal";

    if (env.SUPABASE_INTERNAL_URL) {
      try {
        const internalUrl = new URL(env.SUPABASE_INTERNAL_URL);
        if (parsed.hostname === internalUrl.hostname) {
          isInternal = true;
        }
      } catch {
        // ignore
      }
    }

    if (isInternal) {
      parsed.protocol = publicUrl.protocol;
      parsed.hostname = publicUrl.hostname;
      parsed.port = publicUrl.port;
      return parsed.toString();
    }
  } catch {
    // fallback se não for URL válida
  }

  return url;
}
