import { describe, expect, it } from 'vitest';
import { buildCapabilities, type LiveChecks } from './capabilities.js';

function healthy(): LiveChecks {
  return {
    ai: {
      openai: { configured: true, healthy: true },
      anthropic: { configured: true, healthy: true },
      google: { configured: true, healthy: true },
      perplexity: { configured: true, healthy: true },
    },
    ollama: { baseUrl: 'http://localhost:11434', healthy: true },
    jwtKeys: true,
    appUrl: true,
    resend: true,
    googleOAuth: { clientId: true, clientSecret: true, stateSecret: true },
    paymentProviderIsNull: false,
    billingWebhookSecret: true,
    publishTargetIsNull: false,
    jobQueue: 'PgBossJobQueue',
    jobQueueDurable: true,
    errorTracker: 'SentryErrorTracker',
    errorTrackerIsConsole: false,
    rls: { enforced: true, role: 'bebest_app', detail: 'ok' },
    crmInternalOrg: true,
    platformDb: { configured: true, reachable: true },
  };
}

function byKey(checks: LiveChecks) {
  return Object.fromEntries(buildCapabilities(checks).map((c) => [c.key, c]));
}

const REQUIRED_KEYS = [
  'onboarding', 'query_universe', 'ai_visibility', 'website_crawler', 'seo_intelligence', 'competitors',
  'opportunities', 'recommendations', 'agents', 'publishing', 'measurement', 'content_drafts', 'reports',
  'notifications', 'billing', 'connectors', 'agency', 'white_label', 'crm', 'free_snapshot', 'background_jobs',
  'scheduling', 'tenant_isolation', 'error_tracking',
];

describe('buildCapabilities', () => {
  it('covers every capability the epic names, once each, with a valid status', () => {
    const list = buildCapabilities(healthy());
    const keys = list.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of REQUIRED_KEYS) expect(keys).toContain(k);
    for (const c of list) {
      expect(['working', 'partial', 'blocked', 'stub']).toContain(c.status);
      expect(c.name && c.group && c.summary).toBeTruthy();
    }
  });

  it('with every dependency healthy, only the static code-audit gaps keep anything from working', () => {
    const caps = byKey(healthy());
    expect(caps.ai_visibility!.status).toBe('working');
    expect(caps.background_jobs!.status).toBe('working');
    expect(caps.publishing!.status).toBe('working');
    expect(caps.billing!.status).toBe('working');
    // Static facts: these cannot be observed at runtime, so they stay put.
    expect(caps.scheduling!.status).toBe('stub');
    expect(caps.measurement!.status).toBe('partial');
    expect(caps.white_label!.status).toBe('partial');
    expect(caps.measurement!.dependencies.find((d) => d.key === 'measurement.scheduler')!.source).toBe('static');
  });

  it('no AI keys at all → AI-dependent capabilities are blocked, with the reason per provider', () => {
    const checks = healthy();
    for (const p of ['openai', 'anthropic', 'google', 'perplexity'] as const) checks.ai[p] = { configured: false, healthy: false };
    const caps = byKey(checks);
    for (const k of ['ai_visibility', 'competitors', 'agents', 'free_snapshot']) expect(caps[k]!.status).toBe('blocked');
    const all = caps.ai_visibility!.dependencies.find((d) => d.key === 'ai.geo_all')!;
    expect(all.detail).toContain('openai: no API key configured');
    // Content falls back to Ollama, which is up.
    expect(caps.content_drafts!.status).toBe('working');
  });

  it('some AI providers healthy → partial, not blocked; a timed-out check reads as not healthy', () => {
    const checks = healthy();
    checks.ai.google = { configured: true, healthy: null };
    checks.ai.perplexity = { configured: false, healthy: false };
    const caps = byKey(checks);
    expect(caps.ai_visibility!.status).toBe('partial');
    expect(caps.ai_visibility!.dependencies.find((d) => d.key === 'ai.geo_all')!.detail).toContain('timed out');
  });

  it('Ollama down → extraction is required, so AI visibility is blocked', () => {
    const checks = healthy();
    checks.ollama.healthy = false;
    expect(byKey(checks).ai_visibility!.status).toBe('blocked');
  });

  it('Null payment provider / publish target → stub', () => {
    const checks = healthy();
    checks.paymentProviderIsNull = true;
    checks.publishTargetIsNull = true;
    const caps = byKey(checks);
    expect(caps.billing!.status).toBe('stub');
    expect(caps.publishing!.status).toBe('stub');
  });

  it('in-memory queue → background jobs partial with the serverless caveat; console tracker → partial', () => {
    const checks = healthy();
    checks.jobQueue = 'InMemoryJobQueue';
    checks.jobQueueDurable = false;
    checks.errorTracker = 'ConsoleErrorTracker';
    checks.errorTrackerIsConsole = true;
    const caps = byKey(checks);
    expect(caps.background_jobs!.status).toBe('partial');
    expect(caps.background_jobs!.dependencies[0]!.detail).toContain('not durable on serverless');
    expect(caps.website_crawler!.status).toBe('partial');
    expect(caps.error_tracking!.status).toBe('partial');
  });

  it('RLS not enforced → tenant isolation blocked; probe unanswered → partial', () => {
    const checks = healthy();
    checks.rls = { enforced: false, role: 'neondb_owner', detail: 'has BYPASSRLS' };
    expect(byKey(checks).tenant_isolation!.status).toBe('blocked');
    checks.rls = { enforced: null, role: null, detail: 'timed out' };
    expect(byKey(checks).tenant_isolation!.status).toBe('partial');
  });

  it('platform DB configured but the probe timed out → partial (unknown), failed → blocked', () => {
    const checks = healthy();
    checks.platformDb = { configured: true, reachable: null };
    expect(byKey(checks).platform_view!.status).toBe('partial');
    checks.platformDb = { configured: true, reachable: false };
    expect(byKey(checks).platform_view!.status).toBe('blocked');
  });

  it('PLATFORM_DATABASE_URL unset / CRM_INTERNAL_ORG_ID unset / no Resend', () => {
    const checks = healthy();
    checks.platformDb = { configured: false, reachable: null };
    checks.crmInternalOrg = false;
    checks.resend = false;
    const caps = byKey(checks);
    expect(caps.platform_view!.status).toBe('blocked');
    expect(caps.platform_view!.dependencies[0]!.detail).toContain('503');
    expect(caps.crm!.status).toBe('blocked');
    expect(caps.notifications!.status).toBe('partial');
    expect(caps.onboarding!.status).toBe('blocked'); // magic links cannot be delivered
  });
});
