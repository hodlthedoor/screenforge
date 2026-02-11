import { randomBytes } from 'node:crypto';

/**
 * Generate a cryptographically secure random token
 * @param bytes - Number of random bytes (default 32 = 64 hex chars)
 * @returns Hex-encoded token string
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Create an expiring token with a specified TTL
 * @param ttlMs - Time-to-live in milliseconds
 * @param now - Current time (defaults to now, injectable for testing)
 * @returns Object with token and expiration timestamp
 */
export function createExpiringToken(ttlMs: number, now: Date = new Date()): { token: string; expiresAt: Date } {
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + ttlMs);
  return { token, expiresAt };
}

/**
 * Check if a token has expired
 * @param expiresAt - Expiration timestamp (or null)
 * @param now - Current time (defaults to now, injectable for testing)
 * @returns true if expired or null, false if still valid
 */
export function isExpired(expiresAt: Date | string | null, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  return expiry.getTime() <= now.getTime();
}

// Default TTLs (1 hour for both)
export const EMAIL_VERIFICATION_TTL = 3600000; // 1 hour
export const PASSWORD_RESET_TTL = 3600000; // 1 hour
