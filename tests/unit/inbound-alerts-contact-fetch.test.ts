import { beforeEach, describe, expect, it, vi } from "vitest";

describe("useInboundMessageAlerts — busca de contatos para notificação", () => {
  const contactId = "acbcd58e-db87-4ae3-a649-ca07b0c48e3e";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("busca o contato via API route (/api/v1/contacts/[id]) e NÃO chama /avatar quando não tem foto", async () => {
    const fetchCalls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetchCalls.push(url);
        if (url === `/api/v1/contacts/${contactId}`) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                contact: {
                  id: contactId,
                  display_name: "Cliente Teste",
                  name: null,
                  avatar_storage_path: null,
                  is_anonymized: false,
                },
              },
            }),
          };
        }
        return { ok: false, status: 404 };
      }),
    );

    const { contactNotifyBits, __resetContactCache } = await import(
      "@/hooks/notifications/useInboundMessageAlerts"
    );
    __resetContactCache();

    const bits = await contactNotifyBits(contactId);

    expect(bits.title).toBe("Cliente Teste");
    expect(bits.icon).toBeUndefined();

    // Verificação de ouro: chamou a API REST correta e NUNCA chamou a rota de avatar (evitando o 404)
    expect(fetchCalls).toEqual([`/api/v1/contacts/${contactId}`]);

    // Segunda chamada reusa o cache em memória sem novas requisições
    const bits2 = await contactNotifyBits(contactId);
    expect(bits2.title).toBe("Cliente Teste");
    expect(fetchCalls).toHaveLength(1);
  });

  it("quando o contato tem avatar_storage_path, chama a rota de avatar para obter a URL assinada", async () => {
    const fetchCalls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetchCalls.push(url);
        if (url === `/api/v1/contacts/${contactId}`) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                contact: {
                  id: contactId,
                  display_name: "Cliente com Foto",
                  avatar_storage_path: "profiles/foto.jpg",
                  is_anonymized: false,
                },
              },
            }),
          };
        }
        if (url === `/api/v1/contacts/${contactId}/avatar`) {
          return {
            ok: true,
            status: 200,
            url: "https://storage.supabase.co/signed/foto.jpg",
          };
        }
        return { ok: false, status: 404 };
      }),
    );

    const { contactNotifyBits, __resetContactCache } = await import(
      "@/hooks/notifications/useInboundMessageAlerts"
    );
    __resetContactCache();

    const bits = await contactNotifyBits(contactId);

    expect(bits.title).toBe("Cliente com Foto");
    expect(bits.icon).toBe("https://storage.supabase.co/signed/foto.jpg");
    expect(fetchCalls).toEqual([
      `/api/v1/contacts/${contactId}`,
      `/api/v1/contacts/${contactId}/avatar`,
    ]);
  });
});
