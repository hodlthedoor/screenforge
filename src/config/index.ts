import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379/0'),
  DATABASE_URL: z.string().default('postgresql:///screenforge?host=/var/run/postgresql'),
  STORAGE_PATH: z.string().default('./storage'),
  STORAGE_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  API_KEY_SALT: z.string().min(16),
  ADMIN_API_KEY: z.string().min(16).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  BROWSER_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(3),
  MAX_RENDERS_PER_CONTEXT: z.coerce.number().int().min(1).default(100),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(3600),
  NAVIGATION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(3),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  ALLOW_PRIVATE_URLS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  REQUIRE_AUTH: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  METRICS_AUTH_REQUIRED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  CORS_ORIGINS: z.string().optional().transform((v) => v ? v.split(',').map(s => s.trim()) : []),
  MAX_CONTENT_SIZE_MB: z.coerce.number().int().min(1).max(100).default(50),
  BASE_URL: z.string().default('http://localhost:3100'),
  SESSION_SECRET: z.string().min(32).default('change-me-in-production-this-is-32-chars!'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  METRICS_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  RENDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  GIF_MAX_DURATION_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().min(1).default(3),
  ANALYTICS_SCRIPT: z.string().optional(),

  // Scheduler for recurring screenshot jobs
  SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  SCHEDULER_POLL_INTERVAL_MS: z.coerce.number().int().min(5000).default(60_000),

  // Queue priority: when enabled, paid tiers get faster processing
  QUEUE_PRIORITY_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),

  // Anthropic API key for LLM extraction (optional — users can also bring their own via header)
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // Storage backend: 'local' (default) or 's3' (S3-compatible)
  STORAGE_BACKEND: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),

  // Global default proxy (used when no per-request proxy is set)
  PROXY_SERVER: z.string().refine((server) => {
    if (!server) return true; // Optional
    return /^(https?|socks[45]):\/\/.+/.test(server);
  }, {
    message: 'PROXY_SERVER must use http://, https://, socks4://, or socks5:// protocol',
  }).optional(),
  PROXY_USERNAME: z.string().optional(),
  PROXY_PASSWORD: z.string().optional(),

  // Job deduplication: share browser execution for identical concurrent render requests
  DEDUP_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  DEDUP_WINDOW_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
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
