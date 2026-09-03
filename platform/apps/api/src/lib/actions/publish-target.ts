/**
 * `PublishTarget` — the abstraction Epic 13's spec calls for verbatim:
 * "actually pushing to a customer's external CMS is explicitly out of scope
 * for this build (no real external CMS integration exists yet; document
 * this as the honest boundary, matching every other epic's NullXProvider
 * pattern — a `PublishTarget` interface with an internal-record-only
 * default implementation)."
 *
 * Deliberately mirrors `lib/billing/payment-provider.ts`'s
 * `PaymentProvider`/`NullPaymentProvider` shape as closely as possible —
 * same discipline that file's own header comment describes borrowing from
 * `lib/seo/seo-data-provider.ts` before it. Routes call `getPublishTarget()`
 * (bottom of this file), never `new NullPublishTarget()` directly, so
 * wiring in a real CMS adapter later (`class WordPressPublishTarget
 * implements PublishTarget`, or similar) is a one-function change.
 *
 * **Why a single factory function, not a full registry class**
 * (`packages/ai-provider/src/registry.ts`): same reasoning
 * `payment-provider.ts`/`seo-data-provider.ts` both give — this epic ships
 * exactly ONE real implementation (`NullPublishTarget`); there is no
 * routing table to encode yet.
 *
 * **Scope boundary** (epic spec, verbatim, see this file's header above):
 * `NullPublishTarget` makes zero network calls and never returns anything
 * that looks like a real external URL — `destinationRef` is always an
 * `internal://` locator, so no caller can mistake this for a real CMS
 * integration having quietly happened.
 */

export interface PublishInput {
  /** The `actions.id` this publish is executing on behalf of. */
  actionId: string;
  organizationId: string;
  brandId: string;
  /** What to publish — from `content_drafts` when the action originated
   * from one; a plain title/no body for a Level 1-3 agent-originated
   * action with no draft (see routes/action-details.ts). */
  title: string;
  body: string | null;
}

export interface PublishResult {
  /** Where the content now "lives," per this target's own bookkeeping.
   * `NullPublishTarget` always returns an `internal://` locator — never a
   * real external URL (this file's own scope-boundary comment). */
  destinationRef: string;
  /** The raw, target-specific result payload — stored verbatim on
   * `published_content.result`, never discarded (same "keep the evidence"
   * reasoning `content_quality_checks.details` already uses elsewhere in
   * this codebase). */
  result: Record<string, unknown>;
}

export interface PublishTarget {
  readonly name: string;

  publish(input: PublishInput): Promise<PublishResult>;

  /** Best-effort "undo" at the target itself, called by `POST
   * /actions/:id/rollback` AFTER `published_content.status` has already
   * been flipped to `rolled_back` (that DB write, not this call, is the
   * actual source of truth this epic's rollback guarantee rests on — same
   * "the real record is the caller's own table row" reasoning
   * `NullPaymentProvider.cancelSubscription`'s own doc comment gives for
   * why IT is a no-op too). Never throws: a target-side rollback failure
   * must not make the already-recorded rollback appear to have failed. */
  rollback(destinationRef: string): Promise<void>;
}

/**
 * The always-available, no-network default. Never calls out to any real
 * CMS/publishing network — every method is a pure/local computation, same
 * "deterministic, testable now" contract `NullPaymentProvider` already
 * establishes for billing.
 */
export class NullPublishTarget implements PublishTarget {
  readonly name = 'internal_record';

  async publish(input: PublishInput): Promise<PublishResult> {
    return {
      destinationRef: `internal://published-content/${input.actionId}`,
      result: {
        publishedVia: this.name,
        actionId: input.actionId,
        organizationId: input.organizationId,
        brandId: input.brandId,
        title: input.title,
        publishedAt: new Date().toISOString(),
      },
    };
  }

  /** No-op — see this file's `PublishTarget.rollback` doc comment for why:
   * this provider holds no external state of its own to undo. */
  async rollback(_destinationRef: string): Promise<void> {
    // Intentionally empty.
  }
}

let cachedTarget: PublishTarget | undefined;

/** The one function route code should call — never `new NullPublishTarget()`
 * directly. Returns a process-lifetime singleton (the null target is
 * stateless, so there is nothing gained by constructing a fresh one per
 * request) — same precedent `getPaymentProvider()` already sets. */
export function getPublishTarget(): PublishTarget {
  if (!cachedTarget) cachedTarget = new NullPublishTarget();
  return cachedTarget;
}

/** Test-only hook: lets a test inject a different `PublishTarget` (e.g. a
 * spy wrapping `NullPublishTarget`, or one that throws) instead of the
 * process-wide singleton. Never called from application code. Mirrors
 * `payment-provider.ts`'s `__setPaymentProviderForTesting` naming/shape. */
export function __setPublishTargetForTesting(target: PublishTarget | undefined): void {
  cachedTarget = target;
}
