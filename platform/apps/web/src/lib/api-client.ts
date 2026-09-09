/**
 * Thin fetch abstraction for `platform/apps/api`.
 *
 * Auth model, matching what the backend actually does (`apps/api/src/routes/
 * auth.ts`, `apps/api/DECISIONS.md`) — bearer tokens only, the server sets
 * NO cookies at all, so there is nothing for `credentials: "include"` to
 * send and no CSRF token to attach (correct per the backend's own docs: no
 * cookies means no CSRF surface). Every request here attaches
 * `Authorization: Bearer <access token>` from `lib/auth-state.ts`'s
 * in-memory token. On a 401, this module attempts one silent
 * `POST /auth/refresh` using the persisted refresh token and retries the
 * original request exactly once before surfacing the error — see
 * `refreshAccessToken` below. Full storage/tradeoff writeup:
 * `platform/apps/web/DECISIONS.md`.
 */

import {
  getAccessToken,
  getRefreshToken,
  getSelectedOrgSlug,
  handleSessionExpired,
  setSession,
} from "./auth-state";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

interface RequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

// Concurrent 401s (several in-flight requests whose access token expired at
// once) must trigger exactly one `/auth/refresh` call, not one per request —
// every caller that arrives while a refresh is already running awaits this
// same promise instead of racing it.
let inFlightRefresh: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `orgSlug` asks the server to re-attach the org this browser was
      // acting as. Without it the refreshed access token carries no org
      // claim, and every org-scoped route answers 409 — so a silent token
      // refresh (or any page reload) used to drop the user out of their own
      // organization mid-session. The server re-verifies access before
      // honouring it; sending a slug you don't have access to just yields
      // an org-less token, exactly as before.
      body: JSON.stringify({ refreshToken, orgSlug: getSelectedOrgSlug() ?? undefined }),
    });
    if (!response.ok) return false;

    const data = (await response.json()) as RefreshResponse;
    setSession({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return true;
  } catch {
    return false;
  }
}

function refreshAccessTokenOnce(): Promise<boolean> {
  if (!inFlightRefresh) {
    inFlightRefresh = refreshAccessToken().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

async function request<T>(
  path: string,
  init: RequestInit & RequestOptions = {},
  isRetryAfterRefresh = false,
): Promise<T> {
  const accessToken = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401 && !isRetryAfterRefresh) {
    const refreshed = await refreshAccessTokenOnce();
    if (refreshed) {
      return request<T>(path, init, true);
    }
    // Refresh token missing/expired/revoked — the session is genuinely
    // over, not just this one access token. Clear state and send the user
    // back to `/login` rather than surfacing a raw 401 to a caller with no
    // way to act on it.
    handleSessionExpired();
  }

  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new ApiError(`Request to ${path} failed with ${response.status}`, response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { method: "GET", ...options }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined, ...options }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined, ...options }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { method: "DELETE", ...options }),
};
