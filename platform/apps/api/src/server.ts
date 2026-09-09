import './load-env.js';

import { serve } from '@hono/node-server';
import app from './app.js';

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, () => {
  // eslint-disable-next-line no-console -- startup banner, not a log line
  console.log(`BeBest API listening on http://localhost:${port}`);
});
