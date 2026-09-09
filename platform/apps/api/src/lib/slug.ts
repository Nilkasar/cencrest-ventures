/** Ported unchanged from api/src/lib/slug.ts — simple, correct, no reason
 * to change it for Epic 0. */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Whether a name yields a usable slug at all.
 *
 * A name made entirely of punctuation ("!!!", "…") slugifies to the empty
 * string, and an organization was happily created with `slug: ''` — a row
 * unreachable by every `:slug` route in the API, and one that collides with
 * the next such name on the unique index. Callers validate with this and
 * reject the name, rather than inventing one on the user's behalf.
 */
export function isSluggable(name: string): boolean {
  return toSlug(name).length > 0;
}
