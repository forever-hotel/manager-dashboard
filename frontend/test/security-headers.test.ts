// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

it('protects pages and BFF routes without changing presentation or blocking sockets', async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:8080');
  const { default: config } = await import('../next.config');
  expect(config.poweredByHeader).toBe(false);
  const rules = await config.headers!();
  expect(rules).toContainEqual({
    source: '/:path*',
    headers: expect.arrayContaining([
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      {
        key: 'Content-Security-Policy',
        value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
      }
    ])
  });
});
