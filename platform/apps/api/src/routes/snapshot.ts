import { Hono } from 'hono';
import { z } from 'zod';
import { db, withOrgContext } from '@bebest/database';
import { generateOpaqueToken, hashToken } from '../lib/tokens.js';
import { isSafePublicHttpUrl } from '../lib/ssrf-guard.js';
import { getInternalOrgId } from '../lib/internal-org.js';
import { freeSnapshotRateLimit } from '../middleware/rate-limit.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import { clientIp } from '../lib/client-ip.js';
import { runFreeSnapshotPipeline, type FreeSnapshotInput } from '../lib/free-snapshot/orchestrator.js';
import { getDefaultJobQueue } from '../lib/queue/default-job-queue.js';
import type { EmailSender } from '../lib/email.js';
import type { AppEnv } from '../types/context.js';

interface FreeSnapshotJobPayload {
  snapshotRequestId: string;
  token: string;
  input: FreeSnapshotInput;
}

const FREE_SNAPSHOT_JOB_TYPE = 'free_snapshot_pipeline';

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// docs/epics/17-free-snapshot.md step 1's literal field list: name, work
// email, company name, website URL, industry/category (optional), biggest
// competitor (optional). `website` reuses the SAME `isSafePublicHttpUrl`
// write-boundary check `routes/leads.ts`'s `urlField()` applies — this
// value is ALSO fetched server-side (the free-tier crawl), so
// `lib/free-snapshot/crawl.ts`'s `safeFetch` re-validates it again at
// request time regardless (defense in depth, never a substitute for the
// real DNS-resolving guard).
const snapshotRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().email(),
  company: z.string().trim().min(1).max(255),
  website: z
    .string()
    .url()
    .max(2048)
    .refine(isSafePublicHttpUrl, { message: 'Must be a public http(s) URL' }),
  category: z.string().trim().max(100).optional(),
  biggestCompetitor: z.string().trim().max(255).optional(),
  marketingConsent: z.boolean().optional(),
});

const CONFIRMATION_MESSAGE = "Your snapshot is being prepared. We'll email you within 24 hours.";

export function createSnapshotRoutes(emailSender: EmailSender) {
  const snapshot = new Hono<AppEnv>();

  // Epic 19 (Production Hardening), item 1 — registered once per
  // `createSnapshotRoutes` call (this factory has exactly one call site,
  // `app.ts`, so this runs once per process) rather than a raw
  // `setImmediate` call. See `lib/queue/job-queue.ts`'s header comment for
  // the full design; behaviorally unchanged in this build (default queue
  // is `InMemoryJobQueue`, still fires via `setImmediate` under the hood).
  getDefaultJobQueue().register<FreeSnapshotJobPayload>(FREE_SNAPSHOT_JOB_TYPE, async ({ snapshotRequestId, token, input }) => {
    await runFreeSnapshotPipeline(snapshotRequestId, token, input, { emailSender }).catch((err: unknown) => {
      // runFreeSnapshotPipeline already catches everything internally and
      // marks the row `failed` — this is a final backstop in case
      // something outside that try/catch (e.g. a synchronous throw before
      // its own try block) escapes.
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'free_snapshot_pipeline_uncaught',
          snapshotRequestId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
  });

  // ── POST /snapshot — public, unauthenticated, rate-limited ──────────────
  // Order matches docs/epics/17-free-snapshot.md's explicit "IN THIS ORDER"
  // instruction: (1) rate limit (Hono middleware runs before the handler
  // body below ever executes — a rejected request never reaches step 2),
  // (2) create the `leads` row before ANYTHING else (crawl/queries/AI/SEO)
  // runs, (3)-(4) create the tokenized `snapshot_requests` row and schedule
  // the orchestrated pipeline in the background, (5) respond immediately
  // with the confirmation copy — the spec's literal text.
  snapshot.post('/', freeSnapshotRateLimit, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = snapshotRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
    }

    const { name, email, company, website, category, biggestCompetitor, marketingConsent } = parsed.data;
    const internalOrgId = getInternalOrgId();

    // Step 2a — the `leads` row, created FIRST. A failure in every step
    // after this one (token generation, the snapshot_requests row, the
    // pipeline itself) must never un-create it — see
    // docs/epics/17-free-snapshot.md's end-to-end flow step 1.
    const lead = await withOrgContext(internalOrgId, (tx) =>
      tx.leads.create({
        data: {
          organization_id: internalOrgId,
          email,
          name,
          company,
          website,
          category: category ?? null,
          // The intake form's optional "biggest competitor" field has no
          // dedicated `leads` column (Epic 1's schema, unmodified by this
          // epic) — preserved as a CRM note rather than silently dropped.
          notes: biggestCompetitor ? `Biggest competitor (self-reported): ${biggestCompetitor}` : null,
          source: 'free_snapshot',
        },
      }),
    );

    // The public report token — generated once, only its hash persisted
    // (packages/database/DECISIONS.md §22), same
    // generate-once/hash-at-rest/hand-the-raw-value-back-once pattern
    // `routes/auth.ts`'s magic link already establishes via this same
    // `lib/tokens.ts` helper.
    const { token, hash } = generateOpaqueToken(32);

    const snapshotRequest = await db.snapshot_requests.create({
      data: {
        domain: domainOf(website),
        email,
        token_hash: hash,
        ip_address: clientIp(c),
        marketing_consent: marketingConsent ?? false,
      },
    });

    await withOrgContext(internalOrgId, (tx) =>
      tx.leads.update({ where: { id: lead.id }, data: { snapshot_id: snapshotRequest.id } }),
    );

    await writeManualAuditEvent(c, {
      action: 'snapshot.created',
      entityType: 'snapshot_request',
      entityId: snapshotRequest.id,
      actorType: 'system',
    });

    const pipelineInput: FreeSnapshotInput = { name, email, company, website, category, biggestCompetitor };

    // Steps 2b-2f + step 4 (the "ready" email) — see
    // lib/free-snapshot/orchestrator.ts. Scheduled via `JobQueue` (see the
    // registration above), same "create the row synchronously, run the
    // real work in the background" shape as routes/crawl.ts/routes/
    // ai-runs.ts.
    void getDefaultJobQueue().enqueue<FreeSnapshotJobPayload>(FREE_SNAPSHOT_JOB_TYPE, {
      snapshotRequestId: snapshotRequest.id,
      token,
      input: pipelineInput,
    });

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    return c.json(
      {
        message: CONFIRMATION_MESSAGE,
        token,
        reportUrl: `${appUrl}/snapshot/${token}`,
      },
      202,
    );
  });

  // ── GET /snapshot/:token — public, tokenized. Never the lead's or
  // snapshot_requests' real database id (docs/epics/17-free-snapshot.md's
  // explicit "don't leak enumerable IDs on a public endpoint" instruction)
  // — the path param is re-hashed and looked up by `token_hash`, exactly
  // mirroring `routes/auth.ts`'s magic-link verify. ─────────────────────
  snapshot.get('/:token', async (c) => {
    const token = c.req.param('token');
    const row = await db.snapshot_requests.findUnique({ where: { token_hash: hashToken(token) } });
    if (!row) return c.json({ error: 'Not found' }, 404);

    if (row.status === 'pending' || row.status === 'processing') {
      return c.json({ status: row.status, message: 'Your snapshot is still being prepared. Check back soon.' });
    }

    if (row.status === 'failed') {
      // Deliberately no internal error detail here — this is a public,
      // unauthenticated response; `result_json.error` (set by
      // `orchestrator.ts`'s `markFailed`) stays server-side only.
      return c.json({
        status: 'failed',
        message: 'We hit a problem preparing this snapshot. Please try submitting the form again.',
      });
    }

    return c.json({ status: 'complete', report: row.result_json });
  });

  return snapshot;
}

export default createSnapshotRoutes;
