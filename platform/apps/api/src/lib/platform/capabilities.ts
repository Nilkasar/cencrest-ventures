/**
 * Epic 22 Phase 1 — the Platform capability matrix (`GET /api/platform/
 * capabilities`).
 *
 * One entry per platform capability, each with a status and the
 * dependencies that status was derived from. The rule this file follows:
 *
 *   ANYTHING CHECKABLE IS CHECKED. A capability's status is computed from
 *   `LiveChecks` (gathered per request by routes/platform/capabilities.ts —
 *   env presence, provider health calls, which implementation the factory
 *   returns, the RLS probe). Only facts no runtime check can observe — "the
 *   re-measurement scheduler is a setTimeout", "white label has no
 *   renderer" — are encoded as STATIC dependencies below, each with the
 *   file that makes it true, so a reviewer can verify or retire it.
 *
 * Status semantics:
 *   working — every dependency ok
 *   partial — usable, but a `degrades` dependency is not ok (or a static gap)
 *   blocked — a `required` dependency is not ok: the feature cannot work here
 *   stub    — the implementation behind it is a placeholder (Null provider)
 *
 * Pure: no I/O, no env reads — every input is in `LiveChecks`, so the whole
 * matrix is unit-testable from a literal.
 */

export type CapabilityStatus = 'working' | 'partial' | 'blocked' | 'stub';

export interface CapabilityDependency {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  /** required: not ok ⇒ blocked · degrades: not ok ⇒ partial · stub: not ok ⇒ stub */
  severity: 'required' | 'degrades' | 'stub';
  /** live = observed at request time · static = a code-audit fact encoded in lib/platform/capabilities.ts */
  source: 'live' | 'static';
}

export interface Capability {
  key: string;
  name: string;
  group: 'Core product' | 'Intelligence' | 'Execution' | 'Growth & revenue' | 'Platform';
  status: CapabilityStatus;
  summary: string;
  dependencies: CapabilityDependency[];
}

export type CloudProvider = 'openai' | 'anthropic' | 'google' | 'perplexity';
export const CLOUD_PROVIDERS: readonly CloudProvider[] = ['openai', 'anthropic', 'google', 'perplexity'];

export interface ProviderCheck {
  /** API key present in the environment */
  configured: boolean;
  /** healthCheck() result; null = did not answer within the time box */
  healthy: boolean | null;
}

export interface LiveChecks {
  ai: Record<CloudProvider, ProviderCheck>;
  ollama: { baseUrl: string; healthy: boolean | null };
  jwtKeys: boolean;
  appUrl: boolean;
  resend: boolean;
  googleOAuth: { clientId: boolean; clientSecret: boolean; stateSecret: boolean };
  /** getPaymentProvider() is the NullPaymentProvider */
  paymentProviderIsNull: boolean;
  billingWebhookSecret: boolean;
  /** getPublishTarget() is the NullPublishTarget */
  publishTargetIsNull: boolean;
  /** getDefaultJobQueue() implementation class name */
  jobQueue: string;
  jobQueueDurable: boolean;
  /** getDefaultErrorTracker() implementation class name */
  errorTracker: string;
  errorTrackerIsConsole: boolean;
  rls: { enforced: boolean | null; role: string | null; detail: string };
  crmInternalOrg: boolean;
  platformDb: { configured: boolean; reachable: boolean | null };
}

// ── Dependency builders ─────────────────────────────────────────────────

function live(key: string, label: string, ok: boolean, detail: string, severity: CapabilityDependency['severity'] = 'required'): CapabilityDependency {
  return { key, label, ok, detail, severity, source: 'live' };
}

function gap(key: string, label: string, detail: string, severity: CapabilityDependency['severity'] = 'degrades'): CapabilityDependency {
  return { key, label, ok: false, detail, severity, source: 'static' };
}

function providerDetail(name: string, p: ProviderCheck): string {
  if (!p.configured) return `${name}: no API key configured`;
  if (p.healthy === null) return `${name}: key set; health check timed out`;
  return p.healthy ? `${name}: key set; health check ok` : `${name}: key set; health check FAILED`;
}

function geoProviders(c: LiveChecks, severity: CapabilityDependency['severity']): CapabilityDependency[] {
  const healthy = CLOUD_PROVIDERS.filter((p) => c.ai[p].healthy === true);
  return [
    live(
      'ai.geo_any',
      'At least one AI assistant reachable (geo.query fan-out)',
      healthy.length > 0,
      healthy.length > 0 ? `${healthy.length}/4 healthy: ${healthy.join(', ')}` : 'none of openai/anthropic/google/perplexity is healthy',
      severity,
    ),
    live(
      'ai.geo_all',
      'All 4 AI assistants reachable',
      healthy.length === CLOUD_PROVIDERS.length,
      CLOUD_PROVIDERS.map((p) => providerDetail(p, c.ai[p])).join(' · '),
      'degrades',
    ),
  ];
}

function extraction(c: LiveChecks): CapabilityDependency {
  // `extraction` resolves to ['ollama'] only (packages/ai-provider DEFAULT_TASK_DEFAULTS).
  return live(
    'ai.extraction',
    'Extraction model (Ollama)',
    c.ollama.healthy === true,
    c.ollama.healthy === true
      ? `Ollama reachable at ${c.ollama.baseUrl}`
      : c.ollama.healthy === null
        ? `Ollama at ${c.ollama.baseUrl} did not answer within the time box`
        : `Ollama not reachable at ${c.ollama.baseUrl} — observations cannot be extracted`,
  );
}

function queue(c: LiveChecks): CapabilityDependency {
  return live(
    'jobs.queue',
    'Durable background job queue',
    c.jobQueueDurable,
    c.jobQueueDurable ? `${c.jobQueue}` : `${c.jobQueue} — not durable on serverless; a job dies with its instance`,
    'degrades',
  );
}

function email(c: LiveChecks, severity: CapabilityDependency['severity'] = 'degrades'): CapabilityDependency {
  return live(
    'email.resend',
    'Email delivery (Resend)',
    c.resend,
    c.resend ? 'RESEND_API_KEY set' : 'RESEND_API_KEY not set — emails are logged to the console, not delivered',
    severity,
  );
}

function status(deps: CapabilityDependency[]): CapabilityStatus {
  const failing = deps.filter((d) => !d.ok);
  if (failing.some((d) => d.severity === 'stub')) return 'stub';
  if (failing.some((d) => d.severity === 'required')) return 'blocked';
  if (failing.length > 0) return 'partial';
  return 'working';
}

type Def = Omit<Capability, 'status' | 'dependencies'> & { deps: (c: LiveChecks) => CapabilityDependency[] };

// ── The catalog ─────────────────────────────────────────────────────────

const CATALOG: Def[] = [
  {
    key: 'onboarding',
    name: 'Sign-up, sign-in & onboarding',
    group: 'Core product',
    summary: 'Magic-link sign-in (primary), Google sign-in (secondary), org creation and brand setup.',
    deps: (c) => [
      live('auth.jwt', 'JWT signing keys', c.jwtKeys, c.jwtKeys ? 'JWT_PRIVATE_KEY / JWT_PUBLIC_KEY set' : 'JWT keys missing — no session can be issued'),
      live('auth.app_url', 'APP_URL (magic-link target)', c.appUrl, c.appUrl ? 'APP_URL set' : 'APP_URL not set — links point at http://localhost:3000', 'degrades'),
      email(c, 'required'),
      live(
        'auth.google',
        'Google sign-in',
        c.googleOAuth.clientId && c.googleOAuth.clientSecret,
        c.googleOAuth.clientId && c.googleOAuth.clientSecret ? 'GOOGLE_CLIENT_ID / SECRET set' : 'Google OAuth client not configured',
        'degrades',
      ),
    ],
  },
  {
    key: 'query_universe',
    name: 'Query universe',
    group: 'Intelligence',
    summary: 'Intent and query-set generation from the brand profile. Template-driven (lib/query-generator.ts) — no AI dependency.',
    deps: () => [],
  },
  {
    key: 'ai_visibility',
    name: 'AI visibility engine',
    group: 'Intelligence',
    summary: 'Runs the query set across the 4 AI assistants, extracts observations, scores deterministically.',
    deps: (c) => [...geoProviders(c, 'required'), extraction(c), queue(c)],
  },
  {
    key: 'website_crawler',
    name: 'Website crawler',
    group: 'Intelligence',
    summary: 'SSRF-guarded crawl (depth 3, 500 pages, 2 req/s, robots.txt).',
    deps: (c) => [queue(c)],
  },
  {
    key: 'seo_intelligence',
    name: 'SEO intelligence',
    group: 'Intelligence',
    summary: 'Technical/content analysis over crawled pages and keyword groups; Search Console data when connected.',
    deps: (c) => [
      live(
        'connector.google',
        'Search Console connector available',
        c.googleOAuth.clientId && c.googleOAuth.clientSecret && c.googleOAuth.stateSecret,
        c.googleOAuth.clientId && c.googleOAuth.clientSecret && c.googleOAuth.stateSecret
          ? 'Google OAuth configured'
          : 'Google OAuth not fully configured — analysis runs without GSC demand data',
        'degrades',
      ),
    ],
  },
  {
    key: 'competitors',
    name: 'Competitive intelligence',
    group: 'Intelligence',
    summary: 'The AI visibility pipeline pointed at each competitor; gaps, share of voice, movement.',
    deps: (c) => [...geoProviders(c, 'required'), extraction(c), queue(c)],
  },
  {
    key: 'opportunities',
    name: 'Opportunity engine',
    group: 'Intelligence',
    summary: 'Deterministic merge of SEO demand and GEO gaps per intent. No external dependency.',
    deps: () => [],
  },
  {
    key: 'recommendations',
    name: 'Recommendations',
    group: 'Intelligence',
    summary: 'Template-driven briefs generated from opportunity evidence. No external dependency.',
    deps: () => [],
  },
  {
    key: 'agents',
    name: 'Agents (GEO / SEO / Growth)',
    group: 'Execution',
    summary: 'Orchestrators over the engines above, autonomy levels 1–3. Level 4 is hard-blocked in code (lib/agents/autonomy.ts) until Phase 10.',
    deps: (c) => [...geoProviders(c, 'required'), extraction(c), queue(c)],
  },
  {
    key: 'publishing',
    name: 'Action center & publishing',
    group: 'Execution',
    summary: 'Approval-gated actions; execute/rollback within 30 days. Publishing goes through a PublishTarget.',
    deps: (c) => [
      live(
        'publish.target',
        'Publish target (CMS connector)',
        !c.publishTargetIsNull,
        c.publishTargetIsNull ? 'NullPublishTarget — execute records a publish but changes no website' : 'real publish target wired',
        'stub',
      ),
    ],
  },
  {
    key: 'measurement',
    name: 'Measurement & learning loop',
    group: 'Execution',
    summary: 'Before/after scores around each executed action; re-measurement 4 weeks later.',
    deps: (c) => [
      gap(
        'measurement.scheduler',
        'Durable 4-week re-measurement trigger',
        'lib/measurement/schedule-remeasurement.ts schedules with an in-process timer — a restart or serverless instance recycle loses every pending re-measurement',
      ),
      queue(c),
    ],
  },
  {
    key: 'content_drafts',
    name: 'Content briefs & drafts',
    group: 'Execution',
    summary: 'Draft generation (content.generation: OpenAI, else Ollama), quality checks, approval.',
    deps: (c) => {
      const openai = c.ai.openai.healthy === true;
      const ollama = c.ollama.healthy === true;
      return [
        live(
          'ai.content_generation',
          'Content model (OpenAI or Ollama)',
          openai || ollama,
          openai ? 'OpenAI healthy' : ollama ? 'OpenAI unavailable; falling back to Ollama' : 'neither OpenAI nor Ollama is available',
        ),
      ];
    },
  },
  {
    key: 'reports',
    name: 'Reports',
    group: 'Core product',
    summary: 'Immutable report snapshots (weekly digest, monthly, competitor, opportunity) with email notification.',
    deps: (c) => [email(c)],
  },
  {
    key: 'notifications',
    name: 'Notifications & email',
    group: 'Core product',
    summary: 'In-app notifications always; email via Resend.',
    deps: (c) => [email(c)],
  },
  {
    key: 'billing',
    name: 'Billing & payments',
    group: 'Growth & revenue',
    summary: 'Plans, entitlements and usage limits are live data; charging customers needs a real PaymentProvider.',
    deps: (c) => [
      live(
        'billing.provider',
        'Payment provider',
        !c.paymentProviderIsNull,
        c.paymentProviderIsNull ? 'NullPaymentProvider — plan changes apply without charging (payment provider is open decision D-O09)' : 'real payment provider wired',
        'stub',
      ),
      live(
        'billing.webhook_secret',
        'Billing webhook secret',
        c.billingWebhookSecret,
        c.billingWebhookSecret ? 'BILLING_WEBHOOK_SECRET set' : 'BILLING_WEBHOOK_SECRET not set — webhooks are rejected',
        'degrades',
      ),
    ],
  },
  {
    key: 'connectors',
    name: 'Connectors (Search Console, GA4)',
    group: 'Core product',
    summary: 'Per-org Google OAuth connection to Search Console and GA4.',
    deps: (c) => [
      live('google.client_id', 'GOOGLE_CLIENT_ID', c.googleOAuth.clientId, c.googleOAuth.clientId ? 'set' : 'not set'),
      live('google.client_secret', 'GOOGLE_CLIENT_SECRET', c.googleOAuth.clientSecret, c.googleOAuth.clientSecret ? 'set' : 'not set'),
      live('google.state_secret', 'GOOGLE_OAUTH_STATE_SECRET', c.googleOAuth.stateSecret, c.googleOAuth.stateSecret ? 'set' : 'not set — OAuth state cannot be signed'),
    ],
  },
  {
    key: 'agency',
    name: 'Agency workspaces',
    group: 'Growth & revenue',
    summary: 'Consent-based agency ↔ client links; agency members act in client orgs through RLS-scoped context.',
    deps: () => [],
  },
  {
    key: 'white_label',
    name: 'White label',
    group: 'Growth & revenue',
    summary: 'Per-org branding settings are stored and served.',
    deps: () => [
      gap(
        'white_label.renderer',
        'Branding applied to output',
        'lib/white-label.ts resolveWhiteLabelBranding is not wired into any report or page renderer yet — settings are saved but nothing is rendered with them',
      ),
    ],
  },
  {
    key: 'crm',
    name: 'CRM',
    group: 'Growth & revenue',
    summary: 'Leads, deals, accounts and activities in the internal operations org; usable by ops-org members and platform staff.',
    deps: (c) => [
      live(
        'crm.internal_org',
        'CRM_INTERNAL_ORG_ID',
        c.crmInternalOrg,
        c.crmInternalOrg ? 'internal operations org configured' : 'CRM_INTERNAL_ORG_ID missing or not a UUID — every CRM route answers 500',
      ),
    ],
  },
  {
    key: 'free_snapshot',
    name: 'Free AI visibility snapshot',
    group: 'Growth & revenue',
    summary: 'Public top-of-funnel: crawl + sample AI run + SEO pass → report link by email, lead in the CRM.',
    deps: (c) => [
      ...geoProviders(c, 'required'),
      extraction(c),
      queue(c),
      email(c),
      live('crm.internal_org', 'CRM_INTERNAL_ORG_ID (lead capture)', c.crmInternalOrg, c.crmInternalOrg ? 'set' : 'not set — snapshot leads cannot be recorded', 'degrades'),
    ],
  },
  {
    key: 'background_jobs',
    name: 'Background jobs',
    group: 'Platform',
    summary: 'Crawls, AI runs, agent runs and snapshots execute through lib/queue.',
    deps: (c) => [queue(c)],
  },
  {
    key: 'scheduling',
    name: 'Scheduling / cron',
    group: 'Platform',
    summary: 'Recurring work: monitoring runs, weekly digests, re-measurement.',
    deps: () => [
      gap(
        'cron.configured',
        'A cron trigger',
        'No scheduler exists: apps/api/vercel.json defines no crons and no route is cron-invoked — nothing recurring runs on its own',
        'stub',
      ),
    ],
  },
  {
    key: 'tenant_isolation',
    name: 'Tenant isolation (RLS)',
    group: 'Platform',
    summary: 'Row-Level Security enforced for the request role; probed live with a foreign-org query.',
    deps: (c) => [
      live(
        'rls.enforced',
        'RLS enforced for the request role',
        c.rls.enforced === true,
        c.rls.detail,
        c.rls.enforced === null ? 'degrades' : 'required',
      ),
    ],
  },
  {
    key: 'error_tracking',
    name: 'Error tracking',
    group: 'Platform',
    summary: 'Unhandled errors routed through the ErrorTracker interface.',
    deps: (c) => [
      live(
        'errors.tracker',
        'Hosted error tracker',
        !c.errorTrackerIsConsole,
        c.errorTrackerIsConsole
          ? `${c.errorTracker} — errors go to stdout only (error tracking vendor is open decision D-O14)`
          : `${c.errorTracker}`,
        'degrades',
      ),
    ],
  },
  {
    key: 'platform_view',
    name: 'Platform view (staff)',
    group: 'Platform',
    summary: 'Cross-tenant staff API on the bebest_platform role, every call access-logged.',
    deps: (c) => [
      live(
        'platform.db',
        'PLATFORM_DATABASE_URL (bebest_platform)',
        c.platformDb.configured && c.platformDb.reachable === true,
        !c.platformDb.configured
          ? 'PLATFORM_DATABASE_URL not set — every Platform data route answers 503'
          : c.platformDb.reachable === true
            ? 'configured and reachable'
            : c.platformDb.reachable === null
              ? 'configured; connectivity check did not answer within the time box (cold connection?)'
              : 'configured but the connection failed',
        // Unset or failing: blocked. A probe that merely timed out is
        // "unknown", which degrades rather than blocks — same as the RLS probe.
        c.platformDb.configured && c.platformDb.reachable === null ? 'degrades' : 'required',
      ),
    ],
  },
];

export function buildCapabilities(checks: LiveChecks): Capability[] {
  return CATALOG.map(({ deps, ...def }) => {
    const dependencies = deps(checks);
    return { ...def, status: status(dependencies), dependencies };
  });
}
