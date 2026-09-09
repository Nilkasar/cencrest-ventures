import { describe, expect, it } from 'vitest';
import { isSluggable, toSlug } from './slug.js';

describe('toSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(toSlug('Northwind Logistics')).toBe('northwind-logistics');
  });

  it('drops punctuation and collapses separators', () => {
    expect(toSlug('Acme,  Inc.')).toBe('acme-inc');
  });

  it('does not leave a leading or trailing hyphen', () => {
    // '- acme -' used to slugify to '-acme-', an ugly and needlessly
    // distinct slug from 'acme'.
    expect(toSlug('- Acme -')).toBe('acme');
    expect(toSlug('!Acme!')).toBe('acme');
  });

  it('caps length', () => {
    expect(toSlug('a'.repeat(200)).length).toBe(60);
  });
});

describe('isSluggable', () => {
  // A name of pure punctuation slugified to '' and created an organization
  // with an empty slug — unreachable by every `:slug` route, and colliding
  // with the next such name on the unique index.
  it('rejects a name with nothing sluggable in it', () => {
    expect(isSluggable('!!!')).toBe(false);
    expect(isSluggable('   ')).toBe(false);
    expect(isSluggable('---')).toBe(false);
  });

  it('accepts anything containing a letter or a number', () => {
    expect(isSluggable('Acme')).toBe(true);
    expect(isSluggable('!42!')).toBe(true);
  });
});
