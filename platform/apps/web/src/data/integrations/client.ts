import { apiClient, ApiError } from "@/lib/api-client";
import type { Integration } from "./types";

/**
 * Epic 18's integrations data-access seam. Calls
 * `apps/api/src/routes/integrations.ts`'s real routes from the first line —
 * mock connect/disconnect, no OAuth redirect, no network call, per the
 * epic's explicit constraint:
 *
 *   GET  /api/integrations                     -> listIntegrations()
 *   POST /api/integrations/:provider/connect    -> connectIntegration()
 *   POST /api/integrations/:provider/disconnect -> disconnectIntegration()
 */

/** Thrown on `400 unsupported_provider` — a `:provider` slug outside
 *  `routes/integrations.ts`'s `PROVIDER_SLUGS` allowlist. Shouldn't be
 *  reachable from the UI (`SUPPORTED_PROVIDERS` drives what's offered), but
 *  translated the same way every other typed backend error is. */
export class UnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(`"${provider}" isn't a supported integration yet.`);
    this.name = "UnsupportedProviderError";
  }
}

/** Thrown on `403` — connect/disconnect require `admin`+ and
 *  `manage_integrations`. */
export class IntegrationsForbiddenError extends Error {
  constructor() {
    super("Only an organization admin or owner can manage integrations.");
    this.name = "IntegrationsForbiddenError";
  }
}

function translateError(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.status === 400) {
      const body = err.body as { error?: string } | undefined;
      if (body?.error === "unsupported_provider") throw new UnsupportedProviderError("that provider");
    }
    if (err.status === 403) throw new IntegrationsForbiddenError();
  }
  throw err;
}

/** This org's connections. Never includes the encrypted token blob. */
export async function listIntegrations(): Promise<Integration[]> {
  return apiClient.get<Integration[]>("/integrations");
}

/** Mock connect — no OAuth redirect, no real network call (see
 *  `routes/integrations.ts`'s own "DEPLOYMENT-TIME INTEGRATION POINT"
 *  comment for exactly where a real handshake would plug in). Idempotent:
 *  reconnecting an already-connected provider just re-mints the mock
 *  tokens. */
export async function connectIntegration(provider: string): Promise<Integration> {
  try {
    return await apiClient.post<Integration>(`/integrations/${provider}/connect`);
  } catch (err) {
    translateError(err);
  }
}

export async function disconnectIntegration(provider: string): Promise<Integration> {
  try {
    return await apiClient.post<Integration>(`/integrations/${provider}/disconnect`);
  } catch (err) {
    translateError(err);
  }
}
