/**
 * The prompt-versioning file convention from `docs/12-ai/AI_ARCHITECTURE.md`:
 *
 *   /prompts/
 *     geo/brand-query.v1.0.txt
 *     geo/brand-query.v1.1.txt
 *     seo/page-analysis.v1.0.txt
 *     ...
 *
 * File-based templates are the source of truth checked into git; the
 * `prompt_versions` table (Epic 0's schema) is the durable record of what
 * was actually used against real data once this runs live — this module
 * only deals with the files. Reading which version was used, recording it
 * against a `prompt_versions` row, etc. is the calling application's job
 * (it has the `@bebest/database` client; this package deliberately does
 * not depend on `@bebest/database` at all, so it can be imported by
 * anything, including non-API tooling).
 *
 * Naming rule: `{name}.v{version}.txt`, where `version` is one or more
 * dot-separated non-negative integers (`v1`, `v1.0`, `v1.0.1`, ...) — see
 * "Prompt Versioning Rules" in AI_ARCHITECTURE.md for what patch/minor/major
 * bumps mean. Rendering uses `{{variableName}}` placeholders; every
 * placeholder present in the template MUST have a matching entry in the
 * `variables` map passed to `renderPrompt` — a silently-unsubstituted
 * `{{...}}` reaching a real LLM call is exactly the kind of malformed input
 * this codebase's principles rule out.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PromptTemplate {
  category: string;
  name: string;
  /** e.g. "1.0" — the human-facing version string that gets stamped onto
   * `CompletionRequest.promptVersion` as `"{name}.v{version}"` by
   * `promptVersionFor()` below. */
  version: string;
  filePath: string;
  content: string;
}

export class PromptNotFoundError extends Error {
  constructor(category: string, name: string, version?: string) {
    super(
      version
        ? `No prompt template "${name}" version "${version}" found in category "${category}".`
        : `No prompt template named "${name}" found in category "${category}" (no versions at all).`,
    );
    this.name = 'PromptNotFoundError';
  }
}

export class MissingTemplateVariableError extends Error {
  constructor(
    public readonly template: string,
    public readonly missing: readonly string[],
  ) {
    super(`Template "${template}" references variable(s) not provided: ${missing.join(', ')}`);
    this.name = 'MissingTemplateVariableError';
  }
}

const FILENAME_RE = /^(?<name>[a-z0-9][a-z0-9-]*)\.v(?<version>\d+(?:\.\d+)*)\.txt$/;

/** Splits "1.0.1" into [1, 0, 1] for correct numeric (not lexicographic)
 * comparison — "1.10" must sort after "1.9". */
function parseVersion(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10));
}

function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

interface DiscoveredVersion {
  name: string;
  version: string;
  filePath: string;
}

function discoverVersions(baseDir: string, category: string, name: string): DiscoveredVersion[] {
  const dir = join(baseDir, category);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const found: DiscoveredVersion[] = [];
  for (const entry of entries) {
    const match = FILENAME_RE.exec(entry);
    if (!match?.groups) continue;
    const parsedName = match.groups.name;
    const parsedVersion = match.groups.version;
    if (parsedName === undefined || parsedVersion === undefined) continue;
    if (parsedName !== name) continue;
    found.push({ name: parsedName, version: parsedVersion, filePath: join(dir, entry) });
  }
  return found;
}

/** Lists every version available for `{category}/{name}`, ascending
 * (oldest first). Empty array if the template doesn't exist at all — this
 * does not throw, so callers can use it to decide whether to fall back. */
export function listPromptVersions(baseDir: string, category: string, name: string): string[] {
  return discoverVersions(baseDir, category, name)
    .map((v) => v.version)
    .sort(compareVersions);
}

export interface LoadPromptOptions {
  /** Root prompts directory, e.g. `path.join(import.meta.dirname, '../prompts')`
   * in the consuming app. This package has no built-in default — the
   * convention names a layout, not a fixed filesystem location. */
  baseDir: string;
  /** 'geo' | 'seo' | 'content' | 'agents', or any custom category — kept as
   * `string` rather than a closed union so a later epic can add a category
   * without touching this package. */
  category: string;
  name: string;
  /** Omit to load the highest available version. */
  version?: string;
}

/** Loads one prompt template file. Picks the highest version when
 * `version` is omitted — "latest wins" for callers that don't care to pin,
 * while anything that DOES care (recording which version scored a piece of
 * evidence) always has the option to pin an exact one. */
export function loadPromptTemplate(options: LoadPromptOptions): PromptTemplate {
  const { baseDir, category, name, version } = options;
  const versions = discoverVersions(baseDir, category, name);

  if (versions.length === 0) {
    throw new PromptNotFoundError(category, name, version);
  }

  const match = version
    ? versions.find((v) => v.version === version)
    : versions.slice().sort((a, b) => compareVersions(b.version, a.version))[0];

  if (!match) {
    throw new PromptNotFoundError(category, name, version);
  }

  return {
    category,
    name,
    version: match.version,
    filePath: match.filePath,
    content: readFileSync(match.filePath, 'utf8'),
  };
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export type TemplateVariables = Record<string, string | number | boolean>;

/** Substitutes every `{{variableName}}` in `template.content` from
 * `variables`. Throws `MissingTemplateVariableError` if the template
 * references a placeholder not present in `variables` — never silently
 * ships a literal `{{...}}` into a real prompt. */
export function renderPrompt(template: PromptTemplate, variables: TemplateVariables = {}): string {
  const missing = new Set<string>();

  const rendered = template.content.replace(PLACEHOLDER_RE, (_match, key: string) => {
    if (!(key in variables)) {
      missing.add(key);
      return '';
    }
    return String(variables[key]);
  });

  if (missing.size > 0) {
    throw new MissingTemplateVariableError(`${template.category}/${template.name}.v${template.version}`, [...missing]);
  }

  return rendered;
}

/** The `promptVersion` string to stamp onto `CompletionRequest` for a
 * loaded template — `"{name}.v{version}"`, e.g. `"brand-query.v1.1"`. Kept
 * as one small helper so every call site derives it identically instead of
 * hand-formatting the string. */
export function promptVersionFor(template: PromptTemplate): string {
  return `${template.name}.v${template.version}`;
}
