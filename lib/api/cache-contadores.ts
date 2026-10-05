import { createHash } from "node:crypto";

import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";
import { validarConfigRedisRest } from "@/lib/redis-config";

export interface ContadoresCache {
  fila: number;
  automatico: number;
  mine: number;
  all: number;
  closed: number;
  archived: number;
}

const TTL_SEGUNDOS = 45;

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  const config = validarConfigRedisRest(url, token);
  if (!config.ok) return null;
  _redis = new Redis({ url, token, retry: false });
  return _redis;
}

export function chaveContadores(
  organizationId: string,
  userId: string,
  filtros: Record<string, string>,
): string {
  const ordenado = Object.keys(filtros)
    .sort()
    .map((k) => `${k}=${filtros[k]}`)
    .join("&");
  const hash = createHash("sha256").update(ordenado).digest("hex").slice(0, 16);
  return `conversation-counts:${organizationId}:${userId}:${hash}`;
}

export async function lerContadoresCache(
  organizationId: string,
  userId: string,
  filtros: Record<string, string>,
): Promise<ContadoresCache | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const chave = chaveContadores(organizationId, userId, filtros);
    const cached = await redis.get<ContadoresCache>(chave);
    return cached ?? null;
  } catch {
    return null;
  }
}

export async function gravarContadoresCache(
  organizationId: string,
  userId: string,
  filtros: Record<string, string>,
  valores: ContadoresCache,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    const chave = chaveContadores(organizationId, userId, filtros);
    await redis.set(chave, valores, { ex: TTL_SEGUNDOS });
  } catch {
    // Falha de Redis não pode derrubar a resposta — os counts já foram calculados.
  }
}
