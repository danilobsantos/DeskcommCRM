import { EventEmitter } from "node:events";
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Sentry 10 + OpenTelemetry + Next.js ServerResponse tracing empilham listeners
    // de 'close' por requisição, excedendo o limite padrão de 10 do Node.js.
    EventEmitter.defaultMaxListeners = 30;
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
