import { hash, compare } from 'bcryptjs';
import { getPool } from './index.js';

export interface User {
  id: string;
  email: string;
  createdAt: Date;
}

const BCRYPT_ROUNDS = 12;

export async function createUser(email: string, password: string): Promise<User> {
  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  const result = await getPool().query(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, $2)
     RETURNING id, email, created_at`,
    [email.toLowerCase().trim(), passwordHash],
  );
  const row = result.rows[0];
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

export async function verifyUser(email: string, password: string): Promise<User | null> {
  const result = await getPool().query(
    'SELECT id, email, password_hash, created_at FROM users WHERE email = $1',
    [email.toLowerCase().trim()],
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const valid = await compare(password, row.password_hash);
  if (!valid) return null;

  return { id: row.id, email: row.email, createdAt: row.created_at };
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await getPool().query(
    'SELECT id, email, created_at FROM users WHERE id = $1',
    [id],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

export async function linkApiKeyToUser(userId: string, apiKeyId: string): Promise<void> {
  await getPool().query(
    'INSERT INTO user_api_keys (user_id, api_key_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, apiKeyId],
  );
}

export async function getUserApiKeys(userId: string) {
  const result = await getPool().query(
    `SELECT ak.id, ak.prefix, ak.name, ak.tier, ak.rate_limit, ak.monthly_quota, ak.active, ak.created_at
     FROM api_keys ak
     JOIN user_api_keys uak ON uak.api_key_id = ak.id
     WHERE uak.user_id = $1
     ORDER BY ak.created_at DESC`,
    [userId],
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

export async function revokeUserApiKey(userId: string, keyId: string): Promise<boolean> {
  // Verify the user owns this key
  const ownership = await getPool().query(
    'SELECT 1 FROM user_api_keys WHERE user_id = $1 AND api_key_id = $2',
    [userId, keyId],
  );
  if (ownership.rows.length === 0) return false;

  await getPool().query('UPDATE api_keys SET active = false WHERE id = $1', [keyId]);
  return true;
}
