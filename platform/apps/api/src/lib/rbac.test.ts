import { describe, expect, it } from 'vitest';
import { isAtLeast, hasPermission } from './rbac.js';
import type { role } from '@bebest/database';

describe('isAtLeast — role hierarchy', () => {
  it('owner outranks everyone', () => {
    const others: role[] = ['admin', 'analyst', 'editor', 'viewer'];
    for (const r of others) expect(isAtLeast('owner', r)).toBe(true);
  });

  it('viewer does not outrank anyone above it', () => {
    const above: role[] = ['owner', 'admin', 'analyst', 'editor'];
    for (const r of above) expect(isAtLeast('viewer', r)).toBe(false);
  });

  it('analyst and editor are the same tier (neither outranks the other)', () => {
    expect(isAtLeast('analyst', 'editor')).toBe(true); // equal rank counts as "at least"
    expect(isAtLeast('editor', 'analyst')).toBe(true);
  });

  it('a role always satisfies a requirement of itself', () => {
    const roles: role[] = ['owner', 'admin', 'analyst', 'editor', 'viewer'];
    for (const r of roles) expect(isAtLeast(r, r)).toBe(true);
  });
});

describe('hasPermission — the SECURITY.md permission matrix', () => {
  it('matches the documented matrix for view_intelligence (everyone)', () => {
    const roles: role[] = ['owner', 'admin', 'analyst', 'editor', 'viewer'];
    for (const r of roles) expect(hasPermission(r, 'view_intelligence')).toBe(true);
  });

  it('only owner/admin/analyst can create a brand profile', () => {
    expect(hasPermission('owner', 'create_brand_profile')).toBe(true);
    expect(hasPermission('admin', 'create_brand_profile')).toBe(true);
    expect(hasPermission('analyst', 'create_brand_profile')).toBe(true);
    expect(hasPermission('editor', 'create_brand_profile')).toBe(false);
    expect(hasPermission('viewer', 'create_brand_profile')).toBe(false);
  });

  it('only owner/admin/analyst can run AI analysis', () => {
    expect(hasPermission('analyst', 'run_ai_analysis')).toBe(true);
    expect(hasPermission('editor', 'run_ai_analysis')).toBe(false);
  });

  it('editor can approve content ONLY when it is their own resource', () => {
    expect(hasPermission('editor', 'approve_content', { isOwnResource: true })).toBe(true);
    expect(hasPermission('editor', 'approve_content', { isOwnResource: false })).toBe(false);
    expect(hasPermission('editor', 'approve_content')).toBe(false); // default: not own
  });

  it('owner/admin can approve content regardless of ownership', () => {
    expect(hasPermission('owner', 'approve_content')).toBe(true);
    expect(hasPermission('admin', 'approve_content', { isOwnResource: false })).toBe(true);
  });

  it('analyst can never approve content (not in the matrix at all)', () => {
    expect(hasPermission('analyst', 'approve_content', { isOwnResource: true })).toBe(false);
  });

  it('only owner/admin can publish content', () => {
    expect(hasPermission('owner', 'publish_content')).toBe(true);
    expect(hasPermission('admin', 'publish_content')).toBe(true);
    expect(hasPermission('analyst', 'publish_content')).toBe(false);
    expect(hasPermission('editor', 'publish_content')).toBe(false);
  });

  it('only owner/admin can manage integrations or the team', () => {
    for (const action of ['manage_integrations', 'manage_team'] as const) {
      expect(hasPermission('owner', action)).toBe(true);
      expect(hasPermission('admin', action)).toBe(true);
      expect(hasPermission('analyst', action)).toBe(false);
      expect(hasPermission('viewer', action)).toBe(false);
    }
  });

  it('only owner can manage billing or delete the organization', () => {
    for (const action of ['manage_billing', 'delete_organization'] as const) {
      expect(hasPermission('owner', action)).toBe(true);
      expect(hasPermission('admin', action)).toBe(false);
    }
  });

  it('only owner/admin can trigger autonomous actions', () => {
    expect(hasPermission('owner', 'autonomous_actions')).toBe(true);
    expect(hasPermission('admin', 'autonomous_actions')).toBe(true);
    expect(hasPermission('analyst', 'autonomous_actions')).toBe(false);
  });

  it('the deprecated "member" alias behaves like analyst for hierarchy purposes', () => {
    expect(isAtLeast('member', 'viewer')).toBe(true);
    expect(isAtLeast('member', 'admin')).toBe(false);
  });

  describe('Epic 1 (CRM) actions', () => {
    it('everyone (including viewer) can view the CRM', () => {
      const roles: role[] = ['owner', 'admin', 'analyst', 'editor', 'viewer'];
      for (const r of roles) expect(hasPermission(r, 'view_crm')).toBe(true);
    });

    it('only owner/admin/analyst can manage leads or deals', () => {
      for (const action of ['manage_leads', 'manage_deals'] as const) {
        expect(hasPermission('owner', action)).toBe(true);
        expect(hasPermission('admin', action)).toBe(true);
        expect(hasPermission('analyst', action)).toBe(true);
        expect(hasPermission('editor', action)).toBe(false);
        expect(hasPermission('viewer', action)).toBe(false);
      }
    });

    it('editor can log CRM activities even though they cannot manage leads/deals', () => {
      expect(hasPermission('editor', 'log_crm_activities')).toBe(true);
      expect(hasPermission('editor', 'manage_leads')).toBe(false);
      expect(hasPermission('editor', 'manage_deals')).toBe(false);
    });

    it('viewer cannot log CRM activities', () => {
      expect(hasPermission('viewer', 'log_crm_activities')).toBe(false);
    });
  });
});
