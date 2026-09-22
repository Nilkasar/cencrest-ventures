import { apiClient, ApiError } from "@/lib/api-client";
import type { ConnectorProvider, GA4Stats, GSCStats } from "./types";

export class ConnectorNotConnectedError extends Error {
  constructor(provider: string) {
    super(`${provider} is not connected. Connect it from the Connectors page first.`);
    this.name = "ConnectorNotConnectedError";
  }
}

export class OAuthNotConfiguredError extends Error {
  constructor() {
    super("OAuth is not configured — contact your administrator.");
    this.name = "OAuthNotConfiguredError";
  }
}

export class TokenExpiredError extends Error {
  constructor(provider: string) {
    super(`The ${provider} access token has expired. Reconnect to refresh it.`);
    this.name = "TokenExpiredError";
  }
}

function translateError(provider: string, err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | undefined;
    // Backend returns 404 for not_connected (no integration row / wrong status)
    if (err.status === 404 && body?.error === "not_connected") throw new ConnectorNotConnectedError(provider);
    // Backend returns 409 for token_expired (integration exists but token is stale)
    if (err.status === 409 && body?.error === "token_expired") throw new TokenExpiredError(provider);
    if (err.status === 503 && body?.error === "google_oauth_not_configured") throw new OAuthNotConfiguredError();
  }
  throw err;
}

export async function getAuthorizeUrl(provider: ConnectorProvider): Promise<{ url: string }> {
  try {
    return await apiClient.get<{ url: string }>(`/integrations/${provider}/authorize`);
  } catch (err) {
    translateError(provider, err);
  }
}

export async function getGSCStats(days = 28): Promise<GSCStats> {
  try {
    return await apiClient.get<GSCStats>(`/integrations/gsc/stats?days=${days}`);
  } catch (err) {
    translateError("google_search_console", err);
  }
}

export async function getGA4Stats(days = 28): Promise<GA4Stats> {
  try {
    return await apiClient.get<GA4Stats>(`/integrations/ga4/stats?days=${days}`);
  } catch (err) {
    translateError("google_analytics_4", err);
  }
}
