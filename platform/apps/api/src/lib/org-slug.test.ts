import { describe, expect, it, vi } from 'vitest';
import {
  createOrganizationWithUniqueSlug,
  OrgSlugTakenError,
  pickFreeSlug,
  RESERVED_ORG_SLUGS,
} from './org-slug.js';

/**
 * An in-memory `organizations` table with a unique slug, mimicking what the
 * real `createMany({ skipDuplicates: true })` (INSERT … ON CONFLICT DO
 * NOTHING) does: a duplicate slug inserts nothing and reports count 0. Rows
 * in `committedByOthers` are invisible to the first `findMany` but present
 * at insert time — i.e. a concurrent transaction that committed between our
 * read and our insert.
 */
function fakeTx(existing: string[], raceSlugs: string[] = []) {
  const rows = new Map<string, { id: string; slug: string; name: string }>();
  for (const slug of existing) rows.set(slug, { id: `pre-${slug}`, slug, name: slug });
  const pendingRace = new Set(raceSlugs);

  const organizations = {
    findMany: vi.fn(async ({ where }: { where: { OR: [{ slug: string }, { slug: { startsWith: string } }] } }) => {
      const base = where.OR[0].slug;
      const prefix = where.OR[1].slug.startsWith;
      return [...rows.values()]
        .filter((r) => r.slug === base || r.slug.startsWith(prefix))
        .map((r) => ({ slug: r.slug }));
    }),
    createMany: vi.fn(async ({ data }: { data: { id: string; slug: string; name: string }[] }) => {
      const row = data[0]!;
      if (pendingRace.has(row.slug)) {
        // The racing transaction wins this slug.
        pendingRace.delete(row.slug);
        rows.set(row.slug, { id: `race-${row.slug}`, slug: row.slug, name: 'racer' });
        return { count: 0 };
      }
      if (rows.has(row.slug)) return { count: 0 };
      rows.set(row.slug, row);
      return { count: 1 };
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = [...rows.values()].find((r) => r.id === where.id);
      if (!found) throw new Error('not found');
      return found;
    }),
  };
  return { tx: { organizations } as never, organizations, rows };
}

describe('pickFreeSlug', () => {
  it('returns the base when it is free', () => {
    expect(pickFreeSlug('john', new Set())).toBe('john');
  });

  it('suffixes -2, -3… on collision, filling the lowest gap', () => {
    expect(pickFreeSlug('john', new Set(['john']))).toBe('john-2');
    expect(pickFreeSlug('john', new Set(['john', 'john-2', 'john-4']))).toBe('john-3');
  });

  it('never returns a reserved slug', () => {
    for (const reserved of RESERVED_ORG_SLUGS) {
      expect(pickFreeSlug(reserved, new Set())).toBe(`${reserved}-2`);
    }
  });
});

describe('createOrganizationWithUniqueSlug', () => {
  it('uses the slugified name when free', async () => {
    const { tx } = fakeTx([]);
    const org = await createOrganizationWithUniqueSlug(tx, { name: 'John', createdBy: 'u1' });
    expect(org.slug).toBe('john');
  });

  it('second "john" gets john-2 instead of a 409 (the first-login strand)', async () => {
    const { tx } = fakeTx(['john']);
    const org = await createOrganizationWithUniqueSlug(tx, { name: 'john', createdBy: 'u2' });
    expect(org.slug).toBe('john-2');
  });

  it('resolves a collision on an explicit client slug too', async () => {
    const { tx } = fakeTx(['acme']);
    const org = await createOrganizationWithUniqueSlug(tx, { name: 'Anything', slug: 'acme', createdBy: 'u1' });
    expect(org.slug).toBe('acme-2');
  });

  it('strict mode: exact slug or OrgSlugTakenError', async () => {
    const { tx } = fakeTx(['acme']);
    await expect(
      createOrganizationWithUniqueSlug(tx, { name: 'Acme', slug: 'acme', strict: true, createdBy: 'u1' }),
    ).rejects.toBeInstanceOf(OrgSlugTakenError);
  });

  it('strict mode refuses a reserved slug', async () => {
    const { tx } = fakeTx([]);
    await expect(
      createOrganizationWithUniqueSlug(tx, { name: 'Me', slug: 'me', strict: true, createdBy: 'u1' }),
    ).rejects.toBeInstanceOf(OrgSlugTakenError);
  });

  it('race: a concurrent winner takes the candidate between read and insert → retries with the next suffix', async () => {
    // Our read sees only "john"; by insert time a racer has committed "john-2".
    const { tx, organizations } = fakeTx(['john'], ['john-2']);
    const org = await createOrganizationWithUniqueSlug(tx, { name: 'John', createdBy: 'u3' });
    expect(org.slug).toBe('john-3');
    expect(organizations.createMany).toHaveBeenCalledTimes(2);
    // Every insert is ON CONFLICT DO NOTHING — never a plain create that
    // would raise 23505 and abort the caller's transaction.
    for (const call of organizations.createMany.mock.calls) {
      expect(call[0]).toMatchObject({ skipDuplicates: true });
    }
  });

  it('race in strict mode → OrgSlugTakenError, no retry', async () => {
    const { tx, organizations } = fakeTx([], ['acme']);
    await expect(
      createOrganizationWithUniqueSlug(tx, { name: 'Acme', slug: 'acme', strict: true, createdBy: 'u1' }),
    ).rejects.toBeInstanceOf(OrgSlugTakenError);
    expect(organizations.createMany).toHaveBeenCalledTimes(1);
  });

  it('gives up after a bounded number of lost races instead of spinning', async () => {
    const { tx, organizations } = fakeTx([], ['x', 'x-2', 'x-3', 'x-4', 'x-5', 'x-6']);
    await expect(createOrganizationWithUniqueSlug(tx, { name: 'x', createdBy: 'u1' })).rejects.toThrow(
      /Could not allocate/,
    );
    expect(organizations.createMany).toHaveBeenCalledTimes(5);
  });

  it('passes kind through when given', async () => {
    const { tx, organizations } = fakeTx([]);
    await createOrganizationWithUniqueSlug(tx, { name: 'Agency Co', createdBy: 'u1', kind: 'agency' });
    expect(organizations.createMany.mock.calls[0]![0].data[0]).toMatchObject({ kind: 'agency' });
  });
});
