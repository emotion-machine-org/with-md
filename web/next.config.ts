import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: process.env.NODE_ENV !== 'development',
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
    ];
  },
};

export default nextConfig;
