import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Parameters used for computing render fingerprint.
 * Excludes timestamp, requestId, and other ephemeral fields.
 */
export interface FingerprintParams {
  url?: string;
  html?: string;
  format?: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  selector?: string;
  device?: string;
  darkMode?: boolean;
  deviceScaleFactor?: number;
  userAgent?: string;
  quality?: number;
  wait?: unknown;
  waitFor?: string;
  actions?: unknown[];
  headers?: Record<string, string>;
  cookies?: unknown[];
  // Allow any other fields but they will be normalized
  [key: string]: unknown;
}

/**
 * Compute a SHA256 fingerprint for render parameters.
 * Normalizes the parameters by sorting keys and excluding ephemeral fields.
 */
export function computeFingerprint(params: FingerprintParams, type?: string): string {
  // Create a normalized copy excluding ephemeral fields
  const normalized: Record<string, unknown> = {};

  const excludedKeys = new Set(['timestamp', 'requestId', 'callback_url', 'callbackUrl']);

  // Sort keys and exclude ephemeral ones
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    if (!excludedKeys.has(key)) {
      normalized[key] = params[key];
    }
  }

  // Include render type to prevent cross-type dedup (screenshot vs pdf)
  if (type) {
    normalized['__type'] = type;
  }

  // Create deterministic JSON string (keys already sorted from the loop above)
  const jsonStr = JSON.stringify(normalized);

  // Hash with SHA256
  return createHash('sha256').update(jsonStr).digest('hex');
}

/**
 * Check if a deduplication entry exists for the given fingerprint.
 * Returns the existing job ID if found, null otherwise.
 */
export async function checkDedup(redis: Redis, fingerprint: string): Promise<string | null> {
  const jobId = await redis.get(`dedup:${fingerprint}`);
  return jobId;
}

/**
 * Clear a deduplication entry for the given fingerprint.
 * Called when a job completes or fails.
 */
export async function clearDedup(redis: Redis, fingerprint: string): Promise<void> {
  await redis.del(`dedup:${fingerprint}`);
}
