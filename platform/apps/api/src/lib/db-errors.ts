/**
 * Translating database-level failures into the answer the caller deserves.
 *
 * Some Postgres errors are not server faults at all — they are the database
 * restating, late and in its own vocabulary, that the request was malformed.
 * Left alone they surface as a 500, which tells the caller nothing and
 * points an on-call engineer at the wrong thing.
 *
 * The one that mattered most here: every `:id` route across the API passed
 * its path parameter straight into a `where` clause. A parameter that is
 * not a UUID makes Postgres raise `22P02 invalid input syntax for type
 * uuid` — so `GET /leads/not-a-uuid` (and the same on 60 other route sites)
 * answered 500 for what is simply a record that cannot exist. Handlers now
 * validate the parameter up front (`lib/http-params.ts`), and this is the
 * backstop for every path that doesn't, including ones added later.
 *
 * Deliberately narrow. Anything not recognised here keeps propagating to
 * the 500 handler untouched — a mapping that swallows real faults is worse
 * than no mapping.
 */

/** Postgres SQLSTATEs that mean "the request was malformed", not "we broke". */
const CLIENT_FAULT_SQLSTATES = new Map<string, { status: 400 | 404 | 409 | 422; error: string }>([
  // invalid_text_representation — e.g. 'not-a-uuid'::uuid. A value that
  // cannot be a key cannot name a row.
  ['22P02', { status: 404, error: 'Not found' }],
  // string_data_right_truncation — a value longer than its column. Field
  // bounds should catch this first; if one is missing, say which side was
  // wrong rather than blaming the server.
  ['22001', { status: 422, error: 'A value is too long for its field' }],
  // numeric_value_out_of_range — e.g. an amount beyond a 32-bit integer.
  ['22003', { status: 422, error: 'A numeric value is out of range' }],
  // unique_violation — the row already exists.
  ['23505', { status: 409, error: 'That record already exists' }],
  // foreign_key_violation — a referenced record does not exist.
  ['23503', { status: 422, error: 'A referenced record does not exist' }],
  // check_violation — a value the schema's own CHECK constraints refuse.
  ['23514', { status: 422, error: 'A value is not allowed for this field' }],
]);

/**
 * Digs the SQLSTATE out of whatever wrapper it arrived in.
 *
 * Prisma reports driver errors inconsistently depending on the path taken:
 * a `PrismaClientKnownRequestError` carries `meta.code`, while a raw or
 * adapter-surfaced error stringifies the underlying `PostgresError { code:
 * "22P02", ... }` into the message. Both are checked, and a plain `code`
 * property (what node-postgres itself sets) is checked first.
 */
export function postgresErrorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;

  const candidate = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown };

  if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
    return candidate.code;
  }
  if (typeof candidate.meta?.code === 'string') return candidate.meta.code;

  if (typeof candidate.message === 'string') {
    const match = /PostgresError\s*\{[^}]*code:\s*"([0-9A-Z]{5})"/.exec(candidate.message);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * The response a database error should produce, or `null` when it is a
 * genuine server fault that must keep bubbling to the 500 handler.
 */
export function clientFaultResponse(
  err: unknown,
): { status: 400 | 404 | 409 | 422; error: string } | null {
  const code = postgresErrorCode(err);
  return code ? (CLIENT_FAULT_SQLSTATES.get(code) ?? null) : null;
}
