/**
 * Epic 17 (Free AI + SEO Growth Snapshot) — THE ORCHESTRATOR
 * (`docs/epics/17-free-snapshot.md`'s explicit instruction: "build this as
 * an explicit orchestrator, not an ad hoc chain of fire-and-forget calls").
 *
 * `runFreeSnapshotPipeline` is the ONE function that runs steps 2b-2f of
 * the epic's flow, in order, against a `snapshot_requests` row that
 * `routes/snapshot.ts` already created (step 2a — the `leads` row and this
 * row are both written by the ROUTE, synchronously, before this function is
 * ever scheduled — see that file for why). It is invoked the same
 * `JobQueue`-after-the-DB-row-exists way `routes/crawl.ts` schedules
 * `runCrawlJob` and `routes/ai-runs.ts` schedules `runAiVisibilityRun` (see
 * `lib/queue/job-queue.ts`) — the default `InMemoryJobQueue` still runs the
 * background step in-process, functionally equivalent to the raw
 * `setImmediate` this epic (19, Production Hardening) replaced it with.
 *
 * Every sub-step below is FREE-TIER-SCOPED, never the paid-tier pipeline:
 * `maxPages`/`maxQueries` default to `PLAN_CATALOG.free.limits`
 * (`pages_analyzed`/`queries_per_query_set` — the exact same numbers a real
 * `free` plan subscriber's entitlements resolve to, see
 * `lib/entitlements.ts`) rather than any hardcoded literal invented for
 * this epic, and are threaded through as explicit parameters to
 * `crawlFreeSnapshotSite`/`generateQueryUniverse` — never a module-level
 * default those functions apply silently — specifically so a test can
 * assert each sub-pipeline call received the free-tier number, not the
 * paid-tier one (this epic's DoD).
 */
import { db, type Prisma } from '@bebest/database';
import { ConsoleEmailSender, type EmailSender } from '../email.js';
import { PLAN_CATALOG } from '../billing/plan-catalog.js';
import { generateQueryUniverse, type QueryGeneratorBrandProfile } from '../query-generator.js';
import { crawlFreeSnapshotSite, type FreeSnapshotCrawlDeps } from './crawl.js';
import { runFreeSnapshotAiQueries, type FreeSnapshotAiRunDeps } from './ai-run.js';
import { analyzeFreeSnapshotSeo } from './seo-analysis.js';
import { buildFreeSnapshotReport, type FreeSnapshotReport } from './report.js';

// Defensive fallbacks only — `PLAN_CATALOG.free.limits.pages_analyzed`/
// `queries_per_query_set` are real, non-null numbers today (10 and 50; see
// `lib/billing/plan-catalog.ts`'s header comment on why they can never
// silently disagree with what a freshly-seeded `plans` row would answer).
// `PlanLimits`'s TYPE still declares every numeric field `number | null`
// (unlimited on some other tier), so TypeScript requires a fallback here
// even though `free` never actually takes it.
const DEFAULT_FREE_MAX_PAGES = 10;
const DEFAULT_FREE_MAX_QUERIES = 50;

export interface FreeSnapshotInput {
  name: string;
  email: string;
  company: string;
  /** Already validated as a safe, public http(s) URL by the route (the
   * SAME `isSafePublicHttpUrl` refinement `routes/leads.ts` uses) — this
   * function trusts its caller, `safeFetch` re-validates at request time
   * regardless (belt-and-suspenders, same as every other SSRF-guarded
   * caller in this codebase). */
  website: string;
  category?: string;
  biggestCompetitor?: string;
}

export interface FreeSnapshotOrchestratorDeps {
  crawlDeps?: FreeSnapshotCrawlDeps;
  aiRunDeps?: FreeSnapshotAiRunDeps;
  emailSender?: EmailSender;
  /** Free-tier page cap override — tests only. Production always uses
   * `PLAN_CATALOG.free.limits.pages_analyzed`. */
  maxPages?: number;
  /** Free-tier query cap override — tests only. Production always uses
   * `PLAN_CATALOG.free.limits.queries_per_query_set`. */
  maxQueries?: number;
  /** Overrides `process.env.APP_URL` for building the emailed report link —
   * tests only. */
  reportBaseUrl?: string;
}

function buildBrandProfile(input: FreeSnapshotInput): QueryGeneratorBrandProfile {
  return {
    name: input.company,
    // The intake form's "industry/category" field is explicitly optional
    // (docs/epics/17-free-snapshot.md step 1) — when omitted, the company
    // name itself is the only certain subject to generate a query about
    // ("What is {company}?"), so it is used as the sole fallback category
    // rather than fabricating an unrelated one. Documented simplification:
    // with only name/company/website/category/competitor collected (no
    // Epic 2 use_cases/differentiators/markets), the realistic candidate
    // count from `generateCandidateQueries` is well under the free tier's
    // 50-query cap for a sparse profile — the cap here is an upper bound,
    // not a guarantee every free snapshot reaches 20-50 queries.
    categories: input.category ? [input.category] : [input.company],
    differentiators: [],
    markets: [],
    useCases: [],
    competitors: input.biggestCompetitor ? [{ name: input.biggestCompetitor }] : [],
  };
}

async function markFailed(snapshotRequestId: string, message: string): Promise<void> {
  await db.snapshot_requests
    .update({
      where: { id: snapshotRequestId },
      data: { status: 'failed', result_json: { error: message } as unknown as Prisma.InputJsonValue },
    })
    .catch((err: unknown) => {
      // Best-effort — if even this write fails, the row is left in
      // whatever state it last successfully reached (same
      // "documented, not solved here" posture as engine.ts/pipeline.ts's
      // own background-job error handling).
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'free_snapshot_mark_failed_write_failed',
          snapshotRequestId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
}

/**
 * Runs steps 2b-2f of the free-snapshot flow to completion (or failure)
 * against an ALREADY-CREATED `snapshot_requests` row, then attempts step 4
 * (the "your snapshot is ready" email). Never throws — every failure mode
 * is caught and turned into `status: 'failed'` on the row, so the caller
 * (the `JobQueue`-registered handler in routes/snapshot.ts) can
 * fire-and-forget this the same way `routes/crawl.ts`/`routes/ai-runs.ts`
 * do for their own background steps.
 *
 * `rawToken` is the UNHASHED report token the route generated when it
 * created the row (only its SHA-256 hash — `token_hash` — was persisted,
 * per `packages/database/DECISIONS.md` §22's "hash at rest, hand the raw
 * value to the caller once" rule) — passed through in-memory from the
 * route's closure specifically so this function can build the emailed
 * report link without ever re-deriving or re-persisting the plaintext
 * token.
 */
export async function runFreeSnapshotPipeline(
  snapshotRequestId: string,
  rawToken: string,
  input: FreeSnapshotInput,
  deps: FreeSnapshotOrchestratorDeps = {},
): Promise<void> {
  const maxPages = deps.maxPages ?? PLAN_CATALOG.free.limits.pages_analyzed ?? DEFAULT_FREE_MAX_PAGES;
  const maxQueries = deps.maxQueries ?? PLAN_CATALOG.free.limits.queries_per_query_set ?? DEFAULT_FREE_MAX_QUERIES;

  try {
    await db.snapshot_requests.update({ where: { id: snapshotRequestId }, data: { status: 'processing' } });

    // 2b — free-tier-scoped crawl (Epic 3's safeFetch/SSRF guard, capped at
    // `maxPages`, never Epic 3's own 500-page MAX_PAGES).
    const crawlResult = await crawlFreeSnapshotSite(input.website, maxPages, deps.crawlDeps);

    // 2c — free-tier-scoped sample query set (Epic 5's generator, capped at
    // `maxQueries`, never a paid tier's `queries_per_query_set`).
    const brandProfile = buildBrandProfile(input);
    const queries = generateQueryUniverse(brandProfile, maxQueries);

    // 2d — free-tier-scoped AI run, all 4 cloud providers (Epic 7's "same
    // all-4-providers rule").
    const aiRunResult = await runFreeSnapshotAiQueries(input.company, queries, deps.aiRunDeps);

    // 2e — basic SEO analysis (Epic 4's exact scoring functions) against the
    // pages this run actually crawled.
    const seoResult = analyzeFreeSnapshotSeo(crawlResult);

    // 2f — the lightweight report (see report.ts's own header for exactly
    // what is, and is not, reused from Epic 9/10).
    const report: FreeSnapshotReport = buildFreeSnapshotReport(
      {
        name: input.name,
        company: input.company,
        website: input.website,
        category: input.category ?? null,
        biggestCompetitor: input.biggestCompetitor ?? null,
      },
      seoResult,
      aiRunResult,
    );

    await db.snapshot_requests.update({
      where: { id: snapshotRequestId },
      data: { status: 'complete', result_json: report as unknown as Prisma.InputJsonValue },
    });

    // Step 4 — "send an email with a link to the web report." Attempted,
    // never required for the pipeline itself to be considered done (the
    // report is already retrievable via GET /snapshot/:token at this
    // point) — same "audit/notify best-effort, never blocks the write it's
    // reporting on" posture as `lib/audit.ts`.
    const emailSender = deps.emailSender ?? new ConsoleEmailSender();
    const appUrl = deps.reportBaseUrl ?? process.env.APP_URL ?? 'http://localhost:3000';
    const reportUrl = `${appUrl}/snapshot/${rawToken}`;
    await emailSender.sendSnapshotReady({ to: input.email, reportUrl }).catch((err: unknown) => {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'free_snapshot_email_send_failed',
          snapshotRequestId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  } catch (err) {
    await markFailed(snapshotRequestId, err instanceof Error ? err.message : String(err));
  }
}
