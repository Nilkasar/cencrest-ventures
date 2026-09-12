import { build } from 'esbuild';
import { mkdir } from 'fs/promises';

await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/app.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/app.cjs',
  external: [
    '@prisma/client',
    '.prisma',
    'argon2',
    'pg-native',
    '@sentry/node',
  ],
  // esbuild translates import.meta.dirname to __dirname in CJS output
  define: {
    'import.meta.dirname': '__dirname',
  },
  logLevel: 'info',
});

console.log('Build complete: dist/app.cjs');
