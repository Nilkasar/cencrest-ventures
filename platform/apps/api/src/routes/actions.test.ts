import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

let actRows: Array<Record<string, unknown>> = [];
let cdRows: Array<Record<string, unknown>> = [];
let cbRows: Array<Record<string, unknown>> = [];

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    return row[key] === value;
  });
}

const BRAND = { id: 'brand-1', organization_id: 'org-1', name: 'Acme', created_at: new Date('2025-01-01'), deleted_at: null };

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  brands: { findFirst: vi.fn(async (): Promise<typeof BRAND | null> => ({ ...BRAND })) },
  actions: {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const rows = actRows.filter((r) => matches(r, where));
      return rows.map((r) => {
        const draft = cdRows.find((d) => d.id === r.content_draft_id);
        const brief = draft ? cbRows.find((b) => b.id === draft.brief_id) : undefined;
        return { ...r, content_drafts: draft ? { ...draft, content_briefs: brief ? { ...brief } : null } : null };
      });
    }),
  },
  audit_events: { create: vi.fn().mockResolvedValue({}) },
};

const tx = { ...db };

vi.mock('@bebest/database', () => ({
  db,
  withUserContext: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn(tx)),
  withOrgContext: vi.fn(async (_organizationId: string, fn: (tx: unknown) => unknown) => fn(tx)),
}));

async function buildApp() {
  const { default: actions } = await import('./actions.js');
  const app = new Hono();
  app.route('/brands/me/actions', actions);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

function makeAction(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'action-1',
    organization_id: 'org-1',
    brand_id: 'brand-1',
    action_type: 'publish_content',
    title: 'Publish: comparison page',
    description: 'evidence summary',
    priority: 'medium',
    status: 'pending',
    autonomy_level: 1,
    recommendation_id: 'rec-1',
    content_draft_id: null,
    agent_pending_action_id: null,
    approved_by: null,
    approved_at: null,
    executed_at: null,
    rolled_back_at: null,
    result: null,
    created_at: new Date('2026-03-01'),
    updated_at: new Date('2026-03-01'),
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  actRows = [];
  cdRows = [];
  cbRows = [];

  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  db.organizations.findUnique.mockResolvedValue({ id: 'org-1', slug: 'acme', name: 'Acme', deleted_at: null });
  db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
  db.brands.findFirst.mockResolvedValue({ ...BRAND });
});

describe('GET /brands/me/actions', () => {
  it('buckets actions into pending/in-progress/completed/rolled-back sections, matching the Action Center screen exactly', async () => {
    actRows = [
      makeAction({ id: 'a-pending', status: 'pending' }),
      makeAction({ id: 'a-approved', status: 'approved', approved_by: 'user-1', approved_at: new Date('2026-03-02') }),
      makeAction({ id: 'a-completed', status: 'completed', approved_by: 'user-1', approved_at: new Date('2026-03-02'), executed_at: new Date('2026-03-03') }),
      makeAction({ id: 'a-rolled-back', status: 'rolled_back', approved_by: 'user-1', approved_at: new Date('2026-03-02'), executed_at: new Date('2026-03-03'), rolled_back_at: new Date('2026-03-04') }),
    ];
    const app = await buildApp();
    const res = await app.request('/brands/me/actions', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pending: Array<{ id: string }>; inProgress: Array<{ id: string }>; completed: Array<{ id: string }>; rolledBack: Array<{ id: string }> };
    expect(body.pending.map((a) => a.id)).toEqual(['a-pending']);
    expect(body.inProgress.map((a) => a.id)).toEqual(['a-approved']);
    expect(body.completed.map((a) => a.id)).toEqual(['a-completed']);
    expect(body.rolledBack.map((a) => a.id)).toEqual(['a-rolled-back']);
  });

  it('every role in view_intelligence (including viewer) can list actions', async () => {
    actRows = [makeAction({ id: 'a-1' })];
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/brands/me/actions', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
  });

  it('404s when the org has no brand profile yet', async () => {
    db.brands.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.request('/brands/me/actions', { headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('a pending action carries the underlying content draft/brief inline, not just a title', async () => {
    cbRows = [{ id: 'cb-1', title: 'Best Freight Visibility Software' }];
    cdRows = [{ id: 'cd-1', brief_id: 'cb-1', title: 'Draft title', body: 'Draft body', version: 1 }];
    actRows = [makeAction({ id: 'a-with-draft', content_draft_id: 'cd-1' })];
    const app = await buildApp();
    const res = await app.request('/brands/me/actions', { headers: await authHeader('user-1', 'org-1') });
    const body = (await res.json()) as { pending: Array<{ contentDraft: { id: string } | null; contentBrief: { id: string } | null }> };
    expect(body.pending[0]!.contentDraft?.id).toBe('cd-1');
    expect(body.pending[0]!.contentBrief?.id).toBe('cb-1');
  });

  it('tenant isolation: only returns actions for the caller\'s own org/brand', async () => {
    actRows = [makeAction({ id: 'a-mine', organization_id: 'org-1' }), makeAction({ id: 'a-other', organization_id: 'org-2', brand_id: 'brand-2' })];
    const app = await buildApp();
    const res = await app.request('/brands/me/actions', { headers: await authHeader('user-1', 'org-1') });
    const body = (await res.json()) as { pending: Array<{ id: string }> };
    expect(body.pending.map((a) => a.id)).toEqual(['a-mine']);
  });
});
