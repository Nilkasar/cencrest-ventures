import { Hono } from 'hono';
import { z } from 'zod';
import { withOrgContext } from '@bebest/database';
import { getInternalOrgId } from '../lib/internal-org.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { writeManualAuditEvent } from '../middleware/audit-log.js';
import type { AppEnv } from '../types/context.js';

// docs/epics/20-marketing-site-rebuild.md's "New backend surface: POST
// /api/apply" — a genuinely sales-intent lead (root site's `#apply` /
// `contact.html`), deliberately NOT the free-snapshot flow
// (routes/snapshot.ts): no `website` field, no crawl, no AI provider call,
// no email pipeline. Modeled on `createLeadSchema` in routes/leads.ts minus
// everything gated behind `requireAuth`/`requireCrmAccess` — this route is
// public and unauthenticated by design, same "top-of-funnel, no login"
// shape as `POST /snapshot`.
const applyRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  email: z.string().trim().email().max(255),
  company: z.string().trim().min(1).max(255),
  category: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(5000).optional(),
  // Honeypot: a hidden input real visitors never see or fill; only a bot
  // filling every field in the DOM populates this. Never persisted, never
  // reflected in the response. A non-empty value silently drops the
  // submission behind the SAME 201 confirmation copy a real submission
  // gets, so a bot cannot distinguish "spam-filtered" from "accepted" (spec
  // §"CSRF/spam"). Field name is intentionally unrelated to `website` — the
  // real snapshot flow's website field must never be confused with this
  // decoy.
  hp_field: z.string().max(500).optional(),
});

const CONFIRMATION_MESSAGE = 'Request received. The BeBest team will be in touch within 24 hours.';

// Own bucket, not `freeSnapshotRateLimit` (calibrated for a route that fires
// a real crawl + AI-provider calls — this route does neither) and not left
// on the blanket `publicRateLimit` alone (30/min is too loose for a
// lead-capture form a bot could use to spam the CRM). Matches
// docs/epics/20-marketing-site-rebuild.md's literal spec exactly.
export const applyFormRateLimit = rateLimit({
  bucket: 'apply_form',
  max: 5,
  windowSeconds: 60 * 60,
});

const apply = new Hono<AppEnv>();

// POST /api/apply — public, unauthenticated, rate-limited. Rate limit runs
// as route middleware (before the handler body), same ordering discipline
// `freeSnapshotRateLimit` uses in routes/snapshot.ts.
apply.post('/', applyFormRateLimit, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = applyRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues }, 422);
  }

  const { name, email, company, category, notes, hp_field: honeypot } = parsed.data;

  // Honeypot tripped: pretend to succeed, write nothing.
  if (honeypot) {
    return c.json({ message: CONFIRMATION_MESSAGE }, 201);
  }

  const internalOrgId = getInternalOrgId();

  const lead = await withOrgContext(internalOrgId, (tx) =>
    tx.leads.create({
      data: {
        organization_id: internalOrgId,
        email,
        name,
        company,
        category: category ?? null,
        notes: notes ?? null,
        source: 'apply_form',
      },
    }),
  );

  // Not one of SECURITY.md's ALWAYS_AUDITED_ACTIONS (a public lead write
  // isn't a privileged action in that sense), but the same lightweight
  // system-actor observability trail `routes/snapshot.ts` writes for its
  // own public, unauthenticated create (`snapshot.created`) — useful to
  // trace CRM lead provenance without inflating this into a privileged
  // action.
  await writeManualAuditEvent(c, {
    action: 'lead.created',
    entityType: 'lead',
    entityId: lead.id,
    actorType: 'system',
  });

  return c.json({ message: CONFIRMATION_MESSAGE }, 201);
});

export default apply;
