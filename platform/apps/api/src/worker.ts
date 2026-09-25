/**
 * The worker process entrypoint — the second of the two processes `apps/api`
 * deploys as.
 *
 * `src/server.ts` (and, on Vercel, `api/index.js` → `dist/app.cjs`) serves
 * HTTP and only ENQUEUES jobs. This process only CONSUMES them. It is the
 * half that has to live on a host that stays running: an AI Visibility
 * baseline run is ~1,400 prompts x 4 models (x competitors) — thousands of AI
 * calls and hours of wall time, which no serverless function invocation can
 * survive. See `platform/GO_LIVE.md` §5 for the split and the env vars each
 * side needs.
 *
 * Run it with `pnpm --filter @bebest/api run start:worker` (or
 * `run dev:worker` under tsx). It needs `JOB_QUEUE_DATABASE_URL` — without a
 * durable queue there is nothing for a separate process to consume, and
 * starting anyway would mean handlers registered on an in-memory queue that
 * the HTTP process enqueues onto in a different process entirely, i.e. a
 * worker that silently idles forever. So that case exits non-zero instead.
 */
import './load-env.js';

import { assertRlsEnforced } from '@bebest/database';
import { jobsRunInSeparateWorker } from './lib/queue/default-job-queue.js';
import { createWorkerRuntime, installSignalHandlers } from './lib/queue/worker-runtime.js';
import { describeError } from './lib/describe-error.js';

function log(entry: Record<string, unknown>): void {
  console.error(JSON.stringify(entry));
}

async function main(): Promise<void> {
  if (!jobsRunInSeparateWorker()) {
    log({
      level: 'error',
      msg: 'worker_start_refused',
      reason:
        'JOB_QUEUE_DATABASE_URL is not set. The worker consumes a durable pg-boss queue; ' +
        'with no queue database configured, jobs run in-process in the API instead and this process has nothing to do.',
    });
    process.exit(1);
  }

  // Same non-negotiable check `server.ts` makes, for the same reason and with
  // more force: the worker touches tenant tables (`ai_runs`, `crawl_jobs`,
  // `agent_runs`, `pages`, `ai_responses`…) with no HTTP request and no user
  // watching. It connects as `bebest_app` (no BYPASSRLS) exactly like the API,
  // and every handler sets `app.current_org` via `withOrgContext` before any
  // tenant query. If RLS is not actually in force, that is a cross-tenant
  // leak in a process nobody is looking at.
  if (process.env.SKIP_RLS_CHECK !== 'true') {
    await assertRlsEnforced();
  }

  const runtime = createWorkerRuntime();
  installSignalHandlers(runtime);
  await runtime.start();
}

main().catch((err: unknown) => {
  log({ level: 'error', msg: 'worker_start_failed', error: describeError(err) });
  process.exit(1);
});
