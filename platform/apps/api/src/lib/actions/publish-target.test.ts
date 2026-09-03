import { describe, expect, it, afterEach } from 'vitest';
import { NullPublishTarget, getPublishTarget, __setPublishTargetForTesting } from './publish-target.js';

afterEach(() => {
  __setPublishTargetForTesting(undefined);
});

describe('NullPublishTarget', () => {
  it('never returns anything resembling a real external URL — always an internal:// locator', async () => {
    const target = new NullPublishTarget();
    const result = await target.publish({ actionId: 'act-1', organizationId: 'org-1', brandId: 'brand-1', title: 'Hello', body: 'World' });
    expect(result.destinationRef.startsWith('internal://')).toBe(true);
    expect(result.destinationRef).not.toMatch(/^https?:\/\//);
  });

  it('is deterministic per actionId (same input, same destinationRef)', async () => {
    const target = new NullPublishTarget();
    const first = await target.publish({ actionId: 'act-1', organizationId: 'org-1', brandId: 'brand-1', title: 'Hello', body: null });
    const second = await target.publish({ actionId: 'act-1', organizationId: 'org-1', brandId: 'brand-1', title: 'Hello', body: null });
    expect(first.destinationRef).toBe(second.destinationRef);
  });

  it('carries the real input through into its result payload — never fabricates content', async () => {
    const target = new NullPublishTarget();
    const result = await target.publish({ actionId: 'act-1', organizationId: 'org-1', brandId: 'brand-1', title: 'Real Title', body: 'Real body' });
    expect(result.result.title).toBe('Real Title');
    expect(result.result.actionId).toBe('act-1');
    expect(result.result.publishedVia).toBe('internal_record');
  });

  it('rollback is a no-op that never throws (no external state to undo)', async () => {
    const target = new NullPublishTarget();
    await expect(target.rollback('internal://published-content/act-1')).resolves.toBeUndefined();
  });

  it('name is the real, non-hardcoded identifier stored on published_content.publish_target', () => {
    const target = new NullPublishTarget();
    expect(target.name).toBe('internal_record');
  });
});

describe('getPublishTarget', () => {
  it('returns a process-lifetime singleton', () => {
    expect(getPublishTarget()).toBe(getPublishTarget());
  });

  it('__setPublishTargetForTesting lets a test inject a different target', async () => {
    const calls: string[] = [];
    __setPublishTargetForTesting({
      name: 'spy_target',
      publish: async () => {
        calls.push('publish');
        return { destinationRef: 'internal://spy', result: {} };
      },
      rollback: async () => {
        calls.push('rollback');
      },
    });

    const target = getPublishTarget();
    expect(target.name).toBe('spy_target');
    await target.publish({ actionId: 'a', organizationId: 'o', brandId: 'b', title: 't', body: null });
    await target.rollback('internal://spy');
    expect(calls).toEqual(['publish', 'rollback']);
  });
});
