/**
 * The 30-day rollback window (`docs/13-agents/AGENT_ARCHITECTURE.md`:
 * "Rollback available for 30 days") as a real, tested, pure function of
 * time — not a comment or a UI-only check.
 *
 * **Resolved ambiguity: measured from `executed_at`, not `approved_at`.**
 * Neither AGENT_ARCHITECTURE.md nor SCHEMA.md's `actions` DDL says which
 * timestamp the window starts from; this epic's own task brief names both
 * candidates ("compare against `approved_at` or `executed_at` per the
 * spec"). `executed_at` was chosen because rollback reverts
 * `published_content` — the artifact created AT execution, not at
 * approval — and the spec's own lifecycle allows `approved_at` and
 * `executed_at` to drift apart ("a human might approve now and the system
 * executes async"): measuring from `approved_at` could silently hand a
 * customer LESS than the full 30 days they were promised, which is the
 * more customer-hostile of the two readings. Full reasoning:
 * `@bebest/database` DECISIONS.md §27.
 *
 * Deliberately NOT persisted as a second `rollback_until` column on
 * `actions` (unlike `agent_pending_actions.rollback_until`, Epic 12) — a
 * pure function of `executed_at` + a constant can never drift from the
 * timestamp it is derived from, so there is nothing a second column would
 * buy here that isn't itself a bug risk.
 */

export const ROLLBACK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The exact instant rollback stops being allowed for an action executed at
 * `executedAt`. Exclusive semantics live in `isWithinRollbackWindow` below,
 * not here — this is pure arithmetic. */
export function rollbackDeadline(executedAt: Date): Date {
  return new Date(executedAt.getTime() + ROLLBACK_WINDOW_MS);
}

/**
 * True up to and including the exact deadline instant (`now <= deadline`) —
 * a rollback attempted at precisely `executedAt + 30d` still succeeds; one
 * attempted even one millisecond later does not. `now` defaults to the real
 * clock but is always passed explicitly in tests, so the 30-day boundary
 * itself (not "whatever today happens to be") is what gets exercised.
 */
export function isWithinRollbackWindow(executedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() <= rollbackDeadline(executedAt).getTime();
}
