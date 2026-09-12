// Vercel serverless entry — imports the CJS-bundled Hono app
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { default: app } = require('../dist/app.cjs');

export default app.fetch.bind(app);
