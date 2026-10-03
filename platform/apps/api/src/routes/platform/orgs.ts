import { Hono } from 'hono';
import { platformDb } from '@bebest/database/platform';
import { escapeLike } from '../../lib/crm-validation.js';
import { planLimitsFromSubscription } from '../../lib/entitlements.js';
import { PLAN_TIERS, type PlanLimits } from '../../lib/billing/plan-catalog.js';
import { uuidParam } from '../../lib/http-params.js';
import type { AppEnv } from '../../types/context.js';
import { isPageError, iso, json, num, pagedQuery, parsePage, platformGuard, searchTerm, SqlParams, type Paginated } from './shared.js';

/**
 * Epic 22 Phase 1 — Organizations (support).
 *
 *   GET /api/platform/orgs?q&kind&plan&status&limit&offset
 *   GET /api/platform/orgs/:id
 *
 * Cross-tenant reads through `platformDb`. `/orgs/:id` is recorded in
 * `platform_access_events` with `target_org_id` (requirePlatformRole's
 * `targetOrgParam: 'id'`), so "which staff member opened which customer"
 * is answerable per org.
 */

export const ORG_KINDS = ['customer', 'agency', 'internal'] as const;
export const ORG_STATUSES = ['active', 'cancelled'] as const;
/** `none` = the org has no `subscriptions` row. */
export const ORG_PLAN_FILTERS = [...PLAN_TIERS, 'none'] as const;

export interface PlatformOrgListItem {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  /** subscriptions.plan, or null when the org has no subscription row */
  plan: string | null;
  subscriptionStatus: string | null;
  memberCount: number;
  createdAt: string;
  deletedAt: string | null;
  /** latest of: ai_runs.created_at, crawl_jobs.created_at, audit_events.created_at */
  lastActivityAt: string | null;
  brand: { id: string; name: string; websiteUrl: string | null } | null;
}

export interface UsageMetric {
  used: number | null;
  /** null = unlimited on this plan */
  limit: number | null;
}

export interface PlatformOrgDetail {
  organization: {
    id: string;
    name: string;
    slug: string;
    kind: string;
    status: string;
    createdAt: string;
    deletedAt: string | null;
  };
  subscription: {
    plan: string;
    planName: string | null;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    cancelledAt: string | null;
    hasExternalCustomer: boolean;
  } | null;
  /** Effective tier + limits, resolved exactly as lib/entitlements.ts does (no subscription → free). */
  plan: { slug: string; limits: PlanLimits };
  /** Same metrics and semantics as GET /api/orgs/me/subscription's `usage` (used: null = not tracked yet). */
  usage: Record<
    | 'competitors_tracked'
    | 'queries_per_query_set'
    | 'ai_queries_per_month'
    | 'team_members'
    | 'pages_analyzed'
    | 'snapshots_per_month'
    | 'agent_runs_per_month'
    | 'autonomy_level_max'
    | 'client_accounts',
    UsageMetric
  >;
  members: {
    userId: string;
    name: string;
    email: string;
    role: string;
    platformRole: string;
    lastLoginAt: string | null;
    joinedAt: string;
  }[];
  brand: {
    id: string;
    name: string;
    websiteUrl: string | null;
    industries: string[];
    categories: string[];
    createdAt: string;
  } | null;
  recentRuns: {
    aiRuns: { id: string; status: string; providers: string[]; totalJobs: number; completedJobs: number; failedJobs: number; aiVisibilityScore: number | null; error: string | null; createdAt: string; completedAt: string | null }[];
    crawlJobs: { id: string; status: string; rootUrl: string; pagesCrawled: number; pagesFound: number; pagesFailed: number; error: string | null; createdAt: string; completedAt: string | null }[];
    agentRuns: { id: string; agentName: string; status: string; triggeredBy: string; stepsCompleted: number; totalSteps: number; error: string | null; createdAt: string; completedAt: string | null }[];
  };
  agencyLinks: {
    /** this org is the agency; `org` is the client */
    asAgency: AgencyLink[];
    /** this org is the client; `org` is the agency */
    asClient: AgencyLink[];
  };
  recentAudit: {
    id: string;
    createdAt: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actorType: string;
    actorRole: string | null;
    result: string;
    userId: string | null;
    userEmail: string | null;
  }[];
}

export interface AgencyLink {
  id: string;
  status: string;
  accessLevel: string;
  relationshipType: string;
  consentedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  org: { id: string; name: string; slug: string; kind: string };
}

const orgs = new Hono<AppEnv>();

orgs.get('/', ...platformGuard('support'), async (c) => {
  const page = parsePage(c);
  if (isPageError(page)) return c.json({ error: page.error }, 422);

  const kind = c.req.query('kind');
  const status = c.req.query('status');
  const plan = c.req.query('plan');
  if (kind && !(ORG_KINDS as readonly string[]).includes(kind)) {
    return c.json({ error: `kind must be one of ${ORG_KINDS.join(', ')}` }, 422);
  }
  if (status && !(ORG_STATUSES as readonly string[]).includes(status)) {
    return c.json({ error: `status must be one of ${ORG_STATUSES.join(', ')}` }, 422);
  }
  if (plan && !(ORG_PLAN_FILTERS as readonly string[]).includes(plan)) {
    return c.json({ error: `plan must be one of ${ORG_PLAN_FILTERS.join(', ')}` }, 422);
  }
  const q = searchTerm(c);

  const params = new SqlParams();
  const where = ['o.deleted_at IS NULL'];
  if (kind) where.push(`o.kind = ${params.add(kind)}`);
  if (status) where.push(`o.status = ${params.add(status)}`);
  if (plan === 'none') where.push('s.id IS NULL');
  else if (plan) where.push(`s.plan = ${params.add(plan)}`);
  if (q) {
    const like = params.add(`%${escapeLike(q)}%`);
    where.push(`(o.name ILIKE ${like} OR o.slug ILIKE ${like})`);
  }

  // Member count, brand and last activity are computed for the page's rows
  // only. Last activity: the latest ai_run, crawl_job or audit event —
  // three index-backed max() lookups per row (organization_id indexes).
  const { rows, total } = await pagedQuery<OrgListRow>(platformDb, params, page, {
    filtered: `SELECT o.id, o.name, o.slug, o.kind, o.status, o.created_at, o.deleted_at,
                      s.plan, s.status::text AS subscription_status
                 FROM organizations o
                 LEFT JOIN subscriptions s ON s.organization_id = o.id
                WHERE ${where.join(' AND ')}`,
    orderBy: 'created_at DESC, id',
    enrich: `(SELECT count(*)::int FROM memberships m WHERE m.organization_id = p.id) AS member_count,
             (SELECT json_build_object('id', b.id, 'name', b.name, 'websiteUrl', b.website_url)
                FROM brands b WHERE b.organization_id = p.id AND b.deleted_at IS NULL
               ORDER BY b.created_at LIMIT 1) AS brand,
             GREATEST(
               (SELECT max(created_at) FROM ai_runs WHERE organization_id = p.id),
               (SELECT max(created_at) FROM crawl_jobs WHERE organization_id = p.id),
               (SELECT max(created_at) FROM audit_events WHERE organization_id = p.id)
             ) AS last_activity_at`,
  });

  const items: PlatformOrgListItem[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    kind: r.kind,
    status: r.status,
    plan: r.plan,
    subscriptionStatus: r.subscription_status,
    memberCount: num(r.member_count),
    createdAt: iso(r.created_at)!,
    deletedAt: iso(r.deleted_at),
    lastActivityAt: iso(r.last_activity_at),
    brand: r.brand ? json<{ id: string; name: string; websiteUrl: string | null }>(r.brand) : null,
  }));

  return c.json({ items, total, limit: page.limit, offset: page.offset } satisfies Paginated<PlatformOrgListItem>);
});

interface OrgListRow {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  created_at: Date | string;
  deleted_at: Date | string | null;
  plan: string | null;
  subscription_status: string | null;
  member_count: number;
  brand: unknown;
  last_activity_at: Date | string | null;
}

/** The org detail, assembled by Postgres as one JSON document (one round trip). */
const ORG_DETAIL_SQL = `
SELECT json_build_object(
  'org', (SELECT json_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'kind', o.kind, 'status', o.status,
                                   'created_at', o.created_at, 'deleted_at', o.deleted_at)
            FROM organizations o WHERE o.id = $1::uuid),
  'sub', (SELECT json_build_object('plan', s.plan, 'status', s.status, 'current_period_start', s.current_period_start,
                                   'current_period_end', s.current_period_end, 'trial_ends_at', s.trial_ends_at,
                                   'cancelled_at', s.cancelled_at, 'has_external_customer', s.external_customer_id IS NOT NULL,
                                   'plans', CASE WHEN p.id IS NULL THEN NULL ELSE
                                     json_build_object('slug', p.slug, 'name', p.name, 'active', p.active, 'limits', p.limits) END)
            FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id WHERE s.organization_id = $1::uuid),
  'members', (SELECT COALESCE(json_agg(json_build_object('user_id', u.id, 'name', u.name, 'email', u.email, 'role', m.role,
                                                          'platform_role', u.platform_role, 'last_login_at', u.last_login_at,
                                                          'joined_at', m.created_at) ORDER BY m.created_at), '[]'::json)
                FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1::uuid),
  'brand', (SELECT json_build_object('id', b.id, 'name', b.name, 'website_url', b.website_url, 'industries', b.industries,
                                     'categories', b.categories, 'created_at', b.created_at)
              FROM brands b WHERE b.organization_id = $1::uuid AND b.deleted_at IS NULL ORDER BY b.created_at LIMIT 1),
  'ai_runs', (SELECT COALESCE(json_agg(r ORDER BY r.created_at DESC), '[]'::json) FROM (
                SELECT id, status, providers, total_jobs, completed_jobs, failed_jobs, ai_visibility_score, error, created_at, completed_at
                  FROM ai_runs WHERE organization_id = $1::uuid ORDER BY created_at DESC LIMIT 10) r),
  'crawl_jobs', (SELECT COALESCE(json_agg(r ORDER BY r.created_at DESC), '[]'::json) FROM (
                SELECT id, status, root_url, pages_crawled, pages_found, pages_failed, error, created_at, completed_at
                  FROM crawl_jobs WHERE organization_id = $1::uuid ORDER BY created_at DESC LIMIT 10) r),
  'agent_runs', (SELECT COALESCE(json_agg(r ORDER BY r.created_at DESC), '[]'::json) FROM (
                SELECT id, agent_name, status, triggered_by, steps_completed, total_steps, error, created_at, completed_at
                  FROM agent_runs WHERE organization_id = $1::uuid ORDER BY created_at DESC LIMIT 10) r),
  'links', (SELECT COALESCE(json_agg(json_build_object(
                'id', l.id, 'agency_org_id', l.agency_org_id, 'status', l.status, 'access_level', l.access_level,
                'relationship_type', l.relationship_type, 'consented_at', l.consented_at, 'revoked_at', l.revoked_at,
                'created_at', l.created_at,
                'agency', json_build_object('id', a.id, 'name', a.name, 'slug', a.slug, 'kind', a.kind),
                'client', json_build_object('id', cl.id, 'name', cl.name, 'slug', cl.slug, 'kind', cl.kind))
              ORDER BY l.created_at DESC), '[]'::json)
              FROM agency_clients l
              JOIN organizations a ON a.id = l.agency_org_id
              JOIN organizations cl ON cl.id = l.client_org_id
             WHERE l.deleted_at IS NULL AND (l.agency_org_id = $1::uuid OR l.client_org_id = $1::uuid)),
  'audit', (SELECT COALESCE(json_agg(r ORDER BY r.created_at DESC), '[]'::json) FROM (
              SELECT ae.id, ae.created_at, ae.action, ae.entity_type, ae.entity_id, ae.actor_type, ae.actor_role, ae.result,
                     ae.user_id, u.email AS user_email
                FROM audit_events ae LEFT JOIN users u ON u.id = ae.user_id
               WHERE ae.organization_id = $1::uuid ORDER BY ae.created_at DESC LIMIT 20) r),
  -- Mirrors routes/subscription.ts's buildUsageSummary metric for metric
  -- (brand = the org's oldest non-deleted brand, as lib/brand-context.ts).
  'usage', (WITH b AS (SELECT id FROM brands WHERE organization_id = $1::uuid AND deleted_at IS NULL ORDER BY created_at LIMIT 1)
            SELECT json_build_object(
              'competitors', (SELECT count(*)::int FROM competitors WHERE organization_id = $1::uuid
                                 AND brand_id = (SELECT id FROM b) AND deleted_at IS NULL),
              'active_qs', (SELECT query_count FROM query_sets WHERE organization_id = $1::uuid
                               AND brand_id = (SELECT id FROM b) AND status = 'active' AND deleted_at IS NULL LIMIT 1),
              'ai_queries', (SELECT COALESCE(sum(total_jobs), 0)::int FROM ai_runs WHERE organization_id = $1::uuid
                               AND created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')),
              'members', (SELECT count(*)::int FROM memberships WHERE organization_id = $1::uuid)))
) AS d`;

interface OrgDetailDoc {
  org: { id: string; name: string; slug: string; kind: string; status: string; created_at: string; deleted_at: string | null } | null;
  sub: {
    plan: string;
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
    trial_ends_at: string | null;
    cancelled_at: string | null;
    has_external_customer: boolean;
    plans: { slug: string; name: string; active: boolean; limits: unknown } | null;
  } | null;
  members: { user_id: string; name: string; email: string; role: string; platform_role: string; last_login_at: string | null; joined_at: string }[];
  brand: { id: string; name: string; website_url: string | null; industries: string[]; categories: string[]; created_at: string } | null;
  ai_runs: { id: string; status: string; providers: string[]; total_jobs: number; completed_jobs: number; failed_jobs: number; ai_visibility_score: number | string | null; error: string | null; created_at: string; completed_at: string | null }[];
  crawl_jobs: { id: string; status: string; root_url: string; pages_crawled: number; pages_found: number; pages_failed: number; error: string | null; created_at: string; completed_at: string | null }[];
  agent_runs: { id: string; agent_name: string; status: string; triggered_by: string; steps_completed: number; total_steps: number; error: string | null; created_at: string; completed_at: string | null }[];
  links: {
    id: string;
    agency_org_id: string;
    status: string;
    access_level: string;
    relationship_type: string;
    consented_at: string | null;
    revoked_at: string | null;
    created_at: string;
    agency: AgencyLink['org'];
    client: AgencyLink['org'];
  }[];
  audit: { id: string; created_at: string; action: string; entity_type: string; entity_id: string | null; actor_type: string; actor_role: string | null; result: string; user_id: string | null; user_email: string | null }[];
  usage: { competitors: number; active_qs: number | null; ai_queries: number; members: number };
}

orgs.get('/:id', ...platformGuard('support', { targetOrgParam: 'id' }), async (c) => {
  const id = uuidParam(c, 'id');
  if (!id) return c.json({ error: 'Organization not found' }, 404);

  const [row] = await platformDb.$queryRawUnsafe<{ d: unknown }[]>(ORG_DETAIL_SQL, id);
  const d = json<OrgDetailDoc>(row?.d);
  if (!d?.org) return c.json({ error: 'Organization not found' }, 404);

  const sub = d.sub;
  const effective = planLimitsFromSubscription(sub ? { plan: sub.plan, plans: sub.plans } : null);
  const limits = effective.limits;
  const u = d.usage;

  const toLink = (l: OrgDetailDoc['links'][number], other: AgencyLink['org']): AgencyLink => ({
    id: l.id,
    status: l.status,
    accessLevel: l.access_level,
    relationshipType: l.relationship_type,
    consentedAt: iso(l.consented_at),
    revokedAt: iso(l.revoked_at),
    createdAt: iso(l.created_at)!,
    org: other,
  });

  const body: PlatformOrgDetail = {
    organization: {
      id: d.org.id,
      name: d.org.name,
      slug: d.org.slug,
      kind: d.org.kind,
      status: d.org.status,
      createdAt: iso(d.org.created_at)!,
      deletedAt: iso(d.org.deleted_at),
    },
    subscription: sub
      ? {
          plan: sub.plan,
          planName: sub.plans?.name ?? null,
          status: sub.status,
          currentPeriodStart: iso(sub.current_period_start),
          currentPeriodEnd: iso(sub.current_period_end),
          trialEndsAt: iso(sub.trial_ends_at),
          cancelledAt: iso(sub.cancelled_at),
          hasExternalCustomer: sub.has_external_customer,
        }
      : null,
    plan: { slug: effective.plan, limits },
    usage: {
      competitors_tracked: { used: num(u.competitors), limit: limits.competitors_tracked },
      queries_per_query_set: { used: u.active_qs ?? null, limit: limits.queries_per_query_set },
      ai_queries_per_month: { used: num(u.ai_queries), limit: limits.ai_queries_per_month },
      team_members: { used: num(u.members), limit: limits.team_members },
      // Not tracked by any epic yet — same `used: null` as GET /orgs/me/subscription.
      pages_analyzed: { used: null, limit: limits.pages_analyzed },
      snapshots_per_month: { used: null, limit: limits.snapshots_per_month },
      agent_runs_per_month: { used: null, limit: limits.agent_runs_per_month },
      autonomy_level_max: { used: null, limit: limits.autonomy_level_max },
      client_accounts: { used: null, limit: limits.client_accounts },
    },
    members: d.members.map((m) => ({
      userId: m.user_id,
      name: m.name,
      email: m.email,
      role: m.role,
      platformRole: m.platform_role,
      lastLoginAt: iso(m.last_login_at),
      joinedAt: iso(m.joined_at)!,
    })),
    brand: d.brand
      ? {
          id: d.brand.id,
          name: d.brand.name,
          websiteUrl: d.brand.website_url,
          industries: d.brand.industries,
          categories: d.brand.categories,
          createdAt: iso(d.brand.created_at)!,
        }
      : null,
    recentRuns: {
      aiRuns: d.ai_runs.map((r) => ({
        id: r.id,
        status: r.status,
        providers: r.providers,
        totalJobs: r.total_jobs,
        completedJobs: r.completed_jobs,
        failedJobs: r.failed_jobs,
        aiVisibilityScore: r.ai_visibility_score === null ? null : Number(r.ai_visibility_score),
        error: r.error,
        createdAt: iso(r.created_at)!,
        completedAt: iso(r.completed_at),
      })),
      crawlJobs: d.crawl_jobs.map((r) => ({
        id: r.id,
        status: r.status,
        rootUrl: r.root_url,
        pagesCrawled: r.pages_crawled,
        pagesFound: r.pages_found,
        pagesFailed: r.pages_failed,
        error: r.error,
        createdAt: iso(r.created_at)!,
        completedAt: iso(r.completed_at),
      })),
      agentRuns: d.agent_runs.map((r) => ({
        id: r.id,
        agentName: r.agent_name,
        status: r.status,
        triggeredBy: r.triggered_by,
        stepsCompleted: r.steps_completed,
        totalSteps: r.total_steps,
        error: r.error,
        createdAt: iso(r.created_at)!,
        completedAt: iso(r.completed_at),
      })),
    },
    agencyLinks: {
      asAgency: d.links.filter((l) => l.agency_org_id === id).map((l) => toLink(l, l.client)),
      asClient: d.links.filter((l) => l.agency_org_id !== id).map((l) => toLink(l, l.agency)),
    },
    recentAudit: d.audit.map((a) => ({
      id: a.id,
      createdAt: iso(a.created_at)!,
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      actorType: a.actor_type,
      actorRole: a.actor_role,
      result: a.result,
      userId: a.user_id,
      userEmail: a.user_email,
    })),
  };

  return c.json(body);
});

export default orgs;
