import type { MetadataRoute } from 'next';

import { siteUrl } from '@/lib/with-md/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
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
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
