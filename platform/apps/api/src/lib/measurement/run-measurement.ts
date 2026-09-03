/**
 * Epic 14 (Measurement & Learning Loop) — the core orchestrator. Runs one
 * `actions` row's full RE-MEASURE -> LEARN sequence
 * (`docs/13-agents/AGENT_ARCHITECTURE.md`'s Measurement Agent, this epic's
 * spec, verbatim):
 *
 *   1. Load the action + its real recommendation/opportunity chain
 *      (Epic 9/10 — `opportunity_recommendations` -> `unified_opportunities`).
 *   2. Re-run Epic 7's real AI-visibility pipeline (`runAiVisibilityStep`,
 *      the SAME helper Epic 12's GEO/Growth agents already use — never a
 *      reimplementation) against the brand's active query set, if one
 *      exists, and Epic 4's real SEO checklist functions
 *      (`reanalyze-seo.ts`) against the brand's most recent crawl, if one
 *      exists. Either can legitimately be unavailable (no active query
 *      set, no crawl data, an entitlement limit) — that side's `after`
 *      component is `null`, never fabricated or backfilled from stale data.
 *   3. Compare against `before_score` — the IMMUTABLE snapshot captured at
 *      approval time (`actions.before_score`, see that column's own
 *      comment) — via `computeScoreDelta` (`scoring.ts`), a pure function.
 *   4. Estimate attribution via `estimateAttribution` (`attribution.ts`,
 *      pure) — the "did THIS action plausibly cause the change" language,
 *      never asserted as certainty.
 *   5. Write one `measurements` row (always, once an action has a
 *      before-score and is executed) and one `outcome_records` row
 *      (ONLY when the action's `recommendation_id` resolves through the
 *      real chain to a `unified_opportunities.type` — see below), then a
 *      `measurement.completed` audit event (`lib/audit.ts`'s
 *      `ALWAYS_AUDITED_ACTIONS` — the transparency principle every agent
 *      epic follows: an autonomous, system-triggered action must be
 *      observable).
 *
 * Called by `schedule-remeasurement.ts` (the 4-week background trigger) and
 * directly by tests — this function itself has no clock/timer logic of its
 * own, so a test never needs to wait for anything to call it.
 *
 * **Honest scope boundary — no `outcome_records` row without a real
 * recommendation chain.** A Level 1-3 agent-originated action
 * (`actions.agent_pending_action_id` set, `.recommendation_id` null — see
 * Epic 13's own handoff wiring) has no `opportunity_recommendations` row to
 * read an `action_type`/`opportunity_type` FROM. This epic's own explicit
 * instruction is that these two fields be "pulled from the real chain...
 * not guessed or hardcoded" — with no chain to pull from, fabricating a
 * pair would violate that instruction, so this function writes the
 * `measurements` row (the action's own before/after comparison is still
 * real and meaningful) but skips `outcome_records` entirely for that case,
 * rather than guessing. Documented again in this epic's backend doc.
 *
 * **Never throws for an EXPECTED failure mode** (no before-score yet, not
 * executed yet, no active query set, no crawl data, an entitlement limit) —
 * each is handled explicitly and either short-circuits with a `'skipped'`
 * result or leaves the relevant `after_score` component `null`. It CAN
 * throw on a genuine unexpected failure (e.g. the database write itself
 * failing) — `schedule-remeasurement.ts`'s own `.catch()` is the backstop
 * for that case, same "the scheduler catches what the pipeline itself
 * doesn't" split `lib/ai-visibility/schedule-run.ts` already uses for
 * `runAiVisibilityRun`.
 */
import { withOrgContext, type Prisma } from '@bebest/database';
import { runAiVisibilityStep } from '../agents/run-ai-visibility-step.js';
import { writeAuditEvent } from '../audit.js';
import { estimateAttribution } from './attribution.js';
import { toGeoScoreComponent } from './current-score-snapshot.js';
import { reanalyzeSeoForBrand } from './reanalyze-seo.js';
import { computeScoreDelta, type GeoScoreComponent, type ScoreSnapshot } from './scoring.js';

export type RunMeasurementResult =
  | { status: 'skipped'; reason: 'action_not_found' | 'not_executed' | 'no_before_score' }
  | {
      status: 'measured';
      measurementId: string;
      outcomeRecordId: string | null;
      scoreDelta: number | null;
      attributionConfidence: 'high' | 'medium' | 'low';
    };

export async function runMeasurementForAction(organizationId: string, actionId: string): Promise<RunMeasurementResult> {
  const action = await withOrgContext(organizationId, (tx) =>
    tx.actions.findFirst({
      where: { id: actionId, organization_id: organizationId, deleted_at: null },
      include: { opportunity_recommendations: { include: { unified_opportunities: true } } },
    }),
  );
  if (!action) return { status: 'skipped', reason: 'action_not_found' };
  if (!action.executed_at) return { status: 'skipped', reason: 'not_executed' };
  if (!action.before_score || !action.before_score_captured_at) return { status: 'skipped', reason: 'no_before_score' };

  const before = action.before_score as unknown as ScoreSnapshot;
  const executedAt = action.executed_at;

  // ── Re-run Epic 7's real pipeline (GEO), if the brand still has an
  // active query set — the SAME helper Epic 12's agents already use, never
  // a reimplementation. `action.approved_by` is the real human who
  // approved this action (guaranteed set — `chk_actions_execute_requires_
  // approval` makes an executed action without one physically impossible),
  // reused as the fresh run's `created_by` attribution, same "system
  // action attributed to the human decision that authorized it" precedent
  // `published_content.published_by` already sets from this exact column.
  const querySet = action.approved_by
    ? await withOrgContext(organizationId, (tx) =>
        tx.query_sets.findFirst({ where: { organization_id: organizationId, brand_id: action.brand_id, status: 'active', deleted_at: null } }),
      )
    : null;

  let geo: GeoScoreComponent | null = null;
  let afterAiRunId: string | null = null;
  if (querySet && action.approved_by) {
    const stepResult = await runAiVisibilityStep(organizationId, action.brand_id, querySet.id, action.approved_by);
    if ('aiRunId' in stepResult) {
      afterAiRunId = stepResult.aiRunId;
      const run = await withOrgContext(organizationId, (tx) => tx.ai_runs.findUniqueOrThrow({ where: { id: stepResult.aiRunId } }));
      geo = toGeoScoreComponent(run);
    }
    // Error variants (`no_human_trigger`/`query_set_empty`/`entitlement`)
    // leave `geo` null — no fresh GEO data this cycle, never a fabricated
    // or stale-fallback value. Observable via this function's own
    // `measurement.completed` audit event (`basis` will read 'seo' or
    // 'none' instead of 'geo').
  }

  // ── Re-run Epic 4's real checklist functions (SEO), if the brand has
  // crawl data — see reanalyze-seo.ts's own header comment for why this is
  // safe (reads already-crawled pages, triggers no new network call). ────
  const seo = await reanalyzeSeoForBrand(organizationId, action.brand_id);

  const after: ScoreSnapshot = { geo, seo, capturedAt: new Date().toISOString() };

  const { delta, basis, formulaVersionsMatch } = computeScoreDelta(before, after);

  // "did THIS action plausibly cause the change, or did something else
  // move" — this epic's own concrete, checkable proxy: any OTHER action on
  // the SAME brand executed between this one and now. See attribution.ts's
  // own doc comment for why this (not Epic 8's competitor-visibility feed)
  // is what this function itself checks.
  const otherActionsExecutedInWindow = await withOrgContext(organizationId, (tx) =>
    tx.actions.count({
      where: {
        organization_id: organizationId,
        brand_id: action.brand_id,
        id: { not: action.id },
        deleted_at: null,
        executed_at: { gte: executedAt, lte: new Date() },
      },
    }),
  );

  const { confidence, notes } = estimateAttribution({ delta, basis, formulaVersionsMatch, otherActionsExecutedInWindow });

  const measurement = await withOrgContext(organizationId, (tx) =>
    tx.measurements.create({
      data: {
        organization_id: organizationId,
        brand_id: action.brand_id,
        action_id: action.id,
        before_score: before as unknown as Prisma.InputJsonValue,
        before_score_captured_at: action.before_score_captured_at!,
        after_score: after as unknown as Prisma.InputJsonValue,
        after_ai_run_id: afterAiRunId,
        score_delta: delta,
        attribution_confidence: confidence,
        attribution_notes: notes,
      },
    }),
  );

  // ── LEARN: an outcome_records row, ONLY when the real chain resolves —
  // see this file's header comment for the honest "no chain, no guess"
  // scope boundary. ────────────────────────────────────────────────────
  let outcomeRecordId: string | null = null;
  const recommendation = action.opportunity_recommendations;
  if (recommendation) {
    const outcome = await withOrgContext(organizationId, (tx) =>
      tx.outcome_records.create({
        data: {
          organization_id: organizationId,
          measurement_id: measurement.id,
          opportunity_type: recommendation.unified_opportunities.type,
          action_type: recommendation.action_type,
          score_delta: delta,
        },
      }),
    );
    outcomeRecordId = outcome.id;
  }

  // The transparency principle every agent epic follows — this system-
  // triggered measurement is observable the same way a human-triggered
  // privileged action is (`lib/audit.ts`'s `ALWAYS_AUDITED_ACTIONS`).
  // `writeAuditEvent` never throws (see that function's own doc comment).
  await writeAuditEvent({
    userId: action.approved_by,
    organizationId,
    actorType: 'system',
    action: 'measurement.completed',
    entityType: 'measurement',
    entityId: measurement.id,
    result: 'success',
    details: { actionId: action.id, brandId: action.brand_id, basis, scoreDelta: delta, attributionConfidence: confidence },
  });

  return { status: 'measured', measurementId: measurement.id, outcomeRecordId, scoreDelta: delta, attributionConfidence: confidence };
}
