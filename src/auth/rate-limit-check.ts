import type { SlidingWindowRateLimiter } from './rate-limiter.js';
import type { TokenBucketRateLimiter } from './token-bucket.js';
import type { RateLimitResult } from './rate-limit-types.js';
import { getConfig } from '../config/index.js';
import { getPlanByTier } from '../billing/plans.js';

/**
 * Universal rate limit checker that supports both sliding window and token bucket algorithms.
 * Automatically selects the appropriate parameters based on the configured limiter type.
 */
export async function checkRateLimit(
  rateLimiter: SlidingWindowRateLimiter | TokenBucketRateLimiter,
  apiKeyId: string,
  apiKeyTier: string,
  apiKeyRateLimit: number
): Promise<RateLimitResult> {
  const config = getConfig();

  if (config.TOKEN_BUCKET_ENABLED) {
    // Token bucket: use burst capacity and refill rate from plan
    const plan = getPlanByTier(apiKeyTier);
    if (!plan) {
      throw new Error(`Invalid tier: ${apiKeyTier}`);
    }
    return await (rateLimiter as TokenBucketRateLimiter).check(
      apiKeyId,
      plan.burstCapacity,
      plan.refillRatePerMin
    );
  } else {
    // Sliding window: use existing rate limit
    return await (rateLimiter as SlidingWindowRateLimiter).check(apiKeyId, apiKeyRateLimit);
  }
}
