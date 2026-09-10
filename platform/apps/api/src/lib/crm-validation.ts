/**
 * Epic 1 (CRM) — validation bounds that mirror the actual database columns,
 * and the reference checks the schema alone cannot express.
 *
 * Every limit here exists because the previous bound disagreed with the
 * column behind it, and Postgres — not the API — was the thing that said
 * no. That surfaced to callers as a 500 on an ordinary bad input:
 *
 *   - `leads.email` is VARCHAR(255); the schema validated the format but
 *     not the length, so a long address returned `22001 value too long`.
 *   - `leads.website` is VARCHAR(500) while the field allowed 2048.
 *   - `deals.value_cents` is a 32-bit INTEGER; an unbounded `.min(0)` let a
 *     mistyped amount overflow into `22003 integer out of range`.
 *   - `notes` / `lost_reason` / activity `body` are TEXT and had no bound at
 *     all, so a single request could store an unbounded blob.
 *
 * Keep these in step with `packages/database/prisma/schema.prisma`. A
 * column that shrinks without its bound shrinking here is a 500 waiting to
 * be typed into a form.
 */
import { z } from 'zod';
import type { PrismaTransactionClient } from '@bebest/database';
import { isSafePublicHttpUrl } from './ssrf-guard.js';

/** `deals.value_cents` is INTEGER: 2,147,483,647 cents ≈ $21.47M. */
export const MAX_VALUE_CENTS = 2_147_483_647;

/** Column widths, named so a reader can check them against the schema. */
export const LIMITS = {
  email: 255,
  name: 255,
  company: 255,
  website: 500,
  sourceUrl: 2048,
  category: 100,
  dealTitle: 255,
  activitySubject: 500,
  /** TEXT columns. Bounded here purely to keep one request from storing an
   *  unbounded blob — generous enough that no honest note is truncated. */
  notes: 20_000,
  lostReason: 2_000,
  activityBody: 20_000,
} as const;

export const emailField = () => z.string().trim().email().max(LIMITS.email);

/**
 * An absolute, public http(s) URL that also fits its column. `maxLength`
 * differs per field (`leads.website` is 500, `leads.source_url` is 2048),
 * so it is always passed explicitly rather than defaulted.
 */
export const urlField = (maxLength: number) =>
  z
    .string()
    .trim()
    .url()
    .max(maxLength)
    .refine(isSafePublicHttpUrl, { message: 'Must be a public http(s) URL' });

/**
 * Currencies this product actually transacts in.
 *
 * Previously any three characters passed, so `ZZZ` was accepted and stored,
 * and `usd` and `USD` produced two spellings of the same currency in the
 * same table — enough to make any sum across deals wrong. Input is
 * upper-cased before the check so callers may send either case.
 */
export const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'AUD',
  'CAD',
  'SGD',
  'AED',
] as const;

export const currencyField = () =>
  z
    .string()
    .trim()
    .toUpperCase()
    .pipe(
      z.enum(SUPPORTED_CURRENCIES, {
        errorMap: () => ({
          message: `Unsupported currency. Expected one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
        }),
      }),
    );

export const valueCentsField = () => z.number().int().min(0).max(MAX_VALUE_CENTS);

/**
 * Escapes a user's search text for use inside a `contains` filter.
 *
 * Prisma renders `contains` as a SQL `LIKE`, and passes the value through
 * as a parameter without escaping LIKE's own metacharacters. The value is
 * therefore safe from injection but not from being *interpreted*: searching
 * for `%` matched every row in the table, and a perfectly ordinary query
 * like "50% discount" silently matched things it shouldn't. Postgres's LIKE
 * uses backslash as its default escape character, so escaping the
 * backslash first and then the two wildcards is sufficient.
 */
export function escapeLike(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** A case-insensitive `contains` filter over user-supplied search text. */
export function containsInsensitive(term: string) {
  return { contains: escapeLike(term), mode: 'insensitive' as const };
}

// ---------------------------------------------------------------------------
// Reference checks
//
// A UUID that parses is not a UUID that exists. Every one of these used to
// reach Postgres unchecked and come back as a foreign-key violation — a 500
// for what is really "that person/record isn't there", which the caller can
// act on.

export class ReferenceError_ extends Error {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = 'ReferenceError_';
  }
}

/**
 * Confirms every given user id belongs to the internal operations org.
 *
 * Deliberately stricter than "this user row exists": a CRM lead assignee or
 * deal owner is BeBest staff, so pointing one at an arbitrary customer's
 * user account is not a typo to be stored, it is wrong. Runs inside the
 * caller's existing transaction, so it costs one query, not a round trip
 * plus a transaction of its own.
 */
export async function assertInternalStaff(
  tx: PrismaTransactionClient,
  internalOrgId: string,
  userIds: (string | null | undefined)[],
  label: string,
): Promise<void> {
  const unique = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return;

  const found = await tx.memberships.findMany({
    where: { organization_id: internalOrgId, user_id: { in: unique } },
    select: { user_id: true },
  });
  const known = new Set(found.map((row) => row.user_id));
  const missing = unique.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new ReferenceError_(`${label} does not refer to a member of the CRM workspace`);
  }
}

/** Confirms an organization exists and has not been soft-deleted. */
export async function assertOrganizationExists(
  tx: PrismaTransactionClient,
  organizationId: string | null | undefined,
  label: string,
): Promise<void> {
  if (!organizationId) return;
  const org = await tx.organizations.findUnique({
    where: { id: organizationId },
    select: { deleted_at: true },
  });
  if (!org || org.deleted_at) {
    throw new ReferenceError_(`${label} does not refer to an existing organization`);
  }
}

/** Confirms a lead exists and has not been soft-deleted. */
export async function assertLeadExists(
  tx: PrismaTransactionClient,
  leadId: string | null | undefined,
  label: string,
): Promise<void> {
  if (!leadId) return;
  const lead = await tx.leads.findFirst({
    where: { id: leadId, deleted_at: null },
    select: { id: true },
  });
  if (!lead) throw new ReferenceError_(`${label} does not refer to an existing lead`);
}
