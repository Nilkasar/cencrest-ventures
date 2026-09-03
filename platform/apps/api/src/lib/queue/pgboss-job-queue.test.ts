import { describe, expect, it, vi, beforeEach } from 'vitest';

// `pg-boss` is mocked in every test in this file — this build's hard
// constraint is "no real network call to an external provider... every
// 'real' integration must follow the same NullXProvider/interface
// discipline". These tests verify `PgBossJobQueue` drives the real
// `pg-boss` API correctly (constructor options, `send`/`work`/`start`/
// `stop` argument shapes) WITHOUT ever opening a real Postgres connection
// — the mock below stands in for the actual client `new PgBoss(...)`
// would open on `.start()`.
const { mockBoss, PgBossCtor } = vi.hoisted(() => {
  const mockBoss = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue('job-id-1'),
    work: vi.fn().mockResolvedValue('sub-id-1'),
    createQueue: vi.fn().mockResolvedValue(undefined),
  };
  return { mockBoss, PgBossCtor: vi.fn(() => mockBoss) };
});
vi.mock('pg-boss', () => ({ PgBoss: PgBossCtor }));

import { PgBossJobQueue } from './pgboss-job-queue.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PgBossJobQueue — construction never connects', () => {
  it('constructing the class does not call start/connect', () => {
    new PgBossJobQueue('postgres://example/db');
    expect(PgBossCtor).toHaveBeenCalledWith({ connectionString: 'postgres://example/db' });
    expect(mockBoss.start).not.toHaveBeenCalled();
  });

  it('register() before start() buffers the handler instead of calling boss.work() immediately', () => {
    const queue = new PgBossJobQueue('postgres://example/db');
    queue.register('crawl_job', async () => {});
    expect(mockBoss.work).not.toHaveBeenCalled();
  });
});

describe('PgBossJobQueue — start()', () => {
  it('calls boss.start(), then createQueue() for every buffered registration, then subscribes via boss.work()', async () => {
    const queue = new PgBossJobQueue('postgres://example/db');
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.register('crawl_job', handler);

    await queue.start();

    expect(mockBoss.start).toHaveBeenCalledTimes(1);
    expect(mockBoss.createQueue).toHaveBeenCalledWith('crawl_job');
    expect(mockBoss.work).toHaveBeenCalledWith('crawl_job', expect.any(Function));
  });

  it('register() after start() subscribes immediately, without buffering', async () => {
    const queue = new PgBossJobQueue('postgres://example/db');
    await queue.start();
    mockBoss.work.mockClear();

    const handler = vi.fn().mockResolvedValue(undefined);
    queue.register('agent_run', handler);

    expect(mockBoss.work).toHaveBeenCalledWith('agent_run', expect.any(Function));
  });

  it('the registered work callback invokes the handler once per job in the batch, with each job\'s .data as the payload', async () => {
    const queue = new PgBossJobQueue('postgres://example/db');
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.register('crawl_job', handler);
    await queue.start();

    const workCallback = mockBoss.work.mock.calls[0]![1] as (jobs: Array<{ id: string; data: unknown }>) => Promise<void>;
    await workCallback([
      { id: 'j1', data: { jobId: 'a' } },
      { id: 'j2', data: { jobId: 'b' } },
    ]);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, { jobId: 'a' });
    expect(handler).toHaveBeenNthCalledWith(2, { jobId: 'b' });
  });

  it('a handler rejection is logged and re-thrown so pg-boss records the job as failed (not silently completed)', async () => {
    const queue = new PgBossJobQueue('postgres://example/db');
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    queue.register('crawl_job', handler);
    await queue.start();

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const workCallback = mockBoss.work.mock.calls[0]![1] as (jobs: Array<{ id: string; data: unknown }>) => Promise<void>;

    await expect(workCallback([{ id: 'j1', data: {} }])).rejects.toThrow('boom');
    expect(errorSpy).toHaveBeenCalled();
    const logged = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({ level: 'error', msg: 'pgboss_job_queue_handler_failed', jobType: 'crawl_job', jobId: 'j1' });
    errorSpy.mockRestore();
  });
});

describe('PgBossJobQueue — enqueue()', () => {
  it('calls boss.send() with the job type and payload, no options when delayMs is not given', async () => {
    const queue = new PgBossJobQueue('postgres://example/db');
    await queue.enqueue('crawl_job', { jobId: 'a' });
    expect(mockBoss.send).toHaveBeenCalledWith('crawl_job', { jobId: 'a' }, undefined);
  });

  it('passes startAfter as a Date computed from delayMs when given', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const queue = new PgBossJobQueue('postgres://example/db');

    await queue.enqueue('remeasurement', { actionId: 'a' }, { delayMs: 60_000 });

    expect(mockBoss.send).toHaveBeenCalledWith('remeasurement', { actionId: 'a' }, { startAfter: new Date('2026-01-01T00:01:00.000Z') });
    vi.useRealTimers();
  });
});

describe('PgBossJobQueue — stop()', () => {
  it('calls boss.stop()', async () => {
    const queue = new PgBossJobQueue('postgres://example/db');
    await queue.start();
    await queue.stop();
    expect(mockBoss.stop).toHaveBeenCalledTimes(1);
  });
});
