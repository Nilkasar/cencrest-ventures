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
import seo from './routes/seo.js';
import aiRuns from './routes/ai-runs.js';
import aiRunDetails from './routes/ai-run-details.js';
import competitorAiRuns from './routes/competitor-ai-runs.js';
import competitiveIntelligence from './routes/competitive-intelligence.js';
import opportunities from './routes/opportunities.js';
import opportunityDetails from './routes/opportunity-details.js';
import opportunityRecommendations from './routes/opportunity-recommendations.js';
import recommendations from './routes/recommendations.js';
import recommendationDetails from './routes/recommendation-details.js';
import contentBriefGenerate from './routes/content-brief-generate.js';
import contentBriefs from './routes/content-briefs.js';
import contentBriefDetails from './routes/content-brief-details.js';
import contentDrafts from './routes/content-drafts.js';
import agents from './routes/agents.js';
import agentRunDetails from './routes/agent-run-details.js';
import plans from './routes/plans.js';
import subscription from './routes/subscription.js';
import billingWebhooks from './routes/billing-webhooks.js';
import { createSnapshotRoutes } from './routes/snapshot.js';
import agency from './routes/agency.js';
import whiteLabel from './routes/white-label.js';
import integrations from './routes/integrations.js';
import { ConsoleEmailSender } from './lib/email.js';
import type { AppEnv } from './types/context.js';

const app = new Hono<AppEnv>();

// Single `EmailSender` construction site (per lib/email.ts's own header
// comment: "swapping in Resend later means... changing the single call
// site... no route or handler changes") — shared by every route that sends
// an email, never a fresh `new ConsoleEmailSender()` per route module.
const emailSender = new ConsoleEmailSender();

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
app.route('/api/auth', createAuthRoutes(emailSender));
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

// Epic 4 — SEO Intelligence. Same single-brand-per-org convention as every
// Epic 2+ route above: docs/epics/04-seo-intelligence.md's literal
// `/brands/:id/seo/...` is adapted to `/brands/me/seo/...`. Reads Epic 3's
// `pages`/`page_issues` (POST /analyze) and Epic 2's `use_cases`/
// `brands.categories` (POST /keyword-groups/generate) — no new tables of
// its own beyond `keyword_groups`/`seo_keywords`/`seo_analyses`/
// `seo_opportunities`, see @bebest/database DECISIONS.md's Epic 4 section.
app.route('/api/brands/me/seo', seo);

// Epic 7 — AI Visibility Engine (GEO core). Same single-brand-per-org
// convention as every Epic 2+ route above: docs/epics/07-ai-visibility-
// engine.md's literal `/brands/:id/ai-runs` is adapted to
// `/brands/me/ai-runs`, same as Epic 3's crawl/pages. `/api/ai-runs/:id`
// (+ `/score`, `/responses`) matches the spec exactly — an ai_runs row is
// addressed by its own id, not a brand's, same as `/api/crawl-jobs/:id`.
app.route('/api/brands/me/ai-runs', aiRuns);
app.route('/api/ai-runs', aiRunDetails);

// Epic 8 — Competitive Intelligence. Reuses Epic 7's exact pipeline pointed
// at a `competitors` row instead of the brand (`ai_runs.competitor_id`,
// see @bebest/database DECISIONS.md's Epic 8 section). Spec's literal
// `POST /brands/:id/competitors/:competitorId/ai-runs` is adapted to
// `/brands/me/competitors/:competitorId/ai-runs`, same single-brand-per-org
// convention as every route above; `competitive-gaps`/`share-of-voice`/
// `competitors/:id/movement` match the spec's `/brands/:id/...` shape the
// same way.
app.route('/api/brands/me/competitors', competitorAiRuns);
app.route('/api/brands/me', competitiveIntelligence);

// Epic 9 — Opportunity Engine. Merges Epic 4's SEO demand signal with Epic
// 8's GEO gap classification per intent (Epic 5's `queries`). Same
// single-brand-per-org convention as every route above: the spec's literal
// `POST /brands/:id/opportunities/recompute` and `GET /brands/:id/
// opportunities` are adapted to `/brands/me/...`; `/api/opportunities/:id`
// matches the spec exactly — a `unified_opportunities` row is addressed by
// its own id, not a brand's, same as `/api/crawl-jobs/:id`/`/api/ai-runs/:id`.
app.route('/api/brands/me/opportunities', opportunities);
app.route('/api/opportunities', opportunityDetails);

// Epic 10 — Recommendation Engine. Template-driven brief generated from a
// `unified_opportunities` row's real evidence (Epic 9). Spec's literal
// `POST /opportunities/:id/recommendations/generate` matches exactly — a
// second router mounted at the SAME `/api/opportunities` base as
// `opportunityDetails` above, same precedent `/api/brands/me/competitors`
// already sets (Epic 2's `competitors` + Epic 8's `competitorAiRuns` share
// one base path too). `GET /brands/:id/recommendations` is adapted to
// `/brands/me/recommendations`, same single-brand-per-org convention as
// every route above; `/api/recommendations/:id` matches the spec exactly —
// an `opportunity_recommendations` row is addressed by its own id, not a
// brand's.
app.route('/api/opportunities', opportunityRecommendations);
app.route('/api/brands/me/recommendations', recommendations);
app.route('/api/recommendations', recommendationDetails);

// Epic 11 — Content Intelligence & Generation. A brief is generated FROM an
// approved, content-type recommendation (`opportunity_recommendations`
// above) — `contentBriefGenerate` mounts at the SAME `/api/recommendations`
// base as `recommendationDetails`, same "second router, same base path"
// precedent Epic 10 itself uses at `/api/opportunities`. Draft generation
// (mocked `AIProviderRegistry`, versioned — never overwrites) and the
// quality-checks/approve endpoints are id-addressed, not a brand's, same
// convention `/api/crawl-jobs/:id`/`/api/ai-runs/:id`/`/api/recommendations/
// :id` already use. ADR-007: this epic never publishes — ends at "approved,
// ready to publish," Epic 13's concern from there.
app.route('/api/recommendations', contentBriefGenerate);
app.route('/api/brands/me/content-briefs', contentBriefs);
app.route('/api/content-briefs', contentBriefDetails);
app.route('/api/content-drafts', contentDrafts);

// Epic 12 — GEO Agent / SEO Agent / Growth Agent. Each agent is a thin
// orchestrator over Epics 5/7/8/9/10's already-built engines (see
// `lib/agents/*`) — spec's literal `POST /brands/:id/agents/:agentName/run`
// is adapted to `/brands/me/...`, same single-brand-per-org convention as
// every route above; `/api/agent-runs/:id` (+ `/approve`) matches the spec
// exactly — an `agent_runs` row is addressed by its own id, not a brand's,
// same convention `/api/ai-runs/:id`/`/api/crawl-jobs/:id` already use.
// Autonomy Level 4 is hard-blocked in `lib/agents/autonomy.ts`, not in this
// routing layer.
app.route('/api/brands/me/agents', agents);
app.route('/api/agent-runs', agentRunDetails);

// Epic 16 — Billing. `plans` is public reference data (no auth) for a
// pricing/upgrade UI. `/api/orgs/me/subscription` follows the same
// `requireOrgFromToken` "me" convention as every Epic 2+ brand-scoped route
// above, at the org level instead of the brand level (billing is an
// org-wide concern, not a brand one). `/api/webhooks/billing` is
// unauthenticated by design — its own signature check IS the
// authentication (see routes/billing-webhooks.ts).
app.route('/api/plans', plans);
app.route('/api/orgs/me/subscription', subscription);
app.route('/api/webhooks/billing', billingWebhooks);

// Epic 17 — Free AI + SEO Growth Snapshot. Public, unauthenticated by
// design (docs/epics/17-free-snapshot.md's whole point is a top-of-funnel
// endpoint with no login) — `POST /snapshot` carries its own stricter
// `freeSnapshotRateLimit` (1/hour/IP) on top of the baseline `publicRateLimit`
// applied to every route above; `GET /snapshot/:token` is looked up by an
// opaque token hash, never `snapshot_requests.id`.
app.route('/api/snapshot', createSnapshotRoutes(emailSender));

// Epic 18 — Agency / White Label / Integrations. `agency` composes with
// (never replaces) Epic 0's tenant-context/RLS — see
// `lib/agency-access.ts`/`middleware/tenant-context.ts`'s doc comments and
// `platform/docs/epics/18-agency-white-label-integrations-backend.md`.
// `/orgs/me/settings/white-label` follows the same `requireOrgFromToken`
// "me" convention as `/orgs/me/subscription` above; `integrations` is
// org-scoped the same way.
app.route('/api/agency', agency);
app.route('/api/orgs/me/settings/white-label', whiteLabel);
app.route('/api/integrations', integrations);

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
