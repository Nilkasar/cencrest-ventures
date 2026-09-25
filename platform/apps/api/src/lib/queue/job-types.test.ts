import { describe, expect, it } from 'vitest';
import { ALL_JOB_TYPES, isKnownJobType, JOB_POLICIES, JOB_TYPES } from './job-types.js';

describe('JOB_TYPES', () => {
  it('lists every declared type exactly once', () => {
    expect(ALL_JOB_TYPES).toEqual(Object.values(JOB_TYPES));
    expect(new Set(ALL_JOB_TYPES).size).toBe(ALL_JOB_TYPES.length);
  });

  it('recognises a declared type and rejects anything else', () => {
    expect(isKnownJobType(JOB_TYPES.AI_VISIBILITY_RUN)).toBe(true);
    expect(isKnownJobType('ai_response_cache_warm')).toBe(false);
  });
});

describe('JOB_POLICIES', () => {
  it('covers every declared job type', () => {
    expect(Object.keys(JOB_POLICIES).sort()).toEqual([...ALL_JOB_TYPES].sort());
  });

  it('gives every job far longer than pg-boss\'s 15-minute default, which would re-dispatch a long run mid-flight', () => {
    for (const jobType of ALL_JOB_TYPES) {
      expect(JOB_POLICIES[jobType]!.expireInSeconds, jobType).toBeGreaterThan(15 * 60);
    }
  });

  it('never auto-retries a job whose work cannot be resumed and costs real money to redo', () => {
    // The free snapshot is small, cheap and lead-facing — one retry is worth
    // it. The other three re-run thousands of billed AI calls from scratch, or
    // could re-execute actions already taken against a customer's site.
    expect(JOB_POLICIES[JOB_TYPES.AI_VISIBILITY_RUN]!.retryLimit).toBe(0);
    expect(JOB_POLICIES[JOB_TYPES.CRAWL]!.retryLimit).toBe(0);
    expect(JOB_POLICIES[JOB_TYPES.AGENT_RUN]!.retryLimit).toBe(0);
    expect(JOB_POLICIES[JOB_TYPES.FREE_SNAPSHOT]!.retryLimit).toBe(1);
  });
});
