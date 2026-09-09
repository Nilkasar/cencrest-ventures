import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { isUuid, uuidParam } from './http-params.js';

describe('isUuid', () => {
  it('accepts a UUID in either case', () => {
    expect(isUuid('9b3f7aa2-5208-41ad-9186-d4f34d39a4a2')).toBe(true);
    expect(isUuid('9B3F7AA2-5208-41AD-9186-D4F34D39A4A2')).toBe(true);
  });

  it('rejects everything that is not one', () => {
    for (const value of [
      'not-a-uuid',
      '',
      '123',
      '9b3f7aa2520841ad9186d4f34d39a4a2',
      '9b3f7aa2-5208-41ad-9186-d4f34d39a4a', // one char short
      "'; drop table leads; --",
    ]) {
      expect(isUuid(value)).toBe(false);
    }
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe('uuidParam', () => {
  async function paramFor(path: string): Promise<string | null> {
    const app = new Hono();
    let seen: string | null = null;
    app.get('/things/:id', (c) => {
      seen = uuidParam(c, 'id');
      return c.json({ ok: true });
    });
    await app.request(path);
    return seen;
  }

  it('returns the id when it is a UUID', async () => {
    await expect(paramFor('/things/9b3f7aa2-5208-41ad-9186-d4f34d39a4a2')).resolves.toBe(
      '9b3f7aa2-5208-41ad-9186-d4f34d39a4a2',
    );
  });

  // Before this existed, a non-UUID reached Prisma and Postgres answered
  // `22P02 invalid input syntax for type uuid` — surfacing as a 500 on
  // every `:id` route in the CRM.
  it('returns null for a malformed id so the caller can answer 404', async () => {
    await expect(paramFor('/things/not-a-uuid')).resolves.toBeNull();
  });
});
