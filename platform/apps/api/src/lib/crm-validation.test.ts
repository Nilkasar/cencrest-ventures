import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  MAX_VALUE_CENTS,
  SUPPORTED_CURRENCIES,
  containsInsensitive,
  currencyField,
  emailField,
  escapeLike,
  urlField,
  valueCentsField,
} from './crm-validation.js';

describe('field bounds match the columns behind them', () => {
  // Each of these was a 500 before: the schema accepted a value that
  // Postgres then rejected.
  it('rejects an email longer than the 255-char column', () => {
    const long = `${'a'.repeat(250)}@example.com`;
    expect(long.length).toBeGreaterThan(LIMITS.email);
    expect(emailField().safeParse(long).success).toBe(false);
  });

  it('accepts an ordinary email', () => {
    expect(emailField().safeParse('priya@northwind.com').success).toBe(true);
  });

  it('trims surrounding whitespace rather than storing it', () => {
    const parsed = emailField().parse('  priya@northwind.com  ');
    expect(parsed).toBe('priya@northwind.com');
  });

  it('rejects a website longer than its 500-char column', () => {
    const long = `https://example.com/${'a'.repeat(600)}`;
    expect(urlField(LIMITS.website).safeParse(long).success).toBe(false);
  });

  it('still accepts a long-but-valid source URL at its wider 2048 bound', () => {
    const url = `https://example.com/${'a'.repeat(1000)}`;
    expect(urlField(LIMITS.sourceUrl).safeParse(url).success).toBe(true);
  });

  it('rejects a private-network URL at any length (SSRF guard still applies)', () => {
    expect(urlField(LIMITS.website).safeParse('http://169.254.169.254/latest').success).toBe(false);
  });
});

describe('valueCents stays inside a 32-bit integer', () => {
  it('rejects a value beyond INTEGER range', () => {
    // 3,000,000,000 cents overflowed `deals.value_cents` and returned a 500.
    expect(valueCentsField().safeParse(3_000_000_000).success).toBe(false);
  });

  it('accepts the exact ceiling', () => {
    expect(valueCentsField().safeParse(MAX_VALUE_CENTS).success).toBe(true);
  });

  it('rejects negatives and fractions of a cent', () => {
    expect(valueCentsField().safeParse(-1).success).toBe(false);
    expect(valueCentsField().safeParse(10.5).success).toBe(false);
  });
});

describe('currency', () => {
  it('normalises case so sums do not split across spellings', () => {
    expect(currencyField().parse('usd')).toBe('USD');
    expect(currencyField().parse(' eur ')).toBe('EUR');
  });

  it('rejects a code that is not a currency this product transacts in', () => {
    // 'ZZZ' passed the old `.length(3)` check and was stored.
    expect(currencyField().safeParse('ZZZ').success).toBe(false);
  });

  it('accepts every supported currency', () => {
    for (const code of SUPPORTED_CURRENCIES) {
      expect(currencyField().safeParse(code).success).toBe(true);
    }
  });
});

describe('LIKE escaping', () => {
  // Prisma renders `contains` as SQL LIKE and does not escape LIKE's own
  // metacharacters, so `%` matched every row in the table.
  it('escapes the wildcards', () => {
    expect(escapeLike('%')).toBe('\\%');
    expect(escapeLike('_')).toBe('\\_');
    expect(escapeLike('100%')).toBe('100\\%');
  });

  it('escapes the escape character first, so it cannot be doubled up', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
    expect(escapeLike('\\%')).toBe('\\\\\\%');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('Northwind Logistics')).toBe('Northwind Logistics');
  });

  it('builds a case-insensitive filter with the escaped term', () => {
    expect(containsInsensitive('50%')).toEqual({ contains: '50\\%', mode: 'insensitive' });
  });
});
