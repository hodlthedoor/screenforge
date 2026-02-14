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
    include: ['tests/e2e/**/*.test.ts'],
    env: {
      REDIS_URL: 'redis://127.0.0.1:6379/15',
      NODE_ENV: 'test',
      API_KEY_SALT: 'test-salt-must-be-16-chars-long',
      ALLOW_PRIVATE_URLS: 'true',
      DATABASE_URL: 'postgresql:///screenforge_test?host=/var/run/postgresql',
      SESSION_SECRET: 'e2e-test-session-secret-32-chars-long!!',
    },
    testTimeout: 60_000,
    hookTimeout: 30_000,
    setupFiles: ['tests/e2e/setup.ts'],
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  },
});
