/**
 * Thin fetch abstraction for `platform/apps/api` (built in parallel this
 * epic, not yet callable from here). Nothing in this app calls this module
 * yet — every screen in Epic 0 renders typed fixture data or an EmptyState
 * instead. It exists now so that wiring a real page next epic is:
 *
 *   const leads = await apiClient.get<Lead[]>("/crm/leads");
 *
 * instead of a rewrite of how requests are made, authenticated, and errors
 * are surfaced.
 */

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

async function request<T>(path: string, init: RequestInit & RequestOptions = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      // Auth token wiring lands with Epic 0's backend session work; the
      // shape below is the intended seam (read from an httpOnly-cookie
      // backed session, not localStorage).
      ...init.headers,
    },
    credentials: "include",
  });

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
