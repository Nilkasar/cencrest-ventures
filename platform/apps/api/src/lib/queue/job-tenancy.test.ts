import { describe, expect, it, vi, beforeEach } from 'vitest';

// Multi-tenancy is a database-level guarantee (ADR-005): RLS is FORCEd on
// every tenant table and the worker connects as `bebest_app`, which has no
// BYPASSRLS. That makes `app.current_org` — set only by `withOrgContext` —
// the thing standing between org A and org B's data, in a process with no
// HTTP request, no JWT middleware and nobody watching. These tests assert
// that every job handler's write to a tenant table happens inside
// `withOrgContext`, with the organization id that came from the job payload.
const { withOrgContext, orgContexts, tenantWrites, directDbAccess, db, runAiVisibilityRun, runCrawlJob, runFreeSnapshotPipeline } =
  vi.hoisted(() => {
    const orgContexts: string[] = [];
    const tenantWrites: Array<{ org: string | null; model: string; op: string }> = [];
    const directDbAccess: string[] = [];
    let currentOrg: string | null = null;

    const client = (org: string | null) =>
      new Proxy(
        {},
        {
          get: (_target, model: string) =>
            new Proxy(
              {},
              {
                get: (_t, op: string) => async () => {
                  tenantWrites.push({ org, model, op });
                  return {};
                },
              },
            ),
        },
      );

    const withOrgContext = vi.fn(async (organizationId: string, fn: (tx: unknown) => unknown) => {
      orgContexts.push(organizationId);
      currentOrg = organizationId;
      try {
        return await fn(client(organizationId));
      } finally {
        currentOrg = null;
      }
    });

    // The unscoped client. Any tenant-table access through THIS is the bug
    // these tests exist to catch: no `app.current_org` is set, so RLS would
    // return/affect nothing — or, with a misconfigured role, everything.
    const db = new Proxy(
      {},
      {
        get: (_target, model: string) => {
          directDbAccess.push(model);
          return new Proxy(
            {},
            {
              get: (_t, op: string) => async () => {
                tenantWrites.push({ org: currentOrg, model, op });
                return {};
              },
            },
          );
        },
      },
    );

    return {
      withOrgContext,
      orgContexts,
      tenantWrites,
      directDbAccess,
      db,
      runAiVisibilityRun: vi.fn(),
      runCrawlJob: vi.fn(),
      runFreeSnapshotPipeline: vi.fn().mockResolvedValue(undefined),
    };
  });

vi.mock('@bebest/database', () => ({
  db,
  withOrgContext,
  withUserContext: vi.fn(async (_id: string, fn: (tx: unknown) => unknown) => fn({})),
  assertRlsEnforced: vi.fn(),
}));
vi.mock('../ai-visibility/pipeline.js', () => ({ runAiVisibilityRun }));
vi.mock('../crawler/engine.js', () => ({ runCrawlJob, MAX_CRAWL_DEPTH: 3, MAX_PAGES: 500 }));
vi.mock('../free-snapshot/orchestrator.js', () => ({ runFreeSnapshotPipeline }));

import { aiVisibilityRunJob } from '../ai-visibility/schedule-run.js';
import { crawlJob } from '../crawler/crawl-job.js';
import { agentRunJob } from '../agents/runner.js';

const ORG = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  orgContexts.length = 0;
  tenantWrites.length = 0;
  directDbAccess.length = 0;
  vi.clearAllMocks();
});

describe('ai_visibility_run handler — org context before any tenant table access', () => {
  it('marks the run failed inside withOrgContext for the payload org', async () => {
    runAiVisibilityRun.mockRejectedValue(new Error('provider down'));

    await aiVisibilityRunJob.handler({ runId: 'run-1', organizationId: ORG, brandId: 'brand-1' });

    expect(orgContexts).toEqual([ORG]);
    expect(tenantWrites).toEqual([{ org: ORG, model: 'ai_runs', op: 'update' }]);
  });

  it('releaseOnShutdown takes the run out of `running` inside the payload org context', async () => {
    await aiVisibilityRunJob.releaseOnShutdown!({ runId: 'run-1', organizationId: ORG, brandId: 'brand-1' });

    expect(orgContexts).toEqual([ORG]);
    expect(tenantWrites).toEqual([{ org: ORG, model: 'ai_runs', op: 'update' }]);
  });

  it('touches no tenant table at all on the happy path (the pipeline owns those writes)', async () => {
    runAiVisibilityRun.mockResolvedValue(undefined);

    await aiVisibilityRunJob.handler({ runId: 'run-1', organizationId: ORG, brandId: 'brand-1' });

    expect(orgContexts).toEqual([]);
    expect(tenantWrites).toEqual([]);
  });
});

describe('crawl_job handler — org context before any tenant table access', () => {
  it('marks the crawl failed inside withOrgContext for the payload org', async () => {
    runCrawlJob.mockRejectedValue(new Error('unreachable'));

    await crawlJob.handler({ jobId: 'job-1', organizationId: ORG, brandId: 'brand-1', rootUrl: 'https://x.example' });

    expect(orgContexts).toEqual([ORG]);
    expect(tenantWrites).toEqual([{ org: ORG, model: 'crawl_jobs', op: 'update' }]);
  });

  it('releaseOnShutdown takes the crawl out of `running` inside the payload org context', async () => {
    await crawlJob.releaseOnShutdown!({
      jobId: 'job-1',
      organizationId: ORG,
      brandId: 'brand-1',
      rootUrl: 'https://x.example',
    });

    expect(orgContexts).toEqual([ORG]);
    expect(tenantWrites).toEqual([{ org: ORG, model: 'crawl_jobs', op: 'update' }]);
  });
});

describe('agent_run handler — org context before any tenant table access', () => {
  it('releaseOnShutdown takes the agent run out of `running` inside the payload org context', async () => {
    await agentRunJob.releaseOnShutdown!({
      runId: 'run-1',
      params: { organizationId: ORG, brandId: 'brand-1', agentName: 'geo_agent', triggeredBy: 'user' },
      autonomyLevel: 1,
    });

    expect(orgContexts).toEqual([ORG]);
    expect(tenantWrites).toEqual([{ org: ORG, model: 'agent_runs', op: 'update' }]);
  });
});

describe('no job handler reaches a tenant table outside an org context', () => {
  it('every job\'s shutdown-release path writes through withOrgContext — except the one non-tenant table', async () => {
    const emailSender = { sendMagicLink: vi.fn(), sendInvitation: vi.fn(), sendSnapshotReady: vi.fn() } as never;
    const { buildJobDefinitions } = await import('./job-registry.js');

    // One payload shape covering every job's release path. Each release reads
    // only the ids it needs, so the extra fields are inert.
    const payload = {
      runId: 'run-1',
      jobId: 'job-1',
      organizationId: ORG,
      brandId: 'brand-1',
      rootUrl: 'https://x.example',
      snapshotRequestId: 'snap-1',
      params: { organizationId: ORG, brandId: 'brand-1', agentName: 'geo_agent', triggeredBy: 'user' },
      autonomyLevel: 1,
    };

    // Only the jobs that own a domain row have a release path; `remeasurement`
    // deliberately has none (it writes nothing until it succeeds) — see
    // job-registry.test.ts's MAY_OMIT_RELEASE for why.
    const definitions = buildJobDefinitions({ emailSender }).filter((definition) => definition.releaseOnShutdown);
    for (const definition of definitions) {
      await definition.releaseOnShutdown!(payload);
    }

    // `snapshot_requests` is the only table reached through the unscoped
    // client, and legitimately so: it has no `organization_id` at all (a free
    // snapshot has no organization yet), so it is not a tenant table — see
    // lib/free-snapshot/snapshot-job.ts's header comment.
    expect(directDbAccess).toEqual(['snapshot_requests']);
    expect(tenantWrites.filter((write) => write.org === null)).toEqual([
      { org: null, model: 'snapshot_requests', op: 'update' },
    ]);
    // Every other release ran inside an org context, once per tenant job.
    expect(orgContexts).toEqual([ORG, ORG, ORG]);
  });
});
