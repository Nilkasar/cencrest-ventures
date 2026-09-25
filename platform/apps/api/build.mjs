import { build } from 'esbuild';
import { mkdir } from 'fs/promises';

await mkdir('dist', { recursive: true });

const external = [
    '@prisma/client',
    '.prisma',
    'argon2',
    'pg-native',
    '@sentry/node',
    '@neondatabase/serverless',
    '@prisma/adapter-neon',
    'ws',
    'bufferutil',
    'utf-8-validate',
];

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external,
  // esbuild translates import.meta.dirname to __dirname in CJS output
  define: {
    'import.meta.dirname': '__dirname',
  },
  logLevel: 'info',
};

// Two entrypoints, one codebase — see src/worker.ts's header comment and
// platform/GO_LIVE.md §5. `dist/app.cjs` is what Vercel's serverless entry
// (api/index.js) requires; `dist/worker.cjs` is what the persistent worker
// host runs (`pnpm start:worker`).
await build({ ...shared, entryPoints: ['src/app.ts'], outfile: 'dist/app.cjs' });
await build({ ...shared, entryPoints: ['src/worker.ts'], outfile: 'dist/worker.cjs' });

console.log('Build complete: dist/app.cjs, dist/worker.cjs');
