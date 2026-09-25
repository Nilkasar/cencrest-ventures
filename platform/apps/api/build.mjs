import { build } from 'esbuild';
import { cp, mkdir, readdir } from 'fs/promises';

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

// The prompt templates are DATA, not modules — esbuild does not bundle them, so
// without this copy `loadPromptTemplate` throws on the first real AI job while
// the bundles themselves boot perfectly. `lib/prompts-dir.ts` looks for them
// here; see its header for why the source and bundled layouts disagree.
await cp('src/prompts', 'dist/prompts', { recursive: true });

// Fail the build rather than ship bundles whose first job would die. An empty
// or missing directory here is the whole defect this guard exists for.
const promptDirs = await readdir('dist/prompts');
if (promptDirs.length === 0) {
  throw new Error('dist/prompts is empty — the prompt templates were not copied.');
}

console.log(`Build complete: dist/app.cjs, dist/worker.cjs, dist/prompts (${promptDirs.join(', ')})`);
