// Vercel serverless entry — adapts Hono's fetch handler to Node.js IncomingMessage/ServerResponse
import { getRequestListener } from '@hono/node-server';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { default: app } = require('../dist/app.cjs');

const honoListener = getRequestListener(app.fetch.bind(app));

// Vercel does not pre-buffer request bodies on incoming. @hono/node-server's
// getRequestListener creates a lazy pull-based ReadableStream from the
// IncomingMessage, but after any async middleware (DB round-trip) the
// stream events have already fired and the data is lost. Pre-buffering here
// sets `rawBody` (a Buffer), which @hono/node-server detects and converts
// to a static ReadableStream instead — safe to read after async work.
export default async function handler(req, res) {
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
