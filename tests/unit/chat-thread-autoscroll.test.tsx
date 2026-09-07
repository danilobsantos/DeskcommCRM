import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import type { Message } from "@/lib/types/messaging";

const mockMessagesState = {
  data: {
    pages: [
      {
        data: [
          {
            id: "m1",
            conversation_id: "conv-1",
            direction: "inbound",
            body: "Mensagem 1",
            sent_at: "2026-09-07T10:00:00Z",
            status: "delivered",
            type: "text",
          },
        ] as Message[],
        meta: { has_more: false },
      },
    ],
  },
  isLoading: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
  realtimeStatus: "subscribed",
  seguranca: { divergencias: 0 },
};

vi.mock("@/hooks/inbox/useMessagesRealtime", () => ({
  useMessagesRealtime: () => mockMessagesState,
}));

vi.mock("@/hooks/inbox/useConversationNotes", () => ({
  useConversationNotes: () => [],
}));

vi.mock("@/hooks/inbox/useDeleteNote", () => ({
  useDeleteNote: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/ai/useDebugToggle", () => ({
  useDebugToggle: () => ({ enabled: false }),
}));

vi.mock("@/hooks/auth/AuthProvider", () => ({
  useActiveOrg: () => ({ role: "admin" }),
  useUser: () => ({ id: "user-1" }),
}));

import { ptBR } from "date-fns/locale";

vi.mock("@/hooks/i18n/useLocaleDeData", () => ({
  useLocaleDeData: () => ptBR,
}));

vi.mock("@/hooks/i18n/useT", () => ({
  useT: () => (str: string) => str,
}));

import { ChatThread } from "@/components/inbox/ChatThread";

describe("ChatThread - rolagem automática ao receber mensagens", () => {
  let scrollToSpy: ReturnType<typeof vi.fn>;
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    scrollToSpy = vi.fn();
    scrollIntoViewSpy = vi.fn();

    window.HTMLElement.prototype.scrollTo =
      scrollToSpy as unknown as typeof window.HTMLElement.prototype.scrollTo;
    window.HTMLElement.prototype.scrollIntoView =
      scrollIntoViewSpy as unknown as typeof window.HTMLElement.prototype.scrollIntoView;

    // Reset standard message state
    mockMessagesState.data = {
      pages: [
        {
          data: [
            {
              id: "m1",
              conversation_id: "conv-1",
              direction: "inbound",
              body: "Mensagem 1",
              sent_at: "2026-09-07T10:00:00Z",
              status: "delivered",
              type: "text",
            },
          ] as Message[],
          meta: { has_more: false },
        },
      ],
    };
  });

  it("rola ao fim na primeira carga da conversa", async () => {
    render(<ChatThread conversationId="conv-1" />);

    // Deve renderizar a thread com a mensagem
    expect(screen.getByText("Mensagem 1")).toBeInTheDocument();

    // rAF roda a rolagem
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(scrollToSpy).toHaveBeenCalled();
  });

  it("ao receber nova mensagem inbound com o usuário no rodapé, rola automaticamente para exibi-la", async () => {
    const { rerender, container } = render(<ChatThread conversationId="conv-1" />);

    await new Promise((resolve) => requestAnimationFrame(resolve));
    scrollToSpy.mockClear();

    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    expect(scroller).not.toBeNull();

    // Simula que o usuário está no rodapé (distância 0 <= 150)
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });
    Object.defineProperty(scroller, "scrollTop", { value: 500, configurable: true });

    fireEvent.scroll(scroller);

    // Chega nova mensagem inbound via Realtime
    mockMessagesState.data = {
      pages: [
        {
          data: [
            mockMessagesState.data.pages[0]!.data[0]!,
            {
              id: "m2",
              conversation_id: "conv-1",
              direction: "inbound",
              body: "Nova mensagem do cliente",
              sent_at: "2026-09-07T10:01:00Z",
              status: "delivered",
              type: "text",
            },
          ] as Message[],
          meta: { has_more: false },
        },
      ],
    };

    rerender(<ChatThread conversationId="conv-1" />);

    expect(screen.getByText("Nova mensagem do cliente")).toBeInTheDocument();

    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Como estava no rodapé, DEVE rolar suavemente para exibir a nova mensagem
    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: "smooth",
      }),
    );
  });

  it("não rola se o usuário rolou para cima lendo mensagens antigas e chega mensagem inbound", async () => {
    const { rerender, container } = render(<ChatThread conversationId="conv-1" />);

    await new Promise((resolve) => requestAnimationFrame(resolve));
    scrollToSpy.mockClear();

    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    expect(scroller).not.toBeNull();

    // Simula que o usuário rolou para cima (distância = 1000 - 100 - 500 = 400 > 150)
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });
    Object.defineProperty(scroller, "scrollTop", { value: 100, configurable: true });

    fireEvent.scroll(scroller);

    // Chega nova mensagem inbound
    mockMessagesState.data = {
      pages: [
        {
          data: [
            mockMessagesState.data.pages[0]!.data[0]!,
            {
              id: "m2",
              conversation_id: "conv-1",
              direction: "inbound",
              body: "Outra mensagem de fora",
              sent_at: "2026-09-07T10:02:00Z",
              status: "delivered",
              type: "text",
            },
          ] as Message[],
          meta: { has_more: false },
        },
      ],
    };

    rerender(<ChatThread conversationId="conv-1" />);

    await new Promise((resolve) => requestAnimationFrame(resolve));

    // NÃO deve rolar pois o usuário estava lendo o histórico
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("rola para o fim se o usuário enviou uma mensagem outbound, mesmo que estivesse lendo acima", async () => {
    const { rerender, container } = render(<ChatThread conversationId="conv-1" />);

    await new Promise((resolve) => requestAnimationFrame(resolve));
    scrollToSpy.mockClear();

    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;

    // Usuário estava acima
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });
    Object.defineProperty(scroller, "scrollTop", { value: 100, configurable: true });

    fireEvent.scroll(scroller);

    // Mensagem enviada pelo próprio usuário (outbound)
    mockMessagesState.data = {
      pages: [
        {
          data: [
            mockMessagesState.data.pages[0]!.data[0]!,
            {
              id: "m3",
              conversation_id: "conv-1",
              direction: "outbound",
              sent_by_user_id: "user-1",
              body: "Minha resposta",
              sent_at: "2026-09-07T10:03:00Z",
              status: "sent",
              type: "text",
            },
          ] as Message[],
          meta: { has_more: false },
        },
      ],
    };

    rerender(<ChatThread conversationId="conv-1" />);

    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Como foi envio próprio, DEVE rolar para o rodapé
    expect(scrollToSpy).toHaveBeenCalled();
  });
});
