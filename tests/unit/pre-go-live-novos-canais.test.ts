import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

const CAMINHOS_DE_CRIACAO = [
  "app/api/v1/channel-sessions/route.ts",
  "app/api/v1/onboarding/whatsapp/session/route.ts",
  "app/api/v1/channels/official/route.ts",
  "lib/channels/connect.ts",
] as const;

describe("todo canal criado pela interface nasce em pré-go-live", () => {
  it.each(CAMINHOS_DE_CRIACAO)("%s usa a configuração inicial compartilhada", (arquivo) => {
    const fonte = readFileSync(resolve(RAIZ, arquivo), "utf8");
    expect(fonte).toMatch(/import \{ metadataInicialDoCanal \}/);
    expect(fonte).toMatch(/metadata:\s*metadataInicialDoCanal\(\)/);
  });

  it("reconectar canal parceiro preserva a configuração que já existia", () => {
    const fonte = readFileSync(resolve(RAIZ, "lib/channels/connect.ts"), "utf8");
    const update = fonte.slice(
      fonte.indexOf('? await admin.from("channel_sessions").update(linha)'),
      fonte.indexOf(": await admin", fonte.indexOf('? await admin.from("channel_sessions").update(linha)')),
    );
    expect(update).not.toContain("metadataInicialDoCanal");
  });
});
