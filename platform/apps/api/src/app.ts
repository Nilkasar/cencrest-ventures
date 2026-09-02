import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/logger.js';
import { publicRateLimit } from './middleware/rate-limit.js';
import health from './routes/health.js';
import { createAuthRoutes } from './routes/auth.js';
import orgs from './routes/orgs.js';
import leads from './routes/leads.js';
import deals from './routes/deals.js';
import activities from './routes/activities.js';
import accounts from './routes/accounts.js';
import brands from './routes/brands.js';
import competitors from './routes/competitors.js';
import brandEntities from './routes/brand-entities.js';
import useCases from './routes/use-cases.js';
import brandClaims from './routes/brand-claims.js';
import querySets from './routes/query-sets.js';
import crawl from './routes/crawl.js';
import crawlJobs from './routes/crawl-jobs.js';
import pages from './routes/pages.js';
import { ConsoleEmailSender } from './lib/email.js';
import type { AppEnv } from './types/context.js';

const app = new Hono<AppEnv>();

// Security headers — matches docs/08-security/SECURITY.md's required
// header list exactly.
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: { geolocation: [], microphone: [], camera: [] },
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  }),
);

app.use(
  '*',
  cors({
    origin:
      process.env.NODE_ENV === 'production'
        ? ['https://app.bebestwith.ai', 'https://bebestwith.ai', 'https://www.bebestwith.ai']
        : '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  }),
);

app.use('*', requestId);
app.use('*', requestLogger);

// Baseline public rate limit on everything (SECURITY.md: "Public
// (unauthenticated): 30 requests / 1 minute"). Routes needing a stricter
// or authenticated-aware limit apply their own on top — Hono runs
// middleware in registration order, so the more specific limiter still
// executes and can reject before the handler runs.
app.use('*', publicRateLimit);

app.route('/api/health', health);
app.route('/api/auth', createAuthRoutes(new ConsoleEmailSender()));
app.route('/api/orgs', orgs);

// Epic 1 — CRM. Internal-ops tool (docs/epics/01-crm.md's Entitlements
// section) — every route here is gated by requireCrmAccess (the caller's
// current org must BE the internal BeBest operations org, see
// middleware/crm-access.ts), not by which customer org the caller belongs
// to.
app.route('/api/leads', leads);
app.route('/api/deals', deals);
app.route('/api/activities', activities);
app.route('/api/accounts', accounts);

// Epic 2 — Brand Intelligence. Single brand per org (MULTI-BRAND: see
// Epic 18); every child resource hangs off "the" org's brand, resolved via
// lib/brand-context.ts, not a brandId in the URL.
app.route('/api/brands', brands);
app.route('/api/brands/me/competitors', competitors);
app.route('/api/brands/me/entities', brandEntities);
app.route('/api/brands/me/use-cases', useCases);
app.route('/api/brands/me/claims', brandClaims);

// Epic 5 — Intent & Query Universe. Same single-brand-per-org convention as
// Epic 2's routes above (docs/epics/05-intent-query-universe.md's literal
// `/brands/:id/query-sets/...` is adapted to `/brands/me/query-sets/...`,
// consistent with every other Epic 2+ brand-child resource in this file).
app.route('/api/brands/me/query-sets', querySets);

// Epic 3 — Website Intelligence (Crawler). Same single-brand-per-org
// convention as Epic 2/5 above: docs/epics/03-website-intelligence.md's
// literal `/brands/:id/crawl` and `/brands/:id/pages` are adapted to
// `/brands/me/...`. `/api/crawl-jobs/:id` matches the spec exactly (a
// crawl_jobs row is addressed by its own id, not a brand's).
app.route('/api/brands/me/crawl', crawl);
app.route('/api/crawl-jobs', crawlJobs);
app.route('/api/brands/me/pages', pages);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  const requestIdValue = (() => {
    try {
      return c.get('requestId');
    } catch {
      return undefined;
    }
  })();
  console.error(
    JSON.stringify({
      level: 'error',
      requestId: requestIdValue,
      msg: err.message,
      stack: err.stack,
    }),
  );
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
