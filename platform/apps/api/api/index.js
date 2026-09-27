// Vercel serverless entry — adapts Hono's fetch handler to Node.js IncomingMessage/ServerResponse
import { getRequestListener } from '@hono/node-server';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { default: app, ensureRlsEnforced, describeError } = require('../dist/app.cjs');

const honoListener = getRequestListener(app.fetch.bind(app));

// Vercel does not pre-buffer request bodies on incoming. @hono/node-server's
// getRequestListener creates a lazy pull-based ReadableStream from the
// IncomingMessage, but after any async middleware (DB round-trip) the
// stream events have already fired and the data is lost. Pre-buffering here
// sets `rawBody` (a Buffer), which @hono/node-server detects and converts
// to a static ReadableStream instead — safe to read after async work.
export default async function handler(req, res) {
  // Tenant isolation is verified once per cold start, before anything is
  // served. server.ts and worker.ts do this in their boot sequence; this
  // function has no boot, so it happens here or nowhere. Memoized in
  // lib/rls-gate.ts, so only the first request of an instance pays for it.
  //
  // A rejection means either RLS is genuinely not in force or the database
  // could not be asked. Both are reasons to refuse rather than serve rows
  // whose isolation is unverified. The error names the connected role and a
  // source path, so it is logged and never returned.
  try {
    await ensureRlsEnforced();
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'rls_gate_failed_refusing_to_serve',
        detail: describeError(err),
      }),
    );
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Service unavailable' }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD' && !('rawBody' in req)) {
    await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        req.rawBody = Buffer.concat(chunks);
        resolve(undefined);
      });
      req.on('error', reject);
    });
  }
  return honoListener(req, res);
}
