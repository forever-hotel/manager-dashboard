import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: [
        'lib/**/*.ts',
        'components/**/*.tsx',
        'proxy.ts',
        'app/api/auth/**/route.ts',
      ],
      exclude: ['lib/navigation.ts'],
      thresholds: {
        lines: 80,
        branches: 80,
        'lib/auth.ts': { branches: 90 },
        'app/api/auth/**/route.ts': { branches: 90 },
      },
    },
  },
});
