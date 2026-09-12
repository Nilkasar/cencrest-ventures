// Vercel serverless entry — adapts Hono's fetch handler to Node.js IncomingMessage/ServerResponse
import { getRequestListener } from '@hono/node-server';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { default: app } = require('../dist/app.cjs');

export default getRequestListener(app.fetch.bind(app));
