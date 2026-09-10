/**
 * Supabase admin client (service role). BYPASSA RLS.
 *
 * REGRA CRÍTICA: handlers que usam este client DEVEM filtrar `organization_id`
 * manualmente, resolvido de fonte confiável (cookie, JWT validado, webhook
 * secret, path token) — NUNCA do request body.
 *
 * Uso permitido:
 *  - Webhook handlers (WAHA, Nuvemshop)
 *  - Cron / workers
 *  - Onboarding / admin operations explícitas
 *  - Health check (read-only)
 *
 * Uso PROIBIDO:
 *  - Qualquer rota acionada por usuário final em fluxo normal
 *  - Substituir auth por conveniência
 */

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { toPublicStorageUrl } from "./storage-url";

export { toPublicStorageUrl };

let _admin: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (_admin) return _admin;

  const supabaseUrl = env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const rawAdmin = createSupabaseClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        "X-Client-Info": "deskcomm-crm/admin",
      },
    },
  });

  // Se SUPABASE_INTERNAL_URL estiver ativo e for diferente de NEXT_PUBLIC_SUPABASE_URL,
  // intercepta storage.from().createSignedUrl para garantir que as URLs assinadas
  // devolvidas sejam públicas e alcançáveis pelos navegadores dos clientes.
  if (env.SUPABASE_INTERNAL_URL && env.SUPABASE_INTERNAL_URL !== env.NEXT_PUBLIC_SUPABASE_URL) {
    const origStorageFrom = rawAdmin.storage.from.bind(rawAdmin.storage);
    rawAdmin.storage.from = (id: string) => {
      const bucket = origStorageFrom(id);
      const origCreateSignedUrl = bucket.createSignedUrl.bind(bucket);
      bucket.createSignedUrl = async (
        path: string,
        expiresIn: number,
        options?: Parameters<typeof origCreateSignedUrl>[2],
      ) => {
        const res = await origCreateSignedUrl(path, expiresIn, options);
        if (res.data?.signedUrl) {
          res.data.signedUrl = toPublicStorageUrl(res.data.signedUrl);
        }
        return res;
      };
      const origCreateSignedUrls = bucket.createSignedUrls.bind(bucket);
      bucket.createSignedUrls = async (
        paths: string[],
        expiresIn: number,
        options?: Parameters<typeof origCreateSignedUrls>[2],
      ) => {
        const res = await origCreateSignedUrls(paths, expiresIn, options);
        if (res.data) {
          for (const item of res.data) {
            if (item.signedUrl) {
              item.signedUrl = toPublicStorageUrl(item.signedUrl);
            }
          }
        }
        return res;
      };
      return bucket;
    };
  }

  _admin = rawAdmin;
  return _admin;
}
