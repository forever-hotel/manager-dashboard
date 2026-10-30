import type { NextConfig } from 'next';
import { httpUrl } from './lib/environment';
httpUrl('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL);
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
          }
        ]
      }
    ];
  }
};
export default nextConfig;
