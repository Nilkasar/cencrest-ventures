import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// The registry imports every job handler, which transitively imports the
// Prisma client, the AI provider registry and the agent runner. None of that
// should open a connection in a unit test — same mock shape every route test
// in this repo already uses.
vi.mock('@bebest/database', () => {
  const tx = new Proxy({}, { get: () => ({ update: vi.fn(), create: vi.fn(), findFirst: vi.fn() }) });
  return {
    db: tx,
    withOrgContext: vi.fn(async (_orgId: string, fn: (t: unknown) => unknown) => fn(tx)),
    withUserContext: vi.fn(async (_userId: string, fn: (t: unknown) => unknown) => fn(tx)),
    assertRlsEnforced: vi.fn(),
  };
});

import { ALL_JOB_TYPES, JOB_POLICIES, JOB_TYPES } from './job-types.js';
import {
  assertJobHandlerCoverage,
  buildJobDefinitions,
  JobHandlerCoverageError,
  registerAllJobHandlers,
  type JobRegistryDeps,
} from './job-registry.js';
import type { JobHandler, JobQueue } from './job-queue.js';

const emailSender = {
  sendMagicLink: vi.fn(),
  sendInvitation: vi.fn(),
  sendSnapshotReady: vi.fn(),
} as unknown as NonNullable<JobRegistryDeps['emailSender']>;

function fakeQueue() {
  const registered = new Map<string, JobHandler<unknown>>();
  const queue: JobQueue = {
    register: <T>(jobType: string, handler: JobHandler<T>) => {
      registered.set(jobType, handler as JobHandler<unknown>);
    },
    enqueue: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  return { queue, registered };
}

describe('registerAllJobHandlers — the worker consumes every job type the API can enqueue', () => {
  it('registers a handler for every declared job type', () => {
    const { queue, registered } = fakeQueue();

    const { definitions } = registerAllJobHandlers(queue, { emailSender });

    expect([...registered.keys()].sort()).toEqual([...ALL_JOB_TYPES].sort());
    expect(definitions).toHaveLength(ALL_JOB_TYPES.length);
  });

  it('every registered job type is one declared in job-types.ts (no stray handler)', () => {
    const definitions = buildJobDefinitions({ emailSender });
    for (const definition of definitions) {
      expect(ALL_JOB_TYPES).toContain(definition.jobType);
    }
  });

  // A job that owns a domain row MUST release it: with no `releaseOnShutdown`
  // the row stays in whatever in-progress state it reached when the worker was
  // killed, which is the exact bug the worker split exists to fix.
  //
  // `remeasurement` is a KNOWN, UNRESOLVED exception, not a justified one. An
  // earlier version of this comment claimed it owns no in-progress row because
  // `run-measurement.ts` writes its `measurements`/`outcome_records` rows only
  // on success. That was wrong: `run-measurement.ts` calls
  // `lib/agents/run-ai-visibility-step.ts`, which creates an `ai_runs` row at
  // `status: 'queued'` and awaits the full pipeline (which sets `running`). A
  // worker killed mid-remeasurement strands exactly that row.
  //
  // It is still exempt only because a correct release is not expressible today:
  // `releaseOnShutdown` receives the job payload, the payload is
  // `{ actionId, organizationId }`, and nothing links the action to the inner
  // run's id — there is no `after_ai_run_id` on `measurements`. Releasing "any
  // running run for this brand" would risk failing an unrelated concurrent run,
  // which is worse than the leak. Fixing it properly means threading the inner
  // run's id into the payload or persisting the link, and that is a real change
  // rather than a comment.
  const KNOWN_UNRELEASABLE: readonly string[] = [JOB_TYPES.REMEASUREMENT];

  it('every job definition can release an in-flight instance of itself on shutdown', () => {
    for (const definition of buildJobDefinitions({ emailSender })) {
      if (KNOWN_UNRELEASABLE.includes(definition.jobType)) continue;
      expect(definition.releaseOnShutdown, `${definition.jobType} has no releaseOnShutdown`).toBeTypeOf('function');
    }
  });

  it('a job with no release path is at least never auto-retried, so a kill does not re-spend', () => {
    // The previous version of this test asserted `retryLimit > 0` as the safety
    // argument, which was backwards. The handler catches its own errors and
    // resolves, so pg-boss never observes a real failure to retry; a retry could
    // only fire after expiry or a kill — precisely when re-running thousands of
    // billed AI calls is most expensive.
    for (const jobType of KNOWN_UNRELEASABLE) {
      expect(
        JOB_POLICIES[jobType as keyof typeof JOB_POLICIES].retryLimit,
        `${jobType} has no release path, so it must not be auto-retried`,
      ).toBe(0);
    }
  });

  it('a job that runs another job inline has at least that job\'s expiry ceiling', () => {
    // remeasurement awaits a full AI visibility run. A shorter ceiling means
    // pg-boss re-dispatches while the first attempt is still running.
    expect(JOB_POLICIES[JOB_TYPES.REMEASUREMENT].expireInSeconds).toBeGreaterThanOrEqual(
      JOB_POLICIES[JOB_TYPES.AI_VISIBILITY_RUN].expireInSeconds,
    );
  });
});

describe('assertJobHandlerCoverage — a missing consumer is loud, not silent', () => {
  const handler: JobHandler<unknown> = async () => {};

  it('throws naming the job type that has no handler', () => {
    const partial = ALL_JOB_TYPES.slice(1).map((jobType) => ({ jobType, handler }));

    expect(() => assertJobHandlerCoverage(partial)).toThrow(JobHandlerCoverageError);
    expect(() => assertJobHandlerCoverage(partial)).toThrow(ALL_JOB_TYPES[0]!);
  });

  it('throws when two handlers claim the same job type', () => {
    const duplicated = [...ALL_JOB_TYPES, JOB_TYPES.CRAWL].map((jobType) => ({ jobType, handler }));
    expect(() => assertJobHandlerCoverage(duplicated)).toThrow(/More than one handler/);
  });

  it('throws when a handler claims a job type that job-types.ts does not declare', () => {
    const undeclared = [...ALL_JOB_TYPES, 'ai_response_cache_warm'].map((jobType) => ({ jobType, handler }));
    expect(() => assertJobHandlerCoverage(undeclared)).toThrow(/missing from lib\/queue\/job-types\.ts/);
  });

  it('accepts exactly the real registry', () => {
    expect(() => assertJobHandlerCoverage(buildJobDefinitions({ emailSender }))).not.toThrow();
  });
});

// ── The guard that actually catches the mistake ───────────────────────────
// A runtime coverage check only fires for job types someone remembered to
// declare in `job-types.ts`. The failure mode the HTTP/worker split
// introduces is subtler: someone adds a NEW `enqueue()` call with a new job
// type string, the HTTP side happily writes pg-boss rows, and no worker is
// subscribed — jobs accumulate unclaimed and the feature silently never runs.
// So the source tree itself is checked: every enqueue site must name its job
// type through `JOB_TYPES`, which is what `assertJobHandlerCoverage` then
// guarantees a handler for.
const SRC_ROOT = path.resolve(import.meta.dirname, '../..');
const QUEUE_DIR = path.join(SRC_ROOT, 'lib', 'queue');

/** Comments mention `enqueue(jobType, payload)` in prose (see
 * `lib/measurement/schedule-remeasurement.ts`'s header), so the scan reads
 * code only. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    // The queue implementations define `enqueue`; they do not call it with a
    // job type of their own.
    if (full.startsWith(QUEUE_DIR)) return [];
    return [full];
  });
}

describe('every enqueue() call site in apps/api names a declared job type', () => {
  const files = sourceFiles(SRC_ROOT);

  it('finds the enqueue call sites (the scan itself must not silently match nothing)', () => {
    const total = files.reduce(
      (count, file) => count + (stripComments(readFileSync(file, 'utf8')).match(/\.enqueue[<(]/g)?.length ?? 0),
      0,
    );
    expect(total).toBeGreaterThanOrEqual(ALL_JOB_TYPES.length);
  });

  it('uses JOB_TYPES.* — never a bare string — as the job type, and every one has a handler', () => {
    const declared = new Set<string>(Object.values(JOB_TYPES));
    const handled = new Set(buildJobDefinitions({ emailSender }).map((definition) => definition.jobType));
    const offenders: string[] = [];
    const used = new Set<string>();

    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      const calls = source.match(/\.enqueue[<(][^;]*?\(\s*([A-Za-z0-9_.'"]+)\s*,/gs) ?? [];
      const understood = source.match(/\.enqueue<[^>]*>\(\s*(JOB_TYPES\.[A-Z0-9_]+)\s*,/g) ?? [];

      if (calls.length !== understood.length) {
        offenders.push(`${path.relative(SRC_ROOT, file)}: enqueue() call whose job type is not a JOB_TYPES.* constant`);
        continue;
      }
      for (const call of understood) {
        const key = /JOB_TYPES\.([A-Z0-9_]+)/.exec(call)![1]!;
        const jobType = (JOB_TYPES as Record<string, string>)[key];
        if (!jobType || !declared.has(jobType)) {
          offenders.push(`${path.relative(SRC_ROOT, file)}: JOB_TYPES.${key} is not declared in job-types.ts`);
          continue;
        }
        used.add(jobType);
      }
    }

    expect(offenders).toEqual([]);
    expect([...used].filter((jobType) => !handled.has(jobType))).toEqual([]);
    // Every declared type is actually enqueued somewhere — a declared type
    // nothing enqueues is dead weight the worker still has to cover.
    expect([...declared].filter((jobType) => !used.has(jobType))).toEqual([]);
  });
});
