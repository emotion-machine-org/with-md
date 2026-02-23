import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: process.env.NODE_ENV !== 'development',
  experimental: {
    // Next.js 15 segment explorer in dev can intermittently break RSC client manifest resolution.
    // Disabling it keeps the app router/dev overlay stable during rapid file import + route navigation.
    devtoolSegmentExplorer: false,
  },
  async headers() {
    return [
      {
        source: '/backgrounds/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Block framing on all routes except /embed
        source: '/((?!embed).*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
