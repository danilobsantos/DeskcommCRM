"use client";

import { useCallback, useEffect } from "react";

import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { getOpenConversationId } from "@/hooks/notifications/OpenConversationContext";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { avatarUrlServivel } from "@/lib/notifications/avatar_url";
import { entregarAviso } from "@/lib/notifications/deliver";
import { shouldNotifyInbound } from "@/lib/notifications/policy";
import { syncPushSubscription } from "@/lib/notifications/push_client";

function tabFocused(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

/** postgres_changes entrega `{ new }`; alguns mocks aninham em `payload`. */
function rowFromRealtime(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as {
    tipo?: unknown;
    new?: unknown;
    record?: unknown;
    payload?: { new?: unknown };
  };
  if (p.tipo === "reassinado") return null;
  const raw = p.new ?? p.record ?? p.payload?.new;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function previewFromMessage(row: { type?: unknown; body?: unknown }): string {
  if (row.type !== "text") return "Mídia";
  const body = typeof row.body === "string" ? row.body.trim() : "";
  return body || "Nova mensagem";
}

interface ContactBits {
  title: string;
  avatarStoragePath?: string | null;
  isAnonymized?: boolean;
}

const contactCache = new Map<string, ContactBits>();

/** Só para testes: limpa o cache de dados do contato. */
export function __resetContactCache(): void {
  contactCache.clear();
}

async function getContactBits(contactId: string): Promise<ContactBits> {
  const cached = contactCache.get(contactId);
  if (cached) return cached;

  try {
    const res = await fetch(`/api/v1/contacts/${contactId}`, {
      credentials: "include",
    });
    if (!res.ok) return { title: "Nova mensagem" };
    const json = (await res.json()) as {
      data?: {
        contact?: {
          display_name?: string | null;
          name?: string | null;
          avatar_storage_path?: string | null;
          is_anonymized?: boolean;
        };
      };
    };
    const c = json.data?.contact;
    const title = (c?.display_name || c?.name || "Nova mensagem").trim() || "Nova mensagem";
    const bits: ContactBits = {
      title,
      avatarStoragePath: c?.avatar_storage_path ?? null,
      isAnonymized: c?.is_anonymized ?? false,
    };
    contactCache.set(contactId, bits);
    return bits;
  } catch {
    return { title: "Nova mensagem" };
  }
}

export async function contactNotifyBits(contactId: string): Promise<{ title: string; icon?: string }> {
  const bits = await getContactBits(contactId);
  let icon: string | undefined;

  // Só busca a foto se o contato realmente tem foto no Storage e não foi anonimizado.
  // Evita disparar GET /avatar para contatos sem foto (que responderia 404 no console).
  if (bits.avatarStoragePath && !bits.isAnonymized) {
    try {
      const r = await fetch(`/api/v1/contacts/${contactId}/avatar`, {
        credentials: "include",
        redirect: "follow",
      });
      icon = r.ok ? avatarUrlServivel(r.url, window.location.origin) : undefined;
    } catch {
      // sem foto ou erro de rede: badge da marca
    }
  }

  return { title: bits.title, icon };
}

async function contactIdFromRow(
  row: Record<string, unknown>,
  conversationId: string | null,
): Promise<string | null> {
  if (typeof row.contact_id === "string") return row.contact_id;
  if (!conversationId) return null;
  try {
    const res = await fetch(`/api/v1/conversations/${conversationId}`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { conversation?: { contact_id?: string | null } };
    };
    return body.data?.conversation?.contact_id ?? null;
  } catch {
    return null;
  }
}

export function useInboundMessageAlerts(): void {
  const orgId = useActiveOrg()?.orgId ?? null;

  useEffect(() => {
    if (!orgId) return;
    void syncPushSubscription();
  }, [orgId]);

  const onChange = useCallback((payload: unknown) => {
    const row = rowFromRealtime(payload);
    if (!row) return;
    const conversationId = typeof row.conversation_id === "string" ? row.conversation_id : null;
    const direction = typeof row.direction === "string" ? row.direction : null;
    if (
      !shouldNotifyInbound({
        direction,
        conversationId,
        openConversationId: getOpenConversationId(),
        tabFocused: tabFocused(),
        tipo: (payload as { tipo?: unknown }).tipo,
      })
    ) {
      return;
    }
    void (async () => {
      const contactId = await contactIdFromRow(row, conversationId);
      const bits = contactId
        ? await contactNotifyBits(contactId)
        : { title: "Nova mensagem" as const, icon: undefined };
      entregarAviso({
        category: "message",
        kind: "message_inbound",
        title: bits.title,
        body: previewFromMessage(row),
        tag: conversationId ?? undefined,
        href: conversationId ? `/app/inbox?id=${conversationId}` : undefined,
        icon: bits.icon,
      });
    })();
  }, []);

  useRealtimeChannel({
    name: orgId ? `alerts-messages-${orgId}` : "alerts-messages-disabled",
    postgresChanges: orgId
      ? {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `organization_id=eq.${orgId}`,
        }
      : undefined,
    onChange,
    enabled: !!orgId,
  });
}
