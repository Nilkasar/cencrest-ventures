import { apiClient, ApiError } from "@/lib/api-client";
import { PLAN_TIERS, type Invoice, type Plan, type PlanTier, type SubscriptionSnapshot } from "./types";

/**
 * The Billing tab's data-access seam — same role as `data/ai-visibility/client.ts`
 * and `data/query-universe/client.ts`: every screen calls through here, never
 * `apiClient` directly. Calls `platform/apps/api`'s real, tested routes from
 * the first line — no fixture layer, per the epic's standing rule:
 *
 *   GET  /api/plans                              -> listPlans()
 *   GET  /api/orgs/me/subscription                -> getSubscription()
 *   GET  /api/orgs/me/subscription/invoices        -> listInvoices()
 *   POST /api/orgs/me/subscription/upgrade         -> changePlan() (higher tier)
 *   POST /api/orgs/me/subscription/downgrade       -> changePlan() (lower tier)
 *   POST /api/orgs/me/subscription/cancel          -> cancelSubscription()
 */

/** Thrown when a mutating call (`upgrade`/`downgrade`/`cancel`) is rejected
 *  by `requirePermission('manage_billing')` — owner-only per
 *  `docs/08-security/SECURITY.md`. Lets the panel show a precise message
 *  instead of a generic failure. */
export class BillingForbiddenError extends Error {
  constructor() {
    super("Only the organization owner can make changes to billing.");
    this.name = "BillingForbiddenError";
  }
}

/** Thrown when the target plan isn't actually higher (`/upgrade`) or lower
 *  (`/downgrade`) than the current one — `routes/subscription.ts`'s 422
 *  `not_an_upgrade`/`not_a_downgrade`. Carries the backend's own message. */
export class InvalidPlanTransitionError extends Error {
  constructor(
    public readonly code: "not_an_upgrade" | "not_a_downgrade",
    message: string,
  ) {
    super(message);
    this.name = "InvalidPlanTransitionError";
  }
}

interface SubscriptionErrorBody {
  error?: string;
  message?: string;
}

function translateSubscriptionError(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.status === 403) throw new BillingForbiddenError();
    const body = err.body as SubscriptionErrorBody | undefined;
    if (err.status === 422 && (body?.error === "not_an_upgrade" || body?.error === "not_a_downgrade")) {
      throw new InvalidPlanTransitionError(body.error, body.message ?? "That plan change isn't valid.");
    }
  }
  throw err;
}

/** Active plans for the upgrade/downgrade picker, free -> enterprise. */
export async function listPlans(): Promise<Plan[]> {
  return apiClient.get<Plan[]>("/plans");
}

/** Current plan, subscription status, and usage-vs-limit for every metered
 *  resource. Bootstraps a free-tier subscription server-side on first call
 *  for an org that never had one — never 404s. */
export async function getSubscription(): Promise<SubscriptionSnapshot> {
  return apiClient.get<SubscriptionSnapshot>("/orgs/me/subscription");
}

export async function listInvoices(): Promise<Invoice[]> {
  const { invoices } = await apiClient.get<{ invoices: Invoice[] }>("/orgs/me/subscription/invoices");
  return invoices;
}

function tierIndex(slug: PlanTier): number {
  return PLAN_TIERS.indexOf(slug);
}

/** Picks `/upgrade` or `/downgrade` based on where `targetSlug` sits
 *  relative to `currentSlug` in `PLAN_TIERS` — the same tier order
 *  `routes/subscription.ts`'s `tierIndex` compares against, so the request
 *  always hits the endpoint that will actually accept it. */
export async function changePlan(currentSlug: PlanTier, targetSlug: PlanTier): Promise<SubscriptionSnapshot> {
  const direction = tierIndex(targetSlug) > tierIndex(currentSlug) ? "upgrade" : "downgrade";
  try {
    return await apiClient.post<SubscriptionSnapshot>(`/orgs/me/subscription/${direction}`, { planSlug: targetSlug });
  } catch (err) {
    translateSubscriptionError(err);
  }
}

export async function cancelSubscription(): Promise<SubscriptionSnapshot & { cancelledAt: string }> {
  try {
    return await apiClient.post<SubscriptionSnapshot & { cancelledAt: string }>("/orgs/me/subscription/cancel");
  } catch (err) {
    translateSubscriptionError(err);
  }
}
