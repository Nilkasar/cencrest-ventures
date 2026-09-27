/**
 * WHOSE SPEND IS THIS? — the one piece of context the AI adapters do not
 * naturally have, and the reason metering lives here in `apps/api` rather
 * than inside `@bebest/ai-provider`.
 *
 * `@bebest/ai-provider` is a pure package: it has no database access and
 * knows nothing about tenants (its own `types.ts` says so — "this package
 * does not persist anything itself"). Threading `organization_id` into it
 * would either pollute that package with app concerns or force a breaking
 * change to the `AIProvider` interface that every route and agent depends
 * on. So the org travels with the *registry instance* an app-side caller
 * asks for (`getMeteredAiProviderRegistry(attribution)`), not with each
 * request object.
 */
import { getInternalOrgId, MissingInternalOrgConfigError } from '../internal-org.js';

export interface AiUsageAttribution {
  /**
   * The tenant whose budget this spend belongs to.
   *
   * `null` means "no tenant exists yet" — the anonymous free-snapshot flow
   * (`lib/free-snapshot/*`), which runs 20-50 queries x 4 assistants for a
   * lead who has no `organizations` row at all. That spend is REAL money and
   * must not vanish, so it is attributed to BeBest's own internal operations
   * org (`CRM_INTERNAL_ORG_ID`) — see `resolveMeteringOrgId`.
   *
   * It is never read from a client. Callers pass the org id they already
   * authorized (the JWT-derived one a route/pipeline is working on).
   */
  organizationId: string | null;
  /**
   * What caused the call — `ai_visibility_run`, `free_snapshot`,
   * `agent:geo`, `content_draft`, etc.
   *
   * NOT PERSISTED: `ai_usage` has no column for it (see
   * `packages/database/prisma/schema.prisma`). It is carried so every
   * metering log line can name the spending feature, and so that adding a
   * `feature` column later is a migration plus one `data:` line rather than
   * re-threading context through four call sites. Until that column exists,
   * a query of "what did the free snapshot cost us last month" is answered
   * by "the internal org's `ai_usage` rows", not by a filter on this field.
   */
  feature: string;
}

/**
 * Resolves the `organization_id` an `ai_usage` row must carry.
 *
 * Unattributed spend (free snapshot) lands on the internal BeBest operations
 * org. Why that org and not a nullable column:
 *   - `ai_usage.organization_id` is NOT NULL with an FK to `organizations`,
 *     and its RLS policy is `organization_id = current_setting('app.current_org')`
 *     for both USING and WITH CHECK — a NULL row would be invisible to every
 *     tenant AND to the app role that wrote it, i.e. write-only data.
 *   - `CRM_INTERNAL_ORG_ID` is an ALREADY-ESTABLISHED concept in this
 *     codebase (`lib/internal-org.ts`, Epic 1 CRM) for exactly this: BeBest's
 *     own tenant. It runs no customer pipelines, so its `ai_usage` rows ARE
 *     the unattributed pool — aggregate free-snapshot spend is
 *     `SUM(cost_usd)` for that one org, with no schema change and no
 *     cross-tenant leak (the write still happens inside that org's RLS
 *     context; org A can never see it).
 *
 * Returns `null` when the internal org is not configured. The caller then
 * SKIPS the write and logs loudly — under-counting is bad, but a write that
 * would break the AI call, or one that guesses a tenant, is worse.
 */
export function resolveMeteringOrgId(attribution: AiUsageAttribution): string | null {
  if (attribution.organizationId !== null && attribution.organizationId.length > 0) {
    return attribution.organizationId;
  }
  try {
    return getInternalOrgId();
  } catch (err) {
    if (err instanceof MissingInternalOrgConfigError) return null;
    throw err;
  }
}
