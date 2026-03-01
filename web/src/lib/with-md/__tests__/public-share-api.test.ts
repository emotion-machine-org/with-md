import { describe, expect, test } from 'vitest';

import {
  normalizeVersionTag,
  readExpectedVersion,
} from '@/lib/with-md/public-share-api';

describe('public-share-api helpers', () => {
  test('normalizeVersionTag strips weak etag markers and quotes', () => {
    expect(normalizeVersionTag('"abc123"')).toBe('abc123');
    expect(normalizeVersionTag('W/"abc123"')).toBe('abc123');
    expect(normalizeVersionTag('abc123')).toBe('abc123');
  });

  test('readExpectedVersion prefers body ifMatch over header', () => {
    const request = new Request('https://with.md/api/public/share/abc', {
      headers: {
        'If-Match': '"from-header"',
      },
    });
    const expected = readExpectedVersion({ ifMatch: '"from-body"' }, request);
    expect(expected).toBe('from-body');
  });

  test('readExpectedVersion falls back to header when body is absent', () => {
    const request = new Request('https://with.md/api/public/share/abc', {
      headers: {
        'If-Match': 'W/"from-header"',
      },
    });
    const expected = readExpectedVersion({}, request);
    expect(expected).toBe('from-header');
  });
});
