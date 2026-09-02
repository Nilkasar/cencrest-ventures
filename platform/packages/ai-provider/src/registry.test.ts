import { describe, expect, it, vi } from 'vitest';
import type { AIProvider } from './types.js';
import { NoAvailableProviderError, ProviderNotRegisteredError } from './errors.js';
import { AIProviderRegistry, DEFAULT_TASK_DEFAULTS } from './registry.js';

function fakeProvider(name: string, healthy: boolean): AIProvider {
  return {
    name,
    model: `${name}-model`,
    complete: vi.fn(),
    extract: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(healthy),
  };
}

describe('DEFAULT_TASK_DEFAULTS', () => {
  it('matches the AI_ARCHITECTURE.md routing table', () => {
    expect(DEFAULT_TASK_DEFAULTS).toEqual({
      'geo.query': ['openai', 'anthropic', 'google', 'perplexity'],
      'content.generation': ['openai', 'ollama'],
      'seo.analysis': ['ollama'],
      extraction: ['ollama'],
    });
  });
});

describe('AIProviderRegistry.resolveNames', () => {
  it('fans geo.query out to all four cloud providers by default', () => {
    const registry = new AIProviderRegistry({ providers: {} });
    expect(registry.resolveNames('geo.query')).toEqual(['openai', 'anthropic', 'google', 'perplexity']);
  });

  it('resolves a single-provider task to a one-element array', () => {
    const registry = new AIProviderRegistry({ providers: {} });
    expect(registry.resolveNames('seo.analysis')).toEqual(['ollama']);
    expect(registry.resolveNames('extraction')).toEqual(['ollama']);
  });

  it('falls back to the global default for an unknown task', () => {
    const registry = new AIProviderRegistry({ providers: {}, default: 'ollama' });
    expect(registry.resolveNames('some.unknown.task')).toEqual(['ollama']);
  });

  it('honors an explicit single-name override over the task default', () => {
    const registry = new AIProviderRegistry({ providers: {} });
    expect(registry.resolveNames('geo.query', 'anthropic')).toEqual(['anthropic']);
  });

  it('honors an explicit array override over the task default', () => {
    const registry = new AIProviderRegistry({ providers: {} });
    expect(registry.resolveNames('seo.analysis', ['openai', 'anthropic'])).toEqual(['openai', 'anthropic']);
  });

  it('lets a custom taskDefaults table override individual entries without losing the rest', () => {
    const registry = new AIProviderRegistry({
      providers: {},
      taskDefaults: { 'seo.analysis': ['openai'] },
    });
    expect(registry.resolveNames('seo.analysis')).toEqual(['openai']);
    // untouched entries survive the merge
    expect(registry.resolveNames('geo.query')).toEqual(['openai', 'anthropic', 'google', 'perplexity']);
  });
});

describe('AIProviderRegistry.get / resolve', () => {
  it('returns the registered instance for a name', () => {
    const ollama = fakeProvider('ollama', true);
    const registry = new AIProviderRegistry({ providers: { ollama } });
    expect(registry.get('ollama')).toBe(ollama);
  });

  it('throws ProviderNotRegisteredError for a name nobody registered', () => {
    const registry = new AIProviderRegistry({ providers: {} });
    expect(() => registry.get('openai')).toThrow(ProviderNotRegisteredError);
  });

  it('resolve() maps every candidate name to its registered instance', () => {
    const openai = fakeProvider('openai', true);
    const anthropic = fakeProvider('anthropic', true);
    const registry = new AIProviderRegistry({ providers: { openai, anthropic } });
    expect(registry.resolve('geo.query', ['openai', 'anthropic'])).toEqual([openai, anthropic]);
  });

  it('resolve() throws if any candidate in the chain is unregistered', () => {
    const openai = fakeProvider('openai', true);
    const registry = new AIProviderRegistry({ providers: { openai } });
    expect(() => registry.resolve('geo.query')).toThrow(ProviderNotRegisteredError);
  });
});

describe('AIProviderRegistry.resolveAvailable', () => {
  it('returns the first healthy candidate in priority order', async () => {
    const openai = fakeProvider('openai', false);
    const ollama = fakeProvider('ollama', true);
    const registry = new AIProviderRegistry({ providers: { openai, ollama } });

    const resolved = await registry.resolveAvailable('content.generation');

    expect(resolved).toBe(ollama);
    expect(openai.healthCheck).toHaveBeenCalledTimes(1);
    expect(ollama.healthCheck).toHaveBeenCalledTimes(1);
  });

  it('does not check a later candidate once an earlier one is healthy', async () => {
    const openai = fakeProvider('openai', true);
    const ollama = fakeProvider('ollama', true);
    const registry = new AIProviderRegistry({ providers: { openai, ollama } });

    await registry.resolveAvailable('content.generation');

    expect(openai.healthCheck).toHaveBeenCalledTimes(1);
    expect(ollama.healthCheck).not.toHaveBeenCalled();
  });

  it('skips a candidate name that was never registered instead of throwing', async () => {
    const ollama = fakeProvider('ollama', true);
    const registry = new AIProviderRegistry({ providers: { ollama } }); // no 'openai' registered

    const resolved = await registry.resolveAvailable('content.generation');
    expect(resolved).toBe(ollama);
  });

  it('throws NoAvailableProviderError when every candidate is unhealthy', async () => {
    const openai = fakeProvider('openai', false);
    const ollama = fakeProvider('ollama', false);
    const registry = new AIProviderRegistry({ providers: { openai, ollama } });

    await expect(registry.resolveAvailable('content.generation')).rejects.toThrow(NoAvailableProviderError);
  });
});

describe('AIProviderRegistry.healthCheckAll', () => {
  it('reports every registered provider concurrently', async () => {
    const openai = fakeProvider('openai', true);
    const ollama = fakeProvider('ollama', false);
    const registry = new AIProviderRegistry({ providers: { openai, ollama } });

    await expect(registry.healthCheckAll()).resolves.toEqual({ openai: true, ollama: false });
  });
});
