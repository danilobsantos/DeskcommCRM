import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync("docker-compose.dokploy.yml", "utf8");
const workflow = readFileSync(".github/workflows/publish-image.yml", "utf8");

describe("imagens que o Dokploy instala", () => {
  it("as três imagens do compose são exatamente as publicadas pelo CI", () => {
    const publicadas = [...workflow.split("  build-and-push:")[1]!
      .split("  imagem-do-app-sobe:")[0]!.matchAll(/^\s+- name: (conecta-[\w-]+)$/gm)]
      .map((m) => m[1]);
    const instaladas = [...compose.matchAll(/image: \$\{(?:APP|WORKER|SCHEDULER)_IMAGE:-ghcr\.io\/danilobsantos\/(conecta-[\w-]+):latest\}/g)]
      .map((m) => m[1]);

    expect(instaladas.sort()).toEqual(["conecta-app", "conecta-scheduler", "conecta-worker"]);
    expect(publicadas.sort()).toEqual(instaladas);
    expect(workflow).toContain("file: Dockerfile.worker");
    expect(workflow).toContain("file: Dockerfile.scheduler");
    expect(workflow).toContain("scripts/sonda-do-laco-de-event-log.ts");
    expect(workflow).toContain("docker exec cron-smoke grep -q 'api/v1/cron/event-log-drain'");
  });
});
