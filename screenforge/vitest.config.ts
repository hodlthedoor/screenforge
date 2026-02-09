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
    env: {
      REDIS_URL: 'redis://127.0.0.1:6379/15',
      NODE_ENV: 'test',
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
