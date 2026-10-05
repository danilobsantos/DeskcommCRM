import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetalheDoCompromisso } from "@/components/agenda/DetalheDoCompromisso";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

/**
 * EDIÇÃO DE COMPROMISSO NA TELA (9015) — o detalhe edita título, paciente,
 * horário, tipo e observação pelo PATCH, e a troca de paciente PEDE
 * CONFIRMAÇÃO antes de sair (o convite no Google muda junto e não se desfaz
 * sozinho).
 */
const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
// O diálogo de criar contato exige AuthProvider; aqui ele nunca abre.
vi.mock("@/components/contacts/NewContactDialog", () => ({
  NewContactDialog: () => null,
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));

const TIPO_A = "00000000-0000-4000-8000-0000000000dd";
const TIPO_B = "00000000-0000-4000-8000-0000000000dc";
const PACIENTE_A = "00000000-0000-4000-8000-000000000a01";
const PACIENTE_B = "00000000-0000-4000-8000-000000000a02";

const detalhe = {
  id: "appointment",
  title: "Consulta",
  description: null,
  notes: null,
  location_kind: "none",
  location_details: null,
  starts_at: "2026-10-06T12:00:00Z",
  ends_at: "2026-10-06T12:30:00Z",
  time_zone: "America/Sao_Paulo",
  status: "confirmed",
  revision: 1,
  contact_id: PACIENTE_A,
  conversation_id: null,
  event_type_id: TIPO_A,
  outcome_source_kind: null,
  outcome_recorded_at: null,
  recovery: null,
  evidence_messages: [],
};

const TIPOS = [
  { id: TIPO_A, name: "Consulta", duration_minutes: 30, is_active: true },
  { id: TIPO_B, name: "Sessão longa", duration_minutes: 60, is_active: true },
];

let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.get.mockImplementation(async (url: string) => {
    if (url.includes("/tipos")) return { data: TIPOS };
    if (url.includes("/vinculos")) {
      if (url.includes(`contact_id=${PACIENTE_A}`)) {
        return { data: { contacts: [{ id: PACIENTE_A, name: "Maria Silva" }], conversations: [] } };
      }
      return {
        data: { contacts: [{ id: PACIENTE_B, name: "João Souza" }], conversations: [] },
      };
    }
    return { data: detalhe };
  });
  api.patch.mockResolvedValue({});
  api.delete.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  client.clear();
});

function open() {
  render(
    <IdiomaProvider locale="pt-BR">
      <QueryClientProvider client={client}>
        <DetalheDoCompromisso id="appointment" onClose={() => {}} />
      </QueryClientProvider>
    </IdiomaProvider>,
  );
  return screen.findByRole("button", { name: "Editar compromisso" });
}

it("edita título e observação e salva só o que mudou", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Editar compromisso" }));

  const titulo = await screen.findByTestId("editar-titulo");
  fireEvent.change(titulo, { target: { value: "Maria Silva" } });
  fireEvent.change(screen.getByTestId("editar-observacao"), {
    target: { value: "Retorno de 6 meses" },
  });
  fireEvent.click(screen.getByTestId("salvar-edicao"));

  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith("/api/v1/agenda/agendamentos", {
      id: "appointment",
      revision: 1,
      title: "Maria Silva",
      description: "Retorno de 6 meses",
    }),
  );
});

it("sem mudança, o salvar fica desligado e nada sai na rede", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Editar compromisso" }));

  const salvar = (await screen.findByTestId("salvar-edicao")) as HTMLButtonElement;
  expect(salvar.disabled).toBe(true);
  fireEvent.click(salvar);
  expect(api.patch).not.toHaveBeenCalled();
});

it("troca de paciente PEDE CONFIRMAÇÃO antes do PATCH", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Editar compromisso" }));

  // O seletor de paciente é o mesmo da marcação: digita, escolhe na lista.
  const quem = await screen.findByTestId("quem-sera-atendido");
  fireEvent.change(quem, { target: { value: "João" } });
  fireEvent.click(await screen.findByText("João Souza"));

  fireEvent.click(screen.getByTestId("salvar-edicao"));

  // A confirmação aparece ANTES de qualquer PATCH…
  const confirmar = await screen.findByTestId("confirmar-troca-paciente");
  expect(api.patch).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog", { name: "Confirmar troca de paciente" })).toBeTruthy();

  // …e só o confirmar dispara a troca (com a conversa solta junto).
  fireEvent.click(confirmar);
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith("/api/v1/agenda/agendamentos", {
      id: "appointment",
      revision: 1,
      contact_id: PACIENTE_B,
      conversation_id: null,
    }),
  );
});

it("troca de tipo entra no PATCH e o horário pode ir junto", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Editar compromisso" }));

  // Espera as opções: mudar o select antes de carregar faz o jsdom zerar o
  // valor (sem <option> correspondente), e o teste mediria um bug que não existe.
  await screen.findByText(/Sessão longa/);
  fireEvent.change(await screen.findByTestId("editar-tipo"), { target: { value: TIPO_B } });
  fireEvent.click(screen.getByTestId("salvar-edicao"));

  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith(
      "/api/v1/agenda/agendamentos",
      expect.objectContaining({ id: "appointment", revision: 1, event_type_id: TIPO_B }),
    ),
  );
});
