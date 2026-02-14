import { hash, compare } from 'bcryptjs';
import { getPool } from './index.js';

export interface User {
  id: string;
  email: string;
  isAdmin: boolean;
  active: boolean;
  createdAt: Date;
}

export interface UserApiKey {
  id: string;
  prefix: string;
  name: string;
  tier: 'free' | 'starter' | 'pro' | 'business';
  rateLimit: number;
  monthlyQuota: number;
  active: boolean;
  createdAt: Date;
}

const BCRYPT_ROUNDS = 12;

function mapUser(row: { id: string; email: string; is_admin: boolean; active: boolean; created_at: Date }): User {
  return { id: row.id, email: row.email, isAdmin: row.is_admin, active: row.active, createdAt: row.created_at };
}

export async function createUser(email: string, password: string): Promise<User> {
  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  const result = await getPool().query(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, $2)
     RETURNING id, email, is_admin, active, created_at`,
    [email.toLowerCase().trim(), passwordHash],
  );
  return mapUser(result.rows[0]);
}

export async function verifyUser(email: string, password: string): Promise<User | null> {
  const result = await getPool().query(
    'SELECT id, email, password_hash, is_admin, active, created_at FROM users WHERE email = $1',
    [email.toLowerCase().trim()],
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const valid = await compare(password, row.password_hash);
  if (!valid) return null;

  return mapUser(row);
}

export async function getUserById(id: string): Promise<User | null> {
  const result = await getPool().query(
    'SELECT id, email, is_admin, active, created_at FROM users WHERE id = $1',
    [id],
  );
  if (result.rows.length === 0) return null;
  return mapUser(result.rows[0]);
}

export async function linkApiKeyToUser(userId: string, apiKeyId: string): Promise<void> {
  await getPool().query(
    'INSERT INTO user_api_keys (user_id, api_key_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, apiKeyId],
  );
}

export async function getUserApiKeys(userId: string): Promise<UserApiKey[]> {
  const result = await getPool().query(
    `SELECT ak.id, ak.prefix, ak.name, ak.tier, ak.rate_limit, ak.monthly_quota, ak.active, ak.created_at
     FROM api_keys ak
     JOIN user_api_keys uak ON uak.api_key_id = ak.id
     WHERE uak.user_id = $1
     ORDER BY ak.created_at DESC`,
    [userId],
  );
  return result.rows.map((row: {
    id: string;
    prefix: string;
    name: string;
    tier: UserApiKey['tier'];
    rate_limit: number;
    monthly_quota: number;
    active: boolean;
    created_at: Date;
  }) => ({
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

/**
 * Verify user's current password
 */
export async function verifyUserPassword(userId: string, password: string): Promise<boolean> {
  const result = await getPool().query(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId],
  );
  if (result.rows.length === 0) return false;
  return await compare(password, result.rows[0].password_hash);
}

/**
 * Update user's password hash
 */
export async function updateUserPassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await hash(newPassword, BCRYPT_ROUNDS);
  await getPool().query(
    'UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires = NULL WHERE id = $2',
    [passwordHash, userId],
  );
}

/**
 * Set password reset token for a user
 */
export async function setPasswordResetToken(email: string, token: string, expiresAt: Date): Promise<void> {
  await getPool().query(
    'UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE email = $3',
    [token, expiresAt, email.toLowerCase().trim()],
  );
}

/**
 * Get user by password reset token
 */
export async function getUserByResetToken(token: string): Promise<User | null> {
  const result = await getPool().query(
    'SELECT id, email, is_admin, active, created_at, password_reset_expires FROM users WHERE password_reset_token = $1',
    [token],
  );
  if (result.rows.length === 0) return null;
  return mapUser(result.rows[0]);
}

/**
 * Clear password reset token
 */
export async function clearPasswordResetToken(userId: string): Promise<void> {
  await getPool().query(
    'UPDATE users SET password_reset_token = NULL, password_reset_expires = NULL WHERE id = $1',
    [userId],
  );
}

/**
 * Set email verification token for a user
 */
export async function setEmailVerificationToken(userId: string, token: string, expiresAt: Date): Promise<void> {
  await getPool().query(
    'UPDATE users SET email_token = $1, email_token_expires = $2 WHERE id = $3',
    [token, expiresAt, userId],
  );
}

/**
 * Get user by email verification token
 */
export async function getUserByEmailToken(token: string): Promise<User | null> {
  const result = await getPool().query(
    'SELECT id, email, is_admin, active, created_at, email_token_expires FROM users WHERE email_token = $1',
    [token],
  );
  if (result.rows.length === 0) return null;
  return mapUser(result.rows[0]);
}

/**
 * Mark email as verified and clear token
 */
export async function markEmailVerified(userId: string): Promise<void> {
  await getPool().query(
    'UPDATE users SET email_verified = true, email_verified_at = NOW(), email_token = NULL, email_token_expires = NULL WHERE id = $1',
    [userId],
  );
}

/**
 * Delete user by ID (cascade delete via FK constraints)
 */
export async function deleteUser(userId: string): Promise<void> {
  await getPool().query('DELETE FROM users WHERE id = $1', [userId]);
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await getPool().query(
    'SELECT id, email, is_admin, active, created_at FROM users WHERE email = $1',
    [email.toLowerCase().trim()],
  );
  if (result.rows.length === 0) return null;
  return mapUser(result.rows[0]);
}

// --- Admin functions ---

export async function listAllUsers(opts: {
  page: number;
  perPage: number;
  search?: string;
}): Promise<{ users: (User & { tier: string; rendersThisMonth: number })[]; total: number }> {
  const offset = (opts.page - 1) * opts.perPage;
  const params: unknown[] = [opts.perPage, offset];
  let where = '';
  if (opts.search) {
    where = 'WHERE u.email ILIKE $3';
    params.push(`%${opts.search}%`);
  }

  const countWhere = opts.search ? 'WHERE u.email ILIKE $1' : '';
  const countResult = await getPool().query(
    `SELECT COUNT(*)::int as total FROM users u ${countWhere}`,
    opts.search ? [`%${opts.search}%`] : [],
  );

  const result = await getPool().query(
    `SELECT u.id, u.email, u.is_admin, u.active, u.created_at,
       COALESCE(s.plan, 'free') as tier,
       COALESCE(renders.count, 0)::int as renders_this_month
     FROM users u
     LEFT JOIN LATERAL (
       SELECT plan FROM subscriptions WHERE user_id = u.id AND status = 'active' ORDER BY created_at DESC LIMIT 1
     ) s ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) as count FROM render_jobs rj
       JOIN user_api_keys uak ON uak.api_key_id = rj.api_key_id
       WHERE uak.user_id = u.id AND rj.created_at >= date_trunc('month', CURRENT_DATE)
     ) renders ON true
     ${where}
     ORDER BY u.created_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );

  return {
    users: result.rows.map((row: { id: string; email: string; is_admin: boolean; active: boolean; created_at: Date; tier: string; renders_this_month: number }) => ({
      ...mapUser(row),
      tier: row.tier,
      rendersThisMonth: row.renders_this_month,
    })),
    total: countResult.rows[0].total,
  };
}

export async function toggleUserActive(userId: string): Promise<boolean> {
  const result = await getPool().query(
    'UPDATE users SET active = NOT active WHERE id = $1 RETURNING active',
    [userId],
  );
  return result.rows[0]?.active ?? false;
}

export async function changeUserTier(userId: string, tier: string): Promise<void> {
  const pool = getPool();
  // Update API keys owned by the user to the new tier
  await pool.query(
    `UPDATE api_keys SET tier = $1
     WHERE id IN (SELECT api_key_id FROM user_api_keys WHERE user_id = $2)`,
    [tier, userId],
  );
}

export async function getAdminUserDetail(userId: string): Promise<{
  user: User;
  keys: UserApiKey[];
  subscription: { plan: string; status: string; currentPeriodEnd: Date } | null;
  recentRenders: { id: string; type: string; url: string; status: string; createdAt: Date }[];
} | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  const keys = await getUserApiKeys(userId);

  const subResult = await getPool().query(
    `SELECT plan, status, current_period_end FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const subscription = subResult.rows.length > 0
    ? { plan: subResult.rows[0].plan, status: subResult.rows[0].status, currentPeriodEnd: subResult.rows[0].current_period_end }
    : null;

  const rendersResult = await getPool().query(
    `SELECT rj.id, rj.type, rj.url, rj.status, rj.created_at
     FROM render_jobs rj
     JOIN user_api_keys uak ON uak.api_key_id = rj.api_key_id
     WHERE uak.user_id = $1
     ORDER BY rj.created_at DESC LIMIT 20`,
    [userId],
  );

  return {
    user,
    keys,
    subscription,
    recentRenders: rendersResult.rows.map((r: { id: string; type: string; url: string; status: string; created_at: Date }) => ({
      id: r.id, type: r.type, url: r.url, status: r.status, createdAt: r.created_at,
    })),
  };
}
