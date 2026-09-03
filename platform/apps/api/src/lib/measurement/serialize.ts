/**
 * Epic 14 (Measurement & Learning Loop) response shape — shared by
 * `routes/measurements.ts` (`GET /brands/me/measurements`) and
 * `routes/action-measurement.ts` (`GET /actions/:id/measurement`), same
 * "one serializer, identical shape regardless of which route returned it"
 * precedent `lib/ai-visibility/serialize.ts` already establishes.
 */
import type { measurements } from '@bebest/database';

export function serializeMeasurement(row: measurements) {
  return {
    id: row.id,
    actionId: row.action_id,
    brandId: row.brand_id,
    beforeScore: row.before_score,
    beforeScoreCapturedAt: row.before_score_captured_at,
    afterScore: row.after_score,
    afterAiRunId: row.after_ai_run_id,
    scoreDelta: row.score_delta === null ? null : Number(row.score_delta),
    // Never presented as more certain than it is (this epic's non-
    // negotiable #4) — `attributionConfidence` is always paired with
    // `attributionNotes`' plain-language estimate/confidence wording, never
    // rendered alone as if it were a verdict.
    attributionConfidence: row.attribution_confidence,
    attributionNotes: row.attribution_notes,
    measuredAt: row.measured_at,
    createdAt: row.created_at,
  };
}
