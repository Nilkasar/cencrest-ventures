/**
 * Loads `apps/api/.env` into `process.env` before anything else is imported.
 *
 * Why this file exists: `server.ts` previously read `PORT`, and `app.ts`
 * reads `NODE_ENV`, at module scope — but nothing in the process ever
 * loaded a `.env` file, so every documented environment variable
 * (`DATABASE_URL`, `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`,
 * `CRM_INTERNAL_ORG_ID`, `APP_URL`…) had to be exported into the shell by
 * hand before `pnpm dev` would work. Values did sometimes appear anyway,
 * but only as a side effect of a transitive dependency calling dotenv —
 * not something to depend on.
 *
 * Uses Node's built-in `process.loadEnvFile` (Node >= 20.6), so this adds
 * no dependency. It is import-first-and-for-side-effect only:
 *
 *   import './load-env.js';   // must stay the FIRST import in server.ts
 *   import app from './app.js';
 *
 * Real environment variables always win — `loadEnvFile` does not overwrite
 * a variable that is already set — so a container/CI/Vercel environment
 * that injects its own configuration is unaffected, and a missing `.env`
 * (the normal case in production) is not an error.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

// `import.meta.dirname`, NOT `import.meta.url`. Both resolve correctly under
// tsx, but `build.mjs` bundles to CJS and only defines `import.meta.dirname`
// (as `__dirname`). `import.meta.url` compiles to an undefined property there,
// so `fileURLToPath` received undefined and the built entrypoint threw
// ERR_INVALID_ARG_TYPE before any of its own code ran. Nothing caught it
// because typecheck, lint and the test suite all exercise the TypeScript
// source, never the bundle.
const here = import.meta.dirname;

// `src/` when run through tsx, `dist/` when run from a build — the file
// lives one level up from either.
const envPath = path.resolve(here, '..', '.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
