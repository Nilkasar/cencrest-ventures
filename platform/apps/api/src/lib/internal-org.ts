/**
 * Epic 1 (CRM) — resolves the id of the internal BeBest operations
 * organization: the single, fixed tenant that `leads`/`deals`/`activities`
 * are always RLS-scoped to (see @bebest/database schema.prisma's "Epic 1
 * (CRM) additions" comment and DECISIONS.md's "Epic 1 — CRM" section for
 * the full reasoning).
 *
 * This is deliberately just an env var read, not a `slug` lookup against
 * `organizations` on every request — a fixed UUID is one fewer query per
 * CRM request and cannot be spoofed by creating a same-slug org later.
 * Whoever deploys this needs to create ONE `organizations` row for BeBest's
 * own internal use (e.g. via the existing `POST /api/orgs` endpoint — there
 * is no seed script for this in Epic 0 or here) and set its id here.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MissingInternalOrgConfigError extends Error {
  constructor() {
    super(
      'CRM_INTERNAL_ORG_ID is not set (or is not a valid UUID). The CRM ' +
        "routes need this to know which organization is BeBest's own " +
        'internal operations tenant — see apps/api/README.md.',
    );
    this.name = 'MissingInternalOrgConfigError';
  }
}

/** Reads fresh from `process.env` on every call (not cached at module load)
 * so tests can set/unset it per-case without module-reset gymnastics — this
 * is called at most once per CRM request, so the cost is negligible. */
export function getInternalOrgId(): string {
  const id = process.env.CRM_INTERNAL_ORG_ID;
  if (!id || !UUID_RE.test(id)) {
    throw new MissingInternalOrgConfigError();
  }
  return id;
}
