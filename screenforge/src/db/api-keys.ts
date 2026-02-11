import { createHash, randomBytes } from 'node:crypto';
import { getPool } from './index.js';
import { getConfig } from '../config/index.js';

export interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  tier: 'free' | 'starter' | 'pro' | 'business';
  rateLimit: number;
  monthlyQuota: number;
  active: boolean;
  createdAt: Date;
}

export interface CreateKeyResult {
  key: ApiKey;
  rawKey: string;
}

const TIER_DEFAULTS: Record<string, { rateLimit: number; monthlyQuota: number }> = {
  free: { rateLimit: 10, monthlyQuota: 1000 },
  starter: { rateLimit: 50, monthlyQuota: 10000 },
  pro: { rateLimit: 200, monthlyQuota: 100000 },
  business: { rateLimit: 1000, monthlyQuota: 1000000 },
};

export function hashApiKey(rawKey: string): string {
  const config = getConfig();
  return createHash('sha256').update(rawKey + config.API_KEY_SALT).digest('hex');
}

function generateRawKey(tier: string): string {
  const prefix = tier === 'free' ? 'sf_test_' : 'sf_live_';
  const random = randomBytes(24).toString('base64url');
  return prefix + random;
}

export async function createApiKey(name: string, tier: 'free' | 'starter' | 'pro' | 'business' = 'free'): Promise<CreateKeyResult> {
  const rawKey = generateRawKey(tier);
  const keyHash = hashApiKey(rawKey);
  const prefix = rawKey.slice(0, rawKey.indexOf('_', 3) + 1);
  const defaults = TIER_DEFAULTS[tier];

  const result = await getPool().query(
    `INSERT INTO api_keys (key_hash, prefix, name, tier, rate_limit, monthly_quota)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, prefix, name, tier, rate_limit, monthly_quota, active, created_at`,
    [keyHash, prefix, name, tier, defaults.rateLimit, defaults.monthlyQuota],
  );

  const row = result.rows[0];
  return {
    key: {
      id: row.id,
      prefix: row.prefix,
      name: row.name,
      tier: row.tier,
      rateLimit: row.rate_limit,
      monthlyQuota: row.monthly_quota,
      active: row.active,
      createdAt: row.created_at,
    },
    rawKey,
  };
}

export async function lookupApiKey(rawKey: string): Promise<ApiKey | null> {
  const keyHash = hashApiKey(rawKey);
  const result = await getPool().query(
    `SELECT id, prefix, name, tier, rate_limit, monthly_quota, active, created_at
     FROM api_keys WHERE key_hash = $1`,
    [keyHash],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    prefix: row.prefix,
    name: row.name,
    tier: row.tier,
    rateLimit: row.rate_limit,
    monthlyQuota: row.monthly_quota,
    active: row.active,
    createdAt: row.created_at,
  };
}

export async function incrementUsage(apiKeyId: string): Promise<number> {
  const result = await getPool().query(
    `INSERT INTO usage_daily (api_key_id, date, count)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (api_key_id, date) DO UPDATE SET count = usage_daily.count + 1
     RETURNING count`,
    [apiKeyId],
  );
  return result.rows[0].count;
}

export async function getUsageStats(apiKeyId: string): Promise<{ today: number; thisMonth: number }> {
  const todayResult = await getPool().query(
    `SELECT COALESCE(count, 0) as count FROM usage_daily
     WHERE api_key_id = $1 AND date = CURRENT_DATE`,
    [apiKeyId],
  );

  const monthResult = await getPool().query(
    `SELECT COALESCE(SUM(count), 0) as total FROM usage_daily
     WHERE api_key_id = $1 AND date >= date_trunc('month', CURRENT_DATE)`,
    [apiKeyId],
  );

  return {
    today: todayResult.rows[0]?.count ?? 0,
    thisMonth: Number(monthResult.rows[0]?.total ?? 0),
  };
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const result = await getPool().query(
    `SELECT id, prefix, name, tier, rate_limit, monthly_quota, active, created_at
     FROM api_keys ORDER BY created_at DESC`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    prefix: row.prefix,
    name: row.name,
    tier: row.tier,
    rateLimit: row.rate_limit,
    monthlyQuota: row.monthly_quota,
    active: row.active,
    createdAt: row.created_at,
  }));
}

export interface WebhookConfig {
  url: string | null;
  secret: string | null;
}

export async function getWebhookConfig(apiKeyId: string): Promise<WebhookConfig> {
  const result = await getPool().query(
    `SELECT webhook_url, webhook_secret FROM api_keys WHERE id = $1`,
    [apiKeyId],
  );

  if (result.rows.length === 0) {
    throw new Error('API key not found');
  }

  const row = result.rows[0];
  return {
    url: row.webhook_url,
    secret: row.webhook_secret,
  };
}

export async function updateWebhookConfig(
  apiKeyId: string,
  url: string | null,
  secret: string | null,
): Promise<void> {
  await getPool().query(
    `UPDATE api_keys SET webhook_url = $1, webhook_secret = $2 WHERE id = $3`,
    [url, secret, apiKeyId],
  );
}

/**
 * Rotate an API key (generate new key while keeping tier/quota/name)
 */
export async function rotateApiKey(keyId: string): Promise<string> {
  // Get current key details
  const result = await getPool().query(
    `SELECT tier, name FROM api_keys WHERE id = $1`,
    [keyId],
  );

  if (result.rows.length === 0) {
    throw new Error('API key not found');
  }

  const { tier } = result.rows[0];

  // Generate new raw key with same tier
  const prefix = tier === 'free' ? 'sf_test_' : 'sf_live_';
  const random = randomBytes(24).toString('base64url');
  const rawKey = prefix + random;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, rawKey.indexOf('_', 3) + 1);

  // Update existing row with new hash and prefix
  await getPool().query(
    `UPDATE api_keys SET key_hash = $1, prefix = $2, active = true WHERE id = $3`,
    [keyHash, keyPrefix, keyId],
  );

  return rawKey;
}
