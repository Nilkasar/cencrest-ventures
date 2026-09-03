import { apiClient, ApiError } from "@/lib/api-client";
import type { WhiteLabelBranding, WhiteLabelPatch } from "./types";

/**
 * Epic 18's white-label data-access seam — mirrors `data/billing/client.ts`'s
 * role for its epic. Calls `apps/api/src/routes/white-label.ts`'s real
 * routes from the first line:
 *
 *   GET   /api/orgs/me/settings/white-label -> getWhiteLabel()
 *   PATCH /api/orgs/me/settings/white-label -> updateWhiteLabel()
 */

interface WhiteLabelErrorBody {
  error?: string;
  message?: string;
  feature?: string;
  plan?: string;
  issues?: unknown;
}

/** Thrown on `402 feature_not_available` — the org's plan doesn't include
 *  the `white_label` entitlement (Epic 16's real `plans.limits`). Carries
 *  the plan so the panel can point at Settings > Billing precisely. */
export class WhiteLabelNotAvailableError extends Error {
  constructor(
    message: string,
    public readonly plan: string,
  ) {
    super(message);
    this.name = "WhiteLabelNotAvailableError";
  }
}

/** Thrown on `403` — `PATCH` requires `admin`+. */
export class WhiteLabelForbiddenError extends Error {
  constructor() {
    super("Only an organization admin or owner can change white-label branding.");
    this.name = "WhiteLabelForbiddenError";
  }
}

/** Thrown on `422` field validation (bad hex color, bad URL, bad email). */
export class WhiteLabelValidationError extends Error {
  constructor(message = "That didn't pass validation — check the highlighted fields.") {
    super(message);
    this.name = "WhiteLabelValidationError";
  }
}

function translateError(err: unknown): never {
  if (err instanceof ApiError) {
    const body = err.body as WhiteLabelErrorBody | undefined;
    if (err.status === 402) {
      throw new WhiteLabelNotAvailableError(
        body?.message ?? "White-label branding isn't available on your current plan.",
        body?.plan ?? "free",
      );
    }
    if (err.status === 403) throw new WhiteLabelForbiddenError();
    if (err.status === 422) throw new WhiteLabelValidationError(body?.message);
  }
  throw err;
}

/** Always 200 — returns the org's saved config, or the documented default
 *  BeBest branding if none has been configured yet. Any org member (viewer+)
 *  can read this. */
export async function getWhiteLabel(): Promise<WhiteLabelBranding> {
  return apiClient.get<WhiteLabelBranding>("/orgs/me/settings/white-label");
}

/** Upserts any subset of the branding fields. Admin+, gated by the real
 *  `white_label` plan entitlement — see `WhiteLabelNotAvailableError`. */
export async function updateWhiteLabel(patch: WhiteLabelPatch): Promise<WhiteLabelBranding> {
  try {
    return await apiClient.patch<WhiteLabelBranding>("/orgs/me/settings/white-label", patch);
  } catch (err) {
    translateError(err);
  }
}
