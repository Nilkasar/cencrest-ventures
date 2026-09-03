/**
 * Epic 14 (Measurement & Learning Loop) — `GET /actions/:id/measurement`,
 * the spec's literal route, matching exactly (an `actions` row is
 * addressed by its own id, not a brand's, same convention `/api/ai-runs/
 * :id`/`/api/agent-runs/:id`/`/api/actions/:id/approve` already use).
 * Mounted at the SAME `/api/actions` base as `action-details.ts` (same
 * "two routers, one base path" precedent `/api/opportunities` already sets
 * for `opportunity-details.ts` + `opportunity-recommendations.ts`).
 *
 * Always 200, even before a measurement exists yet (`measured: false`) —
 * same "a caller can poll this exactly like it polls run status, never
 * needing to distinguish 'not ready yet' from a real error" precedent
 * `GET /ai-runs/:id/score` already establishes (`ai-run-details.ts`). Only
 * the MOST RECENT measurement is returned when more than one exists for an
 * action (not expected in this build's own flow, which measures an action
 * once, but the schema does not forbid a future manual re-check).
 */
import { Hono } from 'hono';
import { withOrgContext } from '@bebest/database';
import { requireAuth } from '../middleware/auth.js';
import { authenticatedRateLimit } from '../middleware/rate-limit.js';
import { requireOrgFromToken } from '../middleware/tenant-context.js';
import { requirePermission } from '../middleware/rbac.js';
import { serializeMeasurement } from '../lib/measurement/serialize.js';
import type { AppEnv } from '../types/context.js';

const actionMeasurementRoute = new Hono<AppEnv>();

const VIEW = 'view_intelligence' as const;
const NOT_FOUND_ERROR = { error: 'Action not found' } as const;

// Same belt-and-suspenders scoping (`withOrgContext` RLS + explicit WHERE)
// every id-addressed route in this codebase uses — a foreign id 404s,
// never a 403 that would confirm it exists (tenant isolation).
actionMeasurementRoute.get('/:id/measurement', requireAuth, authenticatedRateLimit, requireOrgFromToken('viewer'), requirePermission(VIEW), async (c) => {
  const org = c.get('org');
  const actionId = c.req.param('id');

  const action = await withOrgContext(org.organizationId, (tx) =>
    tx.actions.findFirst({ where: { id: actionId, organization_id: org.organizationId, deleted_at: null } }),
  );
  if (!action) return c.json(NOT_FOUND_ERROR, 404);

  const measurement = await withOrgContext(org.organizationId, (tx) =>
    tx.measurements.findFirst({
      where: { action_id: action.id, organization_id: org.organizationId },
      orderBy: { measured_at: 'desc' },
    }),
  );

  if (!measurement) {
    return c.json({
      measured: false,
      action: {
        id: action.id,
        status: action.status,
        executedAt: action.executed_at,
        beforeScoreCapturedAt: action.before_score_captured_at,
      },
    });
  }

  return c.json({ measured: true, measurement: serializeMeasurement(measurement) });
});

export default actionMeasurementRoute;
