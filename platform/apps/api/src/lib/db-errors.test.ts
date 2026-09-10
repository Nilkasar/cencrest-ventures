import { describe, expect, it } from 'vitest';
import { clientFaultResponse, postgresErrorCode } from './db-errors.js';

/** How the pg driver itself reports an error. */
function driverError(code: string) {
  return Object.assign(new Error('boom'), { code });
}

/** How Prisma surfaces a driver error through the adapter: the underlying
 *  PostgresError is stringified into the message. */
function adapterError(code: string) {
  return new Error(
    `Invalid \`prisma.leads.findFirst()\` invocation:\n\nError occurred during query execution:\n` +
      `ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "${code}", ` +
      `message: "invalid input syntax", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })`,
  );
}

describe('postgresErrorCode', () => {
  it('reads a plain driver code', () => {
    expect(postgresErrorCode(driverError('22P02'))).toBe('22P02');
  });

  it('reads a code Prisma stringified into the message', () => {
    expect(postgresErrorCode(adapterError('23505'))).toBe('23505');
  });

  it('reads a code from Prisma meta', () => {
    expect(postgresErrorCode({ meta: { code: '23503' } })).toBe('23503');
  });

  it('returns null for anything else', () => {
    expect(postgresErrorCode(new Error('ordinary failure'))).toBeNull();
    expect(postgresErrorCode(null)).toBeNull();
    expect(postgresErrorCode('a string')).toBeNull();
    // A Node errno must not be mistaken for a SQLSTATE.
    expect(postgresErrorCode({ code: 'ECONNREFUSED' })).toBeNull();
  });
});

describe('clientFaultResponse', () => {
  // The one that mattered: every `:id` route passed its path parameter
  // straight into a `where`, so a non-UUID produced 22P02 and surfaced as a
  // 500 — on 60 route sites across the platform.
  it('maps a malformed UUID to 404, not 500', () => {
    expect(clientFaultResponse(adapterError('22P02'))).toEqual({ status: 404, error: 'Not found' });
  });

  it('maps an over-long value and an out-of-range number to 422', () => {
    expect(clientFaultResponse(driverError('22001'))?.status).toBe(422);
    expect(clientFaultResponse(driverError('22003'))?.status).toBe(422);
  });

  it('maps a duplicate to 409 and a bad reference or failed CHECK to 422', () => {
    expect(clientFaultResponse(driverError('23505'))?.status).toBe(409);
    expect(clientFaultResponse(driverError('23503'))?.status).toBe(422);
    expect(clientFaultResponse(driverError('23514'))?.status).toBe(422);
  });

  it('lets a genuine server fault keep bubbling', () => {
    // A mapping that swallows real faults is worse than no mapping. An RLS
    // refusal (42501), a connection failure, or an ordinary bug must all
    // still reach the 500 handler.
    expect(clientFaultResponse(driverError('42501'))).toBeNull();
    expect(clientFaultResponse(driverError('08006'))).toBeNull();
    expect(clientFaultResponse(new Error('undefined is not a function'))).toBeNull();
  });
});
