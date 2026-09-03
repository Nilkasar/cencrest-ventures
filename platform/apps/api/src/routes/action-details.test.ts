import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { generateKeyPair } from 'jose';

let actRows: Array<Record<string, unknown>> = [];
let pcRows: Array<Record<string, unknown>> = [];
let idCounter = 0;

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    return row[key] === value;
  });
}

const db = {
  organizations: { findUnique: vi.fn() },
  memberships: { findFirst: vi.fn() },
  users: { findUnique: vi.fn() },
  actions: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = actRows.find((r) => matches(r, where));
      if (!row) return null;
      const cd = row.content_draft_id ? { title: 'Draft title', body: 'Draft body' } : null;
      return { ...row, content_drafts: cd };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = actRows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
  },
  published_content: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = pcRows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `pc-${++idCounter}`, created_at: new Date('2026-03-10'), updated_at: new Date('2026-03-10'), rolled_back_at: null, rolled_back_by: null, ...data };
      pcRows.push(row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = pcRows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
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
  const { default: actionDetails } = await import('./action-details.js');
  const app = new Hono();
  app.route('/actions', actionDetails);
  return app;
}

async function authHeader(userId: string, orgId: string) {
  const { signAccessToken } = await import('../lib/jwt.js');
  const token = await signAccessToken({ sub: userId, email: 'a@example.com', org: orgId });
  return { authorization: `Bearer ${token}` };
}

function makeAction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
  pcRows = [];
  idCounter = 0;

  const { __setKeysForTesting } = await import('../lib/jwt.js');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  __setKeysForTesting(privateKey, publicKey);

  db.users.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@example.com', name: 'Ada', deleted_at: null });
  // Echoes back the REQUESTED org id (not a static 'org-1') — otherwise a
  // request authenticated against a different org (the tenant-isolation
  // tests below) would silently resolve to 'org-1' regardless of what the
  // token actually claimed, defeating the very isolation being tested.
  db.organizations.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, slug: where.id, name: where.id, deleted_at: null }));
  db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
});

afterEach(async () => {
  const { __setPublishTargetForTesting } = await import('../lib/actions/publish-target.js');
  __setPublishTargetForTesting(undefined);
});

// ═══════════════════════════════════════════════════════════════════════
// POST /actions/:id/approve
// ═══════════════════════════════════════════════════════════════════════

describe('POST /actions/:id/approve', () => {
  it('404s (not a leaking 403) for an action belonging to a different organization — tenant isolation', async () => {
    actRows = [makeAction()];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-2') });
    expect(res.status).toBe(404);
  });

  it('404s for an unknown action id', async () => {
    const app = await buildApp();
    const res = await app.request('/actions/does-not-exist/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(404);
  });

  it('403s for a viewer (publish_content is owner/admin only, not approve_content\'s editor-own)', async () => {
    actRows = [makeAction()];
    db.memberships.findFirst.mockResolvedValue({ role: 'viewer' });
    const app = await buildApp();
    const res = await app.request('/actions/action-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(403);
    expect(db.actions.update).not.toHaveBeenCalled();
  });

  it('403s for an editor (approve_content would allow this role; publish_content does not)', async () => {
    actRows = [makeAction()];
    db.memberships.findFirst.mockResolvedValue({ role: 'editor' });
    const app = await buildApp();
    const res = await app.request('/actions/action-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(403);
  });

  it('an owner sets approved_by/approved_at from the REAL authenticated user, never client-supplied, and audit-logs it', async () => {
    actRows = [makeAction()];
    db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
    const app = await buildApp();
    const before = Date.now();
    const res = await app.request('/actions/action-1/approve', {
      method: 'POST',
      headers: { ...(await authHeader('user-1', 'org-1')), 'Content-Type': 'application/json' },
      // A hostile body trying to set approvedBy/approvedAt itself — must be
      // completely ignored; only the real authenticated caller's id is
      // ever used.
      body: JSON.stringify({ approvedBy: 'someone-else', approvedAt: '2020-01-01T00:00:00.000Z' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { action: { approvedBy: string; approvedAt: string; status: string } };
    expect(body.action.approvedBy).toBe('user-1');
    expect(new Date(body.action.approvedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(body.action.status).toBe('approved');

    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'action.approved', entity_type: 'action', entity_id: 'action-1' }) }),
    );
  });

  it('an admin may also approve (owner/admin, not owner-only)', async () => {
    actRows = [makeAction()];
    db.memberships.findFirst.mockResolvedValue({ role: 'admin' });
    const app = await buildApp();
    const res = await app.request('/actions/action-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
  });

  it('is idempotent: approving an already-approved action a second time returns the existing state without a new audit event', async () => {
    actRows = [makeAction({ status: 'approved', approved_by: 'user-1', approved_at: new Date('2026-03-02') })];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadyApproved: boolean };
    expect(body.alreadyApproved).toBe(true);
    expect(db.actions.update).not.toHaveBeenCalled();
    expect(db.audit_events.create).not.toHaveBeenCalled();
  });

  it('rejects a Level 4 action even at approve time (extra hardening on top of the required execute-path block below)', async () => {
    actRows = [makeAction({ autonomy_level: 4 })];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/approve', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('autonomy_level_rejected');
    expect(db.actions.update).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /actions/:id/execute — the non-negotiable guard clauses
// ═══════════════════════════════════════════════════════════════════════

describe('POST /actions/:id/execute', () => {
  it('404s (not a leaking 403) for an action belonging to a different organization — tenant isolation', async () => {
    actRows = [makeAction({ approved_by: 'user-1', approved_at: new Date() })];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/execute', { method: 'POST', headers: await authHeader('user-1', 'org-2') });
    expect(res.status).toBe(404);
  });

  // ── The required test: execute without approval must be rejected. ──────
  it('REJECTS execute when approved_at is not set — no code path publishes without a prior real approval', async () => {
    actRows = [makeAction({ approved_at: null, approved_by: null })];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/execute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_approved');
    expect(pcRows).toHaveLength(0);
    expect(db.published_content.create).not.toHaveBeenCalled();
    expect(actRows[0]!.executed_at).toBeNull();
  });

  // ── The required test: a Level 4 action, even with approval fields
  // MANUALLY set (a crafted row, not reachable through the approve
  // endpoint's own Level-4 guard — see approve's own test above), must
  // still be rejected by execute's independent guard clause. ─────────────
  it('REJECTS execute for a Level 4 action even given a manually-crafted row with approval fields already set — defense in depth', async () => {
    actRows = [
      makeAction({
        autonomy_level: 4,
        approved_by: 'user-1',
        approved_at: new Date('2026-03-02'),
        status: 'approved',
      }),
    ];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/execute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('autonomy_level_rejected');
    expect(pcRows).toHaveLength(0);
    expect(db.published_content.create).not.toHaveBeenCalled();
    expect(actRows[0]!.executed_at).toBeNull();
  });

  it('rejects Level 4 REGARDLESS of role — even an owner cannot force it through', async () => {
    actRows = [makeAction({ autonomy_level: 4, approved_by: 'user-1', approved_at: new Date() })];
    db.memberships.findFirst.mockResolvedValue({ role: 'owner' });
    const app = await buildApp();
    const res = await app.request('/actions/action-1/execute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(422);
  });

  it('403s for a non-owner/admin role (publish_content) even with approval already set', async () => {
    actRows = [makeAction({ approved_by: 'user-1', approved_at: new Date() })];
    db.memberships.findFirst.mockResolvedValue({ role: 'analyst' });
    const app = await buildApp();
    const res = await app.request('/actions/action-1/execute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(403);
  });

  it('on success (approved, Level <=3): creates published_content via the internal PublishTarget, sets executed_at, flips status to completed, audit-logs content.published', async () => {
    actRows = [makeAction({ status: 'approved', approved_by: 'user-1', approved_at: new Date('2026-03-02') })];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/execute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { alreadyExecuted: boolean; action: { status: string; executedAt: string }; publishedContent: { publishTarget: string; destinationRef: string; status: string; publishedBy: string } };
    expect(body.alreadyExecuted).toBe(false);
    expect(body.action.status).toBe('completed');
    expect(body.action.executedAt).toBeTruthy();

    // The internal-record-only default — never a real external URL, and
    // never silently pretends to reach a real CMS.
    expect(body.publishedContent.publishTarget).toBe('internal_record');
    expect(body.publishedContent.destinationRef.startsWith('internal://')).toBe(true);
    expect(body.publishedContent.status).toBe('published');
    // published_by is a snapshot of the action's own already-verified
    // approver, never client-supplied.
    expect(body.publishedContent.publishedBy).toBe('user-1');

    expect(pcRows).toHaveLength(1);
    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'content.published', entity_type: 'action', entity_id: 'action-1' }) }),
    );
  });

  it('publishes the linked content_drafts title/body when the action originated from Epic 11\'s handoff', async () => {
    actRows = [makeAction({ status: 'approved', approved_by: 'user-1', approved_at: new Date(), content_draft_id: 'cd-1' })];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/execute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(201);
    expect(pcRows[0]!.title).toBe('Draft title');
    expect(pcRows[0]!.body).toBe('Draft body');
  });

  it('is idempotent: a second execute on an already-executed action returns the existing published_content, never publishes twice', async () => {
    actRows = [makeAction({ status: 'approved', approved_by: 'user-1', approved_at: new Date('2026-03-02') })];
    const app = await buildApp();
    const first = await app.request('/actions/action-1/execute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(first.status).toBe(201);
    expect(pcRows).toHaveLength(1);

    const second = await app.request('/actions/action-1/execute', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(second.status).toBe(200);
    const body = (await second.json()) as { alreadyExecuted: boolean };
    expect(body.alreadyExecuted).toBe(true);
    expect(pcRows).toHaveLength(1); // still just one — never published twice
    expect(db.audit_events.create).toHaveBeenCalledTimes(1); // still just the one content.published event
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST /actions/:id/rollback — the real 30-day window
// ═══════════════════════════════════════════════════════════════════════

describe('POST /actions/:id/rollback', () => {
  function executedAction(overrides: Record<string, unknown> = {}) {
    return makeAction({
      status: 'completed',
      approved_by: 'user-1',
      approved_at: new Date('2026-01-01T00:00:00.000Z'),
      executed_at: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    });
  }

  function publishedRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'pc-1',
      organization_id: 'org-1',
      brand_id: 'brand-1',
      action_id: 'action-1',
      publish_target: 'internal_record',
      destination_ref: 'internal://published-content/action-1',
      title: 'Published title',
      body: 'Published body',
      status: 'published',
      published_at: new Date('2026-01-01T00:00:00.000Z'),
      published_by: 'user-1',
      rolled_back_at: null,
      rolled_back_by: null,
      result: {},
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('404s (not a leaking 403) for an action belonging to a different organization — tenant isolation', async () => {
    actRows = [executedAction()];
    pcRows = [publishedRow()];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/rollback', { method: 'POST', headers: await authHeader('user-1', 'org-2') });
    expect(res.status).toBe(404);
  });

  it('rejects rollback when the action was never executed', async () => {
    actRows = [makeAction({ status: 'approved', approved_by: 'user-1', approved_at: new Date() })];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/rollback', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_executed');
  });

  it('403s for a non-owner/admin role', async () => {
    actRows = [executedAction()];
    pcRows = [publishedRow()];
    db.memberships.findFirst.mockResolvedValue({ role: 'editor' });
    const app = await buildApp();
    const res = await app.request('/actions/action-1/rollback', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(403);
  });

  it('succeeds within the 30-day window: reverts published_content status, sets rolled_back_at, audit-logs it', async () => {
    const executedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    actRows = [executedAction({ executed_at: executedAt })];
    pcRows = [publishedRow()];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/rollback', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadyRolledBack: boolean; action: { status: string; rolledBackAt: string } };
    expect(body.alreadyRolledBack).toBe(false);
    expect(body.action.status).toBe('rolled_back');
    expect(body.action.rolledBackAt).toBeTruthy();

    expect(pcRows[0]!.status).toBe('rolled_back');
    expect(pcRows[0]!.rolled_back_by).toBe('user-1');
    expect(pcRows[0]!.rolled_back_at).toBeTruthy();

    expect(db.audit_events.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'action.rolled_back', entity_type: 'action', entity_id: 'action-1' }) }),
    );
  });

  // ── The required boundary tests: just inside / just outside the 30-day
  // window, measured from executed_at. ──────────────────────────────────

  it('succeeds just INSIDE the 30-day window (29 days, 23 hours after execution)', async () => {
    const executedAt = new Date(Date.now() - (29 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000));
    actRows = [executedAction({ executed_at: executedAt })];
    pcRows = [publishedRow()];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/rollback', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(200);
  });

  it('rejects with a SPECIFIC error just OUTSIDE the 30-day window (30 days, 1 hour after execution) — never silently allowed', async () => {
    const executedAt = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000));
    actRows = [executedAction({ executed_at: executedAt })];
    pcRows = [publishedRow()];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/rollback', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('rollback_window_expired');
    // Never silently allowed — published_content is untouched.
    expect(pcRows[0]!.status).toBe('published');
    expect(actRows[0]!.rolled_back_at).toBeNull();
  });

  it('rejects far outside the window (365 days after execution)', async () => {
    const executedAt = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    actRows = [executedAction({ executed_at: executedAt })];
    pcRows = [publishedRow()];
    const app = await buildApp();
    const res = await app.request('/actions/action-1/rollback', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(res.status).toBe(409);
  });

  it('is idempotent: rolling back an already-rolled-back action a second time does not error or re-audit', async () => {
    const executedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    actRows = [executedAction({ executed_at: executedAt })];
    pcRows = [publishedRow()];
    const app = await buildApp();
    const first = await app.request('/actions/action-1/rollback', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(first.status).toBe(200);
    expect(db.audit_events.create).toHaveBeenCalledTimes(1);

    const second = await app.request('/actions/action-1/rollback', { method: 'POST', headers: await authHeader('user-1', 'org-1') });
    expect(second.status).toBe(200);
    const body = (await second.json()) as { alreadyRolledBack: boolean };
    expect(body.alreadyRolledBack).toBe(true);
    expect(db.audit_events.create).toHaveBeenCalledTimes(1); // still just one
  });
});
