import { describe, expect, it } from 'vitest';

import { parseWebTargetSegments } from '@/lib/with-md/web2md/route-target';

describe('parseWebTargetSegments', () => {
  it('parses protocol-split paths', () => {
    expect(parseWebTargetSegments(['https:', 'example.com', 'blog', 'post'])).toEqual({
      targetUrl: 'https://example.com/blog/post',
      mode: 'normal',
      suffix: null,
    });
  });

  it('parses single encoded segment', () => {
    expect(parseWebTargetSegments(['https%3A%2F%2Fexample.com%2Fa%3Fb%3D1'])).toEqual({
      targetUrl: 'https://example.com/a?b=1',
      mode: 'normal',
      suffix: null,
    });
  });

  it('handles revalidate suffixes', () => {
    expect(parseWebTargetSegments(['https:', 'example.com', 'post', 'revalidate'])?.mode).toBe('revalidate');
    expect(parseWebTargetSegments(['https:', 'example.com', 'post', 'redo'])?.suffix).toBe('redo');
  });

  it('rejects non-http paths', () => {
    expect(parseWebTargetSegments(['workspace', 'repo'])).toBeNull();
  });
});
