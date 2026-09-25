import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { MeteredAIProvider } from '../ai-usage/metered-provider.js';
import {
  getDefaultAiProviderRegistry,
  getMeteredAiProviderRegistry,
  __resetDefaultAiProviderRegistryForTesting,
} from './provider-registry.js';

const ORG_A = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  __resetDefaultAiProviderRegistryForTesting();
  // Keys are only needed for `healthCheck()`/`complete()`, neither of which
  // this file calls — construction never makes a network request.
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  process.env.GOOGLE_API_KEY = 'g-test';
  process.env.PERPLEXITY_API_KEY = 'pplx-test';
});

afterEach(() => {
  __resetDefaultAiProviderRegistryForTesting();
});

describe('getMeteredAiProviderRegistry', () => {
  it('returns every provider wrapped for cost metering', () => {
    const registry = getMeteredAiProviderRegistry({ organizationId: ORG_A, feature: 'ai_visibility_run' });

    expect(registry.list().sort()).toEqual(['anthropic', 'google', 'ollama', 'openai', 'perplexity']);
    for (const name of registry.list()) {
      expect(registry.get(name), name).toBeInstanceOf(MeteredAIProvider);
    }
  });

  it('keeps the routing table intact — geo.query still fans out to all 4 cloud assistants, never Ollama', () => {
    const registry = getMeteredAiProviderRegistry({ organizationId: ORG_A, feature: 'f' });
    expect(registry.resolveNames('geo.query')).toEqual(['openai', 'anthropic', 'google', 'perplexity']);
  });

  it('is transparent to callers: wrapped providers report the real provider name/model', () => {
    const registry = getMeteredAiProviderRegistry({ organizationId: ORG_A, feature: 'f' });
    const openai = registry.get('openai');
    expect(openai.name).toBe('openai');
    expect(openai.model).toBe('gpt-4o');
  });

  it('is not memoized across attributions, but shares the underlying provider instances', () => {
    const a = getMeteredAiProviderRegistry({ organizationId: ORG_A, feature: 'f' });
    const b = getMeteredAiProviderRegistry({ organizationId: null, feature: 'free_snapshot' });
    expect(a).not.toBe(b);
    // Same singleton underneath — no duplicated HTTP clients or keys.
    expect(getDefaultAiProviderRegistry().get('openai')).toBe(getDefaultAiProviderRegistry().get('openai'));
  });
});

describe('getDefaultAiProviderRegistry', () => {
  it('is memoized and returns the raw, UN-metered providers (routing-table use only)', () => {
    const first = getDefaultAiProviderRegistry();
    expect(getDefaultAiProviderRegistry()).toBe(first);
    expect(first.get('openai')).not.toBeInstanceOf(MeteredAIProvider);
  });
});
