/**
 * Epic 12 — the SINGLE authority for what autonomy level an agent run may
 * actually execute at. `docs/13-agents/AGENT_ARCHITECTURE.md` is explicit:
 * "Level 4 is NOT available in Phase 1–6. It is designed for Phase 10," and
 * describes Level 4 as gated behind "an explicit `AUTONOMOUS_MODE=true`
 * setting per organization." This epic's own hard requirement goes further
 * than "don't build the UI for it": **Level 4 must be hard-blocked at the
 * code level under every input combination** — a config value, an env var,
 * a plan tier, or a request body can never make a run actually execute at
 * level 4.
 *
 * The design that makes this true, not just documented:
 *
 * 1. `assertAutonomyLevelAllowed` is the ONLY function in this codebase that
 *    is allowed to produce a validated `AutonomyLevel` from an arbitrary
 *    number. Every path that could otherwise originate a level — the
 *    trigger route's request body, a plan's `autonomy_level_max`, a future
 *    schedule config — MUST funnel through this function before that number
 *    is used for anything. `runner.ts` is the only caller.
 * 2. It reads NO environment variable and NO organization setting itself.
 *    There is no `AUTONOMOUS_MODE` check anywhere in this file (or anywhere
 *    else in this epic's code) — the function's only input is the plain
 *    number it's asked to validate, so setting `AUTONOMOUS_MODE=true`
 *    (org-wide or process-wide) has LITERALLY ZERO effect on what this
 *    function returns. This is deliberate: AGENT_ARCHITECTURE.md names that
 *    flag as Level 4's own gate, so the guard against Level 4 must not
 *    itself consult it — a guard that reads the very flag it's supposed to
 *    override could be satisfied by setting that flag, which is exactly the
 *    "half-wired feature" this epic's brief forbids.
 * 3. It REJECTS (throws), it does not CLAMP. A caller that requests level 4
 *    gets `AutonomyLevelRejectedError`, never a silently-downgraded level 3
 *    — a clamp would make level 4 "work, just capped," which is
 *    observationally indistinguishable from a partially-implemented level 4
 *    to a caller probing for it. A hard rejection is the only response that
 *    is unambiguously "this does not exist."
 * 4. The `AutonomyLevel` TYPE itself (`types.ts`) only contains `1 | 2 | 3`
 *    — this is a SECOND, independent layer (a compile-time one) on top of
 *    this runtime guard, not a replacement for it. This function's own
 *    parameter is typed as a plain `number` specifically so a hostile
 *    runtime value (parsed from JSON, `NaN`, `Infinity`, a negative number,
 *    a non-integer) cannot bypass the check merely by being handed to a
 *    function whose signature already claims to only accept `1 | 2 | 3` —
 *    TypeScript's type system has no runtime effect, so the check inside
 *    this function is what actually does the work.
 *
 * See `autonomy.test.ts` for the exhaustive-input-combination proof this
 * epic's DoD requires.
 */
import type { AutonomyLevel } from './types.js';

export const MAX_AUTONOMY_LEVEL = 3;
export const MIN_AUTONOMY_LEVEL = 1;

export class AutonomyLevelRejectedError extends Error {
  constructor(
    public readonly requested: unknown,
    public readonly reason: string,
  ) {
    super(
      `Autonomy level ${JSON.stringify(requested)} is not permitted (${reason}). ` +
        `Level 4 ("Autonomous, within guardrails") is not available in this build — ` +
        `docs/13-agents/AGENT_ARCHITECTURE.md: "designed for Phase 10." The maximum ` +
        `supported level is ${MAX_AUTONOMY_LEVEL}.`,
    );
    this.name = 'AutonomyLevelRejectedError';
  }
}

/**
 * The hard block. `requested` is deliberately typed `unknown` (not
 * `number`) — this function is the FIRST thing any external input touches,
 * so it must not trust the caller to have already coerced/validated the
 * shape. Every non-1/2/3 value — 4, 5, 100, 0, -1, 3.5, NaN, Infinity,
 * `"4"`, `null`, `undefined`, an object — is rejected the same way, via the
 * same code path, with no special case for 4 that a slightly different
 * malformed value could slip past.
 */
export function assertAutonomyLevelAllowed(requested: unknown): AutonomyLevel {
  if (typeof requested !== 'number' || !Number.isInteger(requested)) {
    throw new AutonomyLevelRejectedError(requested, 'not an integer');
  }
  if (requested < MIN_AUTONOMY_LEVEL || requested > MAX_AUTONOMY_LEVEL) {
    throw new AutonomyLevelRejectedError(requested, `outside the allowed range ${MIN_AUTONOMY_LEVEL}-${MAX_AUTONOMY_LEVEL}`);
  }
  return requested as AutonomyLevel;
}

/**
 * The entry point `routes/agents.ts` actually calls. Combines the caller's
 * requested level with the org's plan-level cap
 * (`entitlements.ts`'s `autonomy_level_max` — `null` meaning "no
 * plan-specific cap," NEVER "unlimited up to and including 4": see the
 * defense-in-depth note below) and returns a level that has passed BOTH
 * checks, or throws.
 *
 * **Why a corrupted/misconfigured `planAutonomyLevelMax` still can't reach
 * level 4.** This function does not special-case the plan value at all — it
 * unconditionally runs `assertAutonomyLevelAllowed(requested)` FIRST,
 * before the plan cap is even consulted. So even if a future bug (or a
 * hand-edited database row) somehow set a plan's `autonomy_level_max` to 4,
 * 10, or any other out-of-range number, a request for level 4 is still
 * independently rejected by the same unconditional check every other
 * request goes through — the plan value can only ever LOWER the effective
 * ceiling below `MAX_AUTONOMY_LEVEL`, never raise it. This is exactly the
 * "hard-coded rejection, not just an unset config flag" property this
 * epic's DoD requires.
 */
export function resolveRequestedAutonomyLevel(
  requested: unknown,
  planAutonomyLevelMax: number | null,
): AutonomyLevel {
  const level = assertAutonomyLevelAllowed(requested ?? MIN_AUTONOMY_LEVEL);

  // `null` means "this plan documents no level-specific cap of its own" —
  // per `plan-catalog.ts`'s own convention (see e.g. the `growth` tier:
  // `agents: true, autonomyLevel_max: null`), NOT "any level including 4."
  // The `assertAutonomyLevelAllowed` call above already enforces the true
  // ceiling regardless of this value.
  if (planAutonomyLevelMax !== null && level > planAutonomyLevelMax) {
    throw new AutonomyLevelRejectedError(level, `exceeds this plan's autonomy_level_max (${planAutonomyLevelMax})`);
  }

  return level;
}
