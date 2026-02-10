import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379/0'),
  DATABASE_URL: z.string().default('postgresql:///screenforge?host=/var/run/postgresql'),
  STORAGE_PATH: z.string().default('./storage'),
  API_KEY_SALT: z.string().min(16),
  ADMIN_API_KEY: z.string().min(16).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BROWSER_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(3),
  MAX_RENDERS_PER_CONTEXT: z.coerce.number().int().min(1).default(100),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(3600),
  NAVIGATION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  ALLOW_PRIVATE_URLS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  REQUIRE_AUTH: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  MAX_CONTENT_SIZE_MB: z.coerce.number().int().min(1).max(100).default(50),
  BASE_URL: z.string().default('http://localhost:3100'),
  SESSION_SECRET: z.string().min(32).default('change-me-in-production-this-is-32-chars!'),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | undefined;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  _config = result.data;
  return _config;
}

export function getConfig(): Config {
  if (!_config) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return _config;
}
