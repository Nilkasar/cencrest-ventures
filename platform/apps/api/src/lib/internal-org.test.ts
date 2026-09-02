import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { getInternalOrgId, MissingInternalOrgConfigError } from './internal-org.js';

const ORIGINAL = process.env.CRM_INTERNAL_ORG_ID;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRM_INTERNAL_ORG_ID;
  else process.env.CRM_INTERNAL_ORG_ID = ORIGINAL;
});

describe('getInternalOrgId', () => {
  beforeEach(() => {
    delete process.env.CRM_INTERNAL_ORG_ID;
  });

  it('throws MissingInternalOrgConfigError when unset', () => {
    expect(() => getInternalOrgId()).toThrow(MissingInternalOrgConfigError);
  });

  it('throws when set to something that is not a UUID', () => {
    process.env.CRM_INTERNAL_ORG_ID = 'bebest-internal';
    expect(() => getInternalOrgId()).toThrow(MissingInternalOrgConfigError);
  });

  it('returns the id when set to a valid UUID', () => {
    process.env.CRM_INTERNAL_ORG_ID = '11111111-1111-1111-1111-111111111111';
    expect(getInternalOrgId()).toBe('11111111-1111-1111-1111-111111111111');
  });
});
