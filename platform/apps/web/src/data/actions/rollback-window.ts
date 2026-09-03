/**
 * Client-side MIRROR of `apps/api/src/lib/actions/rollback-window.ts`'s
 * 30-day rollback window — used only to decide whether to show/enable the
 * "Roll back" button and what deadline to display. The REAL enforcement is
 * the server's own guard clause (`routes/action-details.ts`'s `POST
 * /:id/rollback`, `isWithinRollbackWindow`); a stale render or a
 * clock-skewed client that shows this button past the real deadline still
 * gets back a real 409 `rollback_window_expired` — this never substitutes
 * for that check, it only anticipates it so the common case doesn't need a
 * round trip to discover the button shouldn't be there. Same "measured from
 * `executed_at`, not `approved_at`" resolved ambiguity as the backend —
 * see that file's own header comment for the full reasoning.
 */

export const ROLLBACK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function rollbackDeadline(executedAt: string): Date {
  return new Date(new Date(executedAt).getTime() + ROLLBACK_WINDOW_MS);
}

export function isWithinRollbackWindow(executedAt: string, now: number = Date.now()): boolean {
  return now <= rollbackDeadline(executedAt).getTime();
}
