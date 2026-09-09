/**
 * Epic 1 (CRM) — resolving the staff behind `assigned_to` / `owner_id` /
 * `actor_id`.
 *
 * Every CRM row stores a bare user id. Rendering "Ava Chen" instead of a
 * UUID used to be the client's problem, and the client solved it by calling
 * `GET /orgs` and then `GET /orgs/:slug/members` before it could draw a
 * single row — two extra network requests, serialized, on top of the list
 * request itself. Resolving the names here costs ONE extra query against
 * `users` (a table with no RLS, so no transaction is needed) and removes
 * both of those requests from the critical path.
 *
 * Deleted users are still returned: a lead assigned to someone who has
 * since left should show that person's name in history, not a blank.
 */
import { db } from '@bebest/database';

export interface UserRef {
  id: string;
  name: string;
  email: string;
}

/**
 * Looks up every distinct, non-null id in `ids`. Returns an empty map
 * (without touching the database) when there is nothing to resolve.
 */
export async function loadUserRefs(
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, UserRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const rows = await db.users.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/** The shape every CRM response uses for a person. `null` when the row has
 *  no id at all; a ref carrying just the id when the user record is gone,
 *  so the client never has to invent an "Unknown teammate" placeholder. */
export function userRef(
  id: string | null | undefined,
  refs: Map<string, UserRef>,
): UserRef | null {
  if (!id) return null;
  return refs.get(id) ?? { id, name: 'Unknown teammate', email: '' };
}
