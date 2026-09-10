import './load-env.js';

import { serve } from '@hono/node-server';
import { assertRlsEnforced } from '@bebest/database';
import app from './app.js';

const port = Number(process.env.PORT ?? 3001);

/**
 * Ask the database whether tenant isolation is actually in force before
 * serving anything.
 *
 * RLS being disabled is invisible from inside the application: every query
 * succeeds, every test passes, and every tenant sees every other tenant's
 * rows. In production that is a reason not to start. Elsewhere it is a loud
 * warning — see packages/database/src/rls-check.ts.
 *
 * Set `SKIP_RLS_CHECK=true` only for a deliberately database-less boot.
 */
async function main(): Promise<void> {
  if (process.env.SKIP_RLS_CHECK !== 'true') {
    await assertRlsEnforced();
  }

  serve({ fetch: app.fetch, port }, () => {
    // eslint-disable-next-line no-console -- startup banner, not a log line
    console.log(`BeBest API listening on http://localhost:${port}`);
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
