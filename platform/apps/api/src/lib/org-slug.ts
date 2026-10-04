/**
 * Epic 22 (Workspace Views) Phase 2 — the ONE place an organization row is
 * created, with a slug that is unique by construction.
 *
 * Before this, `POST /api/orgs` answered 409 "Slug already taken" when the
 * slugified name collided. The web derives a first-login org name from the
 * email prefix (or Google name), so the second "john@…" user to sign up was
 * stranded with no organization at all. Lead conversion (`routes/leads.ts`)
 * had its own `uniqueSlugFor` with a check-then-insert race. Both now call
 * `createOrganizationWithUniqueSlug`.
 *
 * Race safety: the candidate slug is inserted with `createMany({
 * skipDuplicates: true })`, which Prisma issues as `INSERT ... ON CONFLICT
 * DO NOTHING`. Two requests racing for "john" cannot both get it — the
 * `organizations_slug_unique` index decides — and the loser sees `count: 0`
 * and retries with a re-read set of taken slugs. Crucially this never
 * raises 23505, so it is safe INSIDE an interactive transaction: a unique
 * violation would abort the whole transaction (Postgres refuses every
 * further statement), which is why "catch 23505 and retry" cannot work for
 * a caller that, like org creation, also writes the owner membership in the
 * same transaction. See packages/database/DECISIONS.md §32.
 */
import { randomUUID } from 'node:crypto';
import type { organizations, PrismaTransactionClient } from '@bebest/database';
import { toSlug } from './slug.js';

/** Slugs that would shadow a literal path segment under `/api/orgs/*`
 * (`/orgs/me/...`, `/orgs/invitations/...`) or the web's `/orgs/new`. An org
 * with one of these slugs would be unreachable by `GET /orgs/:slug`. */
export const RESERVED_ORG_SLUGS: ReadonlySet<string> = new Set(['me', 'invitations', 'new']);

/** What an explicit, client-chosen slug must look like — exactly the
 * alphabet `toSlug` produces (lowercase alphanumerics, single hyphens, no
 * leading/trailing hyphen). */
export const ORG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Upper bound on insert attempts. Each attempt re-reads the taken set, so
 * exhausting this needs that many concurrent winners in a row. */
const MAX_ATTEMPTS = 5;

/** Bound on the "which suffixes are taken" read. */
const TAKEN_SCAN_LIMIT = 1000;

export class OrgSlugTakenError extends Error {
  constructor(public readonly slug: string) {
    super(`Organization slug "${slug}" is already taken`);
    this.name = 'OrgSlugTakenError';
  }
}

/** `base` if free, else the lowest `base-N` (N >= 2) not in `taken`. */
export function pickFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base) && !RESERVED_ORG_SLUGS.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate) && !RESERVED_ORG_SLUGS.has(candidate)) return candidate;
  }
}

export interface CreateOrganizationInput {
  name: string;
  /** Explicit slug from the client. Defaults to `toSlug(name)`; callers
   * must have rejected names that slugify to '' (`isSluggable`). */
  slug?: string;
  /** When true, the exact slug or nothing: a collision throws
   * `OrgSlugTakenError` instead of being resolved with a suffix. */
  strict?: boolean;
  createdBy: string;
  kind?: 'customer' | 'agency' | 'internal';
}

export async function createOrganizationWithUniqueSlug(
  tx: PrismaTransactionClient,
  input: CreateOrganizationInput,
): Promise<organizations> {
  const base = input.slug ?? toSlug(input.name);
  if (!base) throw new Error('createOrganizationWithUniqueSlug: empty slug');
  if (input.strict && RESERVED_ORG_SLUGS.has(base)) throw new OrgSlugTakenError(base);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const rows = await tx.organizations.findMany({
      where: { OR: [{ slug: base }, { slug: { startsWith: `${base}-` } }] },
      select: { slug: true },
      take: TAKEN_SCAN_LIMIT,
    });
    const taken = new Set(rows.map((r) => r.slug));

    if (input.strict && taken.has(base)) throw new OrgSlugTakenError(base);
    const candidate = input.strict ? base : pickFreeSlug(base, taken);

    const id = randomUUID();
    const { count } = await tx.organizations.createMany({
      data: [
        {
          id,
          name: input.name,
          slug: candidate,
          created_by: input.createdBy,
          ...(input.kind ? { kind: input.kind } : {}),
        },
      ],
      skipDuplicates: true,
    });
    if (count === 1) return tx.organizations.findUniqueOrThrow({ where: { id } });

    // Lost a race for `candidate` (someone committed it between our read
    // and our insert). Strict callers asked for exactly this slug.
    if (input.strict) throw new OrgSlugTakenError(base);
  }

  throw new Error(`Could not allocate a unique organization slug for "${base}" after ${MAX_ATTEMPTS} attempts`);
}
