/**
 * Epic 12 — `POST /brands/me/agents/:agentName/run` (spec's literal
 * `POST /brands/:id/agents/:agentName/run`, adapted to the `/me` convention
 * every Epic 2+ brand-child route in this codebase already uses — same
 * precedent `routes/ai-runs.ts`/`routes/crawl.ts` set) and
 * `GET /brands/me/agents` (this epic's own UI-surface requirement: "an
 * agent-runs history list per brand").
 *
 * `autonomous_actions` (`owner`/`admin` per SECURITY.md's permission
 * matrix — `lib/rbac.ts`) gates triggering a run: an agent acting on an
 * org's behalf is exactly the "autonomous action" that permission already
 * exists to gate, not a new RBAC action this epic needs to invent.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { getBrandForOrg, NO_BRAND_ERROR } from '../lib/brand-context.js';
import { EntitlementLimitError } from '../lib/entitlements.js';
import { AutonomyLevelRejectedError } from '../lib/agents/autonomy.js';
import { triggerAgentRun } from '../lib/agents/runner.js';
import { serializeAgentRun } from '../lib/agents/serialize.js';
import { AGENT_NAMES, type AgentName } from '../lib/agents/types.js';
import type { AppEnv } from '../types/context.js';

const agentsRoute = new Hono<AppEnv>();

// Triggering an agent run is exactly the "autonomous action" SECURITY.md's
// matrix already gates at owner/admin — reused, not a new RBAC action.
const RUN_AGENT = 'autonomous_actions' as const;
const VIEW = 'view_intelligence' as const;

const runBodySchema = z.object({
  // Deliberately a plain `z.number()` (not `z.union([z.literal(1), ...])`)
  // — this is the ONE input this epic's DoD requires to be tested with
  // hostile values (4, 100, -1, 3.5, NaN...), so validation is intentionally
  // loose here and the REAL guard is `lib/agents/autonomy.ts`'s
  // `resolveRequestedAutonomyLevel`, called unconditionally below. A tight
  // Zod schema here would just move the interesting test surface out of
  // this route and into a place `autonomy.test.ts` doesn't reach.
  autonomyLevel: z.number().optional(),
  parameters: z.record(z.unknown()).optional(),
});

function isAgentName(value: string): value is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(value);
}

// ── POST /:agentName/run — trigger, entitlement-checked ──────────────────
agentsRoute.post('/:agentName/run', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(RUN_AGENT), async (c) => {
  const agentNameParam = c.req.param('agentName');
  if (!isAgentName(agentNameParam)) {
    return c.json({ error: 'unknown_agent', message: `Unknown agent "${agentNameParam}". Valid agents: ${AGENT_NAMES.join(', ')}.` }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = runBodySchema.safeParse(body ?? {});
  if (!parsed.success) return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);

  const org = c.get('org');
  const user = c.get('user');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  try {
    // Entitlement (`agents` feature flag + `agent_runs_per_month`) and the
    // autonomy-level hard-block are both resolved INSIDE `triggerAgentRun`,
    // before the `agent_runs` row is created — this epic's end-to-end flow
    // step 2/3's literal invariant.
    const result = await triggerAgentRun({
      organizationId: org.organizationId,
      brandId: brand.id,
      agentName: agentNameParam,
      triggeredBy: 'user',
      triggeredById: user.id,
      requestedAutonomyLevel: parsed.data.autonomyLevel,
      parameters: parsed.data.parameters,
    });
    if ('error' in result) {
      return c.json({ error: 'agents_not_available', message: 'Agents are not available on your current plan.' }, 402);
    }

    await writeManualAuditEvent(c, { action: 'agent_run.created', entityType: 'agent_run', entityId: result.run.id });

    return c.json(serializeAgentRun(result.run), 202);
  } catch (err) {
    // Same typed-error-to-HTTP-status pattern as every other entitlement
    // check in this codebase (`routes/ai-runs.ts`'s
    // `ai_query_limit_reached`) — never a generic 403/500.
    if (err instanceof EntitlementLimitError) {
      return c.json(
        {
          error: 'agent_run_limit_reached',
          message: `Your ${err.plan} plan allows up to ${err.limit.toLocaleString()} agent runs per month (you've already used ${err.current.toLocaleString()} this month).${
            err.upgradeTo ? ` Upgrade to ${err.upgradeTo} for a higher limit.` : ''
          }`,
          metric: err.metric,
          limit: err.limit,
          current: err.current,
          plan: err.plan,
          upgradeTo: err.upgradeTo,
        },
        402,
      );
    }
    if (err instanceof AutonomyLevelRejectedError) {
      return c.json({ error: 'autonomy_level_rejected', message: err.message }, 422);
    }
    throw err;
  }
});

// ── GET / — this brand's agent-run history, newest first (UI surface:
// "an agent-runs history list per brand") ────────────────────────────────
agentsRoute.get('/', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const brand = await getBrandForOrg(org.organizationId);
  if (!brand) return c.json(NO_BRAND_ERROR, 404);

  // Epic 19 (Production Hardening), item 6 — capped server-side (this call
  // had no cap at all before this epic; a brand's run history only ever
  // grows).
  const rows = await withOrgContext(org.organizationId, (tx) =>
    tx.agent_runs.findMany({
      where: { organization_id: org.organizationId, brand_id: brand.id },
      orderBy: { created_at: 'desc' },
      take: 100,
    }),
  );

  return c.json(rows.map(serializeAgentRun));
});

export default agentsRoute;
