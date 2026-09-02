import { describe, expect, it } from 'vitest';
import { extractJsonCandidate, parseAndValidateJson } from './json.js';
import { JsonParseError, SchemaValidationError } from './errors.js';

const SCHEMA = {
  type: 'object',
  properties: {
    brandMentioned: { type: 'boolean' },
    count: { type: 'number' },
  },
  required: ['brandMentioned', 'count'],
  additionalProperties: false,
} as const;

describe('extractJsonCandidate', () => {
  it('returns pure JSON unchanged', () => {
    expect(extractJsonCandidate('{"a":1}')).toBe('{"a":1}');
  });

  it('pulls JSON out of a ```json fenced block', () => {
    const raw = 'Sure, here you go:\n```json\n{"a":1}\n```\nHope that helps!';
    expect(extractJsonCandidate(raw)).toBe('{"a":1}');
  });

  it('pulls JSON out of a bare ``` fenced block', () => {
    const raw = '```\n{"a":1}\n```';
    expect(extractJsonCandidate(raw)).toBe('{"a":1}');
  });

  it('pulls the object substring out of surrounding prose with no fence', () => {
    const raw = 'The result is {"a":1} as requested.';
    expect(extractJsonCandidate(raw)).toBe('{"a":1}');
  });

  it('handles a top-level array', () => {
    const raw = 'Values: [1,2,3] done.';
    expect(extractJsonCandidate(raw)).toBe('[1,2,3]');
  });

  it('returns the trimmed original text when nothing looks JSON-shaped', () => {
    expect(extractJsonCandidate('no json here')).toBe('no json here');
  });
});

describe('parseAndValidateJson', () => {
  it('parses and validates a matching payload', () => {
    const result = parseAndValidateJson<{ brandMentioned: boolean; count: number }>(
      '```json\n{"brandMentioned": true, "count": 3}\n```',
      SCHEMA,
    );
    expect(result).toEqual({ brandMentioned: true, count: 3 });
  });

  it('throws JsonParseError when nothing parses as JSON', () => {
    expect(() => parseAndValidateJson('this is not json at all', SCHEMA)).toThrow(JsonParseError);
  });

  it('throws SchemaValidationError when JSON parses but violates the schema', () => {
    expect(() => parseAndValidateJson('{"brandMentioned": "yes", "count": 3}', SCHEMA)).toThrow(
      SchemaValidationError,
    );
  });

  it('throws SchemaValidationError on a missing required field', () => {
    expect(() => parseAndValidateJson('{"brandMentioned": true}', SCHEMA)).toThrow(SchemaValidationError);
  });

  it('rejects additional properties per the schema', () => {
    expect(() =>
      parseAndValidateJson('{"brandMentioned": true, "count": 1, "extra": "nope"}', SCHEMA),
    ).toThrow(SchemaValidationError);
  });
});
