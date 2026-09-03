import { describe, expect, it, vi } from "vitest";
import { toPublicStorageUrl } from "@/lib/supabase/storage-url";

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.deskcomm.example.com",
    SUPABASE_INTERNAL_URL: "http://kong:8000",
    SUPABASE_SERVICE_ROLE_KEY: "mock-key",
  },
}));

describe("toPublicStorageUrl", () => {
  it("converte URL interna http://kong:8000 para NEXT_PUBLIC_SUPABASE_URL", () => {
    const interna =
      "http://kong:8000/storage/v1/object/sign/whatsapp-media/123-abc/media.jpg?token=xyz123";
    const publica = toPublicStorageUrl(interna);

    expect(publica).toBe(
      "https://supabase.deskcomm.example.com/storage/v1/object/sign/whatsapp-media/123-abc/media.jpg?token=xyz123",
    );
  });

  it("converte URL interna https://kong:8000 preservando pathname e query params", () => {
    const interna =
      "https://kong:8000/storage/v1/object/sign/whatsapp-media/6dcda633-cf55-4070-abc?token=jwt.payload.sig";
    const publica = toPublicStorageUrl(interna);

    expect(publica).toBe(
      "https://supabase.deskcomm.example.com/storage/v1/object/sign/whatsapp-media/6dcda633-cf55-4070-abc?token=jwt.payload.sig",
    );
  });

  it("mantém URLs que já apontam para o domínio público", () => {
    const jaPublica =
      "https://supabase.deskcomm.example.com/storage/v1/object/sign/whatsapp-media/foto.jpg?token=123";
    expect(toPublicStorageUrl(jaPublica)).toBe(jaPublica);
  });

  it("não quebra com strings vazias ou nulas", () => {
    expect(toPublicStorageUrl("")).toBe("");
  });

  it("converte http://localhost:54321 quando a URL pública é diferente", () => {
    const local = "http://localhost:54321/storage/v1/object/sign/whatsapp-media/123.png";
    expect(toPublicStorageUrl(local)).toBe(
      "https://supabase.deskcomm.example.com/storage/v1/object/sign/whatsapp-media/123.png",
    );
  });
});
