/**
 * Epic 14 (Measurement & Learning Loop) — the attribution ESTIMATE, per
 * `docs/13-agents/AGENT_ARCHITECTURE.md`'s Measurement Agent step 4, this
 * epic's spec verbatim: "did THIS action plausibly cause the change, or did
 * something else move (a competitor's own change, a query-universe
 * update)?" called an "attribution estimate," not certainty — this file is
 * the ONLY place that language gets decided, so every caller (the API
 * response, a future UI) inherits the same honest wording rather than each
 * inventing its own.
 *
 * Pure and deterministic — no database, no AI provider, no clock (the
 * caller resolves `otherActionsExecutedInWindow` from real data and passes
 * it in already-computed; see `run-measurement.ts`).
 *
 * Non-negotiable #4 this module exists to satisfy: "Attribution language
 * (API response text) must use estimate/confidence language, never assert
 * certainty." Every returned `notes` string is phrased as an estimate
 * ("plausible," "cannot rule out," "an estimate, not proof") — grep this
 * file for "proof"/"caused" before changing any string; a future edit that
 * makes any branch assert certainty is a spec violation, not a wording
 * preference.
 */

export type AttributionConfidence = 'high' | 'medium' | 'low';

export interface AttributionInput {
  /** From `computeScoreDelta` (`scoring.ts`) — `null`/`'none'` when no
   * comparable before/after pair existed at all. Note that `after_score`'s
   * GEO/SEO components (`run-measurement.ts`) are ONLY ever populated from
   * a genuinely fresh re-run — never a fallback read of stale, already-
   * known data — so whenever `basis` is `'geo'` or `'seo'` here, the AFTER
   * side is guaranteed fresh by construction; there is no separate "stale
   * fallback" case for this function to special-case. */
  delta: number | null;
  basis: 'geo' | 'seo' | 'none';
  /** `null` when `basis === 'none'`. */
  formulaVersionsMatch: boolean | null;
  /** Count of OTHER `actions` rows on the SAME brand whose `executed_at`
   * falls between this action's own `executed_at` and the measurement's
   * `measured_at` — this epic's own concrete, checkable proxy for "did
   * something else move" (the spec's own example, "a competitor's own
   * change, a query-universe update," is a FUTURE learning-system input via
   * Epic 8's competitor-visibility-changes feed, not something this
   * function consults directly — see this epic's backend doc). */
  otherActionsExecutedInWindow: number;
}

export interface AttributionResult {
  confidence: AttributionConfidence;
  notes: string;
}

/** Below this magnitude (0-100 scale, same scale every score component in
 * this codebase uses), a delta is treated as plausible measurement noise —
 * never confidently attributed to anything. */
const NOISE_DELTA_THRESHOLD = 3;
/** At or above this magnitude, with nothing else confounding the
 * comparison, a delta is large enough to call the estimate 'high'
 * confidence — still an estimate, never proof (see this file's header). */
const SIGNIFICANT_DELTA_THRESHOLD = 10;

function basisLabel(basis: 'geo' | 'seo'): string {
  return basis === 'geo' ? 'AI-visibility' : 'SEO';
}

export function estimateAttribution(input: AttributionInput): AttributionResult {
  const { delta, basis, formulaVersionsMatch, otherActionsExecutedInWindow } = input;

  if (delta === null || basis === 'none') {
    return {
      confidence: 'low',
      notes:
        'No comparable before/after score could be found for this brand, so no attribution estimate can be made here — this is not a claim that nothing changed, only that this measurement has nothing to compare.',
    };
  }

  const label = basisLabel(basis);
  const magnitude = Math.abs(delta);
  const direction = delta > 0 ? 'improved' : delta < 0 ? 'declined' : 'stayed flat';
  const movement = direction === 'stayed flat' ? 'stayed flat' : `${direction} by ${magnitude.toFixed(2)} points`;

  if (otherActionsExecutedInWindow > 0) {
    return {
      confidence: 'medium',
      notes: `The ${label} score ${movement}, but ${otherActionsExecutedInWindow} other action${otherActionsExecutedInWindow === 1 ? ' was' : 's were'} also executed on this brand in the same window — this estimate cannot rule out one of those being the real cause instead of, or alongside, this one.`,
    };
  }

  if (magnitude < NOISE_DELTA_THRESHOLD) {
    return {
      confidence: 'low',
      notes: `The ${label} score only ${movement} — small enough that this plausibly reflects normal measurement noise rather than a real effect of this action.`,
    };
  }

  if (formulaVersionsMatch === false) {
    return {
      confidence: 'medium',
      notes: `The ${label} score ${movement}, but the before/after scores were computed under different formula versions — some of that movement may reflect the formula change itself, not this action.`,
    };
  }

  if (magnitude >= SIGNIFICANT_DELTA_THRESHOLD) {
    return {
      confidence: 'high',
      notes: `The ${label} score ${movement}, with no other action executed on this brand in the same window and no formula change between measurements — this action is a plausible cause, though this remains an estimate, not proof of causation.`,
    };
  }

  return {
    confidence: 'medium',
    notes: `The ${label} score ${movement} — a plausible but modest effect; this is an estimate, not proof this specific action caused it.`,
  };
}
