import { describe, expect, test } from 'vitest';

import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { buildSiteUrl, indexableMarketingPaths, siteUrl } from '@/lib/with-md/site';

describe('site metadata routes', () => {
  test('normalizes the canonical site url', () => {
    expect(siteUrl).toBe('https://with.md');
    expect(buildSiteUrl('/sitemap.xml')).toBe('https://with.md/sitemap.xml');
  });

  test('publishes a crawl policy for public marketing pages only', () => {
    const metadata = robots();
    expect(metadata.sitemap).toBe('https://with.md/sitemap.xml');
    expect(metadata.rules).toEqual([
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/workspace',
          '/embed',
          '/s/',
          '/r/',
          '/skill',
          '/http:/',
          '/https:/',
        ],
      },
    ]);
  });

  test('includes every indexable marketing page in the sitemap', () => {
    expect(indexableMarketingPaths).toEqual(['/']);
    expect(sitemap()).toEqual([
      {
        url: 'https://with.md/',
        changeFrequency: 'weekly',
        priority: 1,
      },
    ]);
  });
});
