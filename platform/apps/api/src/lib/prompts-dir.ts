/**
 * Where the prompt templates live — resolved for BOTH layouts this code runs
 * in, because they disagree and getting it wrong breaks every AI job.
 *
 * Under `tsx` each module keeps its own path, so a caller in `src/lib/<area>/`
 * reaches the templates at `../../prompts`. In `dist/app.cjs` / `dist/worker.cjs`
 * every module has been collapsed into one file and `build.mjs` rewrites
 * `import.meta.dirname` to `__dirname`, which is `dist/` no matter which source
 * file the code came from — so the same relative path resolves to
 * `platform/apps/prompts`, which does not exist. The three call sites that used
 * to compute this themselves therefore worked in dev and in the test suite, and
 * threw `PromptNotFoundError` on the first real job in production.
 *
 * Nothing caught it: the bundles boot fine, and the failure only appears when a
 * job actually tries to load a template — after `pipeline.ts` has already marked
 * the run `running`. That is why `build.mjs` now copies the templates into
 * `dist/prompts` and this module checks both locations, failing loudly and
 * naming what it looked for rather than returning a path that does not exist.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Source layout first (`src/lib/prompts-dir.ts` → `src/prompts`), then the
 * bundled layout (`dist/` → `dist/prompts`). Only one exists at a time. */
function candidates(): string[] {
  return [path.join(import.meta.dirname, '../prompts'), path.join(import.meta.dirname, 'prompts')];
}

let cached: string | undefined;

export function resolvePromptsBaseDir(): string {
  if (cached) return cached;

  const tried = candidates();
  const found = tried.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `Prompt templates not found. Looked in: ${tried.join(', ')}. ` +
        'In a build this means `build.mjs` did not copy `src/prompts` into `dist/prompts`.',
    );
  }

  cached = found;
  return found;
}

/** Test-only — clears the memoized directory. */
export function resetPromptsBaseDirForTests(): void {
  cached = undefined;
}
