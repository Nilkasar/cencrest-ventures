import { describe, expect, it, afterEach } from 'vitest';
import { resolveMeteringOrgId } from './attribution.js';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const INTERNAL_ORG = '99999999-9999-4999-8999-999999999999';

afterEach(() => {
  delete process.env.CRM_INTERNAL_ORG_ID;
});

describe('resolveMeteringOrgId', () => {
  it('uses the caller-supplied org when there is one, never the internal org', () => {
    process.env.CRM_INTERNAL_ORG_ID = INTERNAL_ORG;
    expect(resolveMeteringOrgId({ organizationId: ORG_A, feature: 'ai_visibility_run' })).toBe(ORG_A);
  });

  it('falls back to the internal BeBest org for unattributed (anonymous free-snapshot) spend', () => {
    process.env.CRM_INTERNAL_ORG_ID = INTERNAL_ORG;
    expect(resolveMeteringOrgId({ organizationId: null, feature: 'free_snapshot' })).toBe(INTERNAL_ORG);
  });

  it('treats an empty-string org as unattributed rather than attempting a write with it', () => {
    process.env.CRM_INTERNAL_ORG_ID = INTERNAL_ORG;
    expect(resolveMeteringOrgId({ organizationId: '', feature: 'free_snapshot' })).toBe(INTERNAL_ORG);
  });

  it('returns null (caller must skip the write) when the internal org is unconfigured', () => {
    expect(resolveMeteringOrgId({ organizationId: null, feature: 'free_snapshot' })).toBeNull();
  });

  it('returns null rather than throwing when CRM_INTERNAL_ORG_ID is not a UUID', () => {
    process.env.CRM_INTERNAL_ORG_ID = 'bebest-internal';
    expect(resolveMeteringOrgId({ organizationId: null, feature: 'free_snapshot' })).toBeNull();
  });
});
