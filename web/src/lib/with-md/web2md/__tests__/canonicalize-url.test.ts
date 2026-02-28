import { describe, expect, it } from 'vitest';

import { canonicalizeUrl } from '@/lib/with-md/web2md/canonicalize-url';

describe('canonicalizeUrl', () => {
  it('normalizes host, removes fragment and default port, and sorts query params', () => {
    const result = canonicalizeUrl('HTTPS://Example.COM:443/path?a=2&b=1&a=1#frag');
    expect(result.normalizedUrl).toBe('https://example.com/path?a=1&a=2&b=1');
    expect(result.urlHash).toHaveLength(64);
  });

  it('keeps non-default ports', () => {
    const result = canonicalizeUrl('http://example.com:8080/path');
    expect(result.normalizedUrl).toBe('http://example.com:8080/path');
  });

  it('throws for unsupported schemes', () => {
    expect(() => canonicalizeUrl('ftp://example.com')).toThrow('Only http:// and https:// URLs are supported.');
  });
});
