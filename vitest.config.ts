import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    env: {
      REDIS_URL: 'redis://127.0.0.1:6379/15',
      NODE_ENV: 'test',
    },
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        'vitest.config.ts',
        'vitest.e2e.config.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        lines: 70,
        branches: 69.9,
        functions: 70,
        statements: 70,
      },
    },
  },
});
