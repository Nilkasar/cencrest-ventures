import { apiClient, ApiError } from "@/lib/api-client";
import type { SnapshotIntakeInput, SnapshotStatusResponse, SnapshotSubmitResponse } from "./types";

/**
 * Epic 17 (Free AI + SEO Growth Snapshot) — the PUBLIC, unauthenticated
 * data-access seam. Same role as every other epic's `client.ts` (e.g.
 * `data/billing/client.ts`) — every screen calls through here, never
 * `apiClient` directly — but this one is the one client module in the app
 * that talks to routes with no session/cookie behind them at all:
 *
 *   POST /api/snapshot        -> submitFreeSnapshot()
 *   GET  /api/snapshot/:token -> getSnapshotReport()
 */

interface SnapshotErrorBody {
  error?: string;
  message?: string;
  retryAfter?: number;
  issues?: Array<{ path: (string | number)[]; message: string }>;
}

/** `POST /snapshot`'s 429 — `middleware/rate-limit.ts`'s
 *  `freeSnapshotRateLimit` (1 request/hour/IP, `docs/08-security/SECURITY.md`),
 *  the single most important error this form can surface precisely: this is
 *  not a bug, it's the documented abuse guard for the highest-risk public
 *  endpoint in the system. */
export class SnapshotRateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      retryAfterSeconds > 0
        ? `You can request one free snapshot per hour. Try again in about ${Math.ceil(retryAfterSeconds / 60)} minute(s).`
        : "You can request one free snapshot per hour. Please try again shortly.",
    );
    this.name = "SnapshotRateLimitedError";
  }
}

/** `POST /snapshot`'s 422 — zod validation failure (e.g. the website URL
 *  failed `isSafePublicHttpUrl`, the SSRF guard this endpoint reuses
 *  exactly per `docs/epics/17-free-snapshot.md`). Carries the raw zod
 *  issues so the form can point at the specific field, plus a single
 *  human-readable summary for a generic banner fallback. */
export class SnapshotValidationError extends Error {
  constructor(public readonly issues: Array<{ path: (string | number)[]; message: string }>) {
    super(issues[0]?.message ?? "Please check the form and try again.");
    this.name = "SnapshotValidationError";
  }
}

/** `GET /snapshot/:token`'s 404 — an unknown, mistyped, or already-expired
 *  token. Deliberately generic (never "no such row") — this is the public
 *  endpoint `docs/epics/17-free-snapshot.md` explicitly calls out as
 *  "don't leak enumerable IDs," so the client-facing message matches. */
export class SnapshotNotFoundError extends Error {
  constructor() {
    super("We couldn't find a snapshot for this link. It may be invalid or have expired.");
    this.name = "SnapshotNotFoundError";
  }
}

function translateSubmitError(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as SnapshotErrorBody | undefined;
    if (err.status === 429) throw new SnapshotRateLimitedError(body?.retryAfter ?? 0);
    if (err.status === 422 && body?.issues) throw new SnapshotValidationError(body.issues);
  }
  throw err;
}

/** Step 1-2a of the flow: submits the intake form, which (behind the
 *  scenes, server-side) creates the `leads` row before this call even
 *  returns and schedules the rest of the orchestrated pipeline in the
 *  background. Resolves with the confirmation-screen payload — the
 *  literal "Your snapshot is being prepared..." message plus the tokenized
 *  report URL — the instant the lead exists, not once the pipeline
 *  finishes. */
export async function submitFreeSnapshot(input: SnapshotIntakeInput): Promise<SnapshotSubmitResponse> {
  try {
    return await apiClient.post<SnapshotSubmitResponse>("/snapshot", input);
  } catch (err) {
    translateSubmitError(err);
  }
}

/** Polled by the report page while `status` is `pending`/`processing` —
 *  same "poll a background job's status row" shape as
 *  `data/website/client.ts#getCrawlJob`/`data/ai-visibility/client.ts#getAiRun`,
 *  just against a public, tokenized resource with no organization to scope
 *  it by. A 404 becomes a typed `SnapshotNotFoundError` rather than a
 *  generic `ApiError` so the page can render its own "invalid link" state
 *  instead of a blank error banner. */
export async function getSnapshotReport(token: string): Promise<SnapshotStatusResponse> {
  try {
    return await apiClient.get<SnapshotStatusResponse>(`/snapshot/${encodeURIComponent(token)}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw new SnapshotNotFoundError();
    throw err;
  }
}
