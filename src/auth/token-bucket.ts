import { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

/**
 * Token bucket rate limiter with Redis backend.
 * Provides smoother burst handling compared to sliding window.
 *
 * Algorithm:
 * - Each API key has a bucket with a maximum capacity (burst limit)
 * - Tokens refill at a constant rate (refill rate per minute)
 * - Each request consumes 1 token
 * - Requests are allowed if at least 1 token is available
 * - Bucket never exceeds its capacity
 */
export class TokenBucketRateLimiter {
  private redis: Redis;

  // Lua script for atomic token bucket check-and-decrement
  // This MUST be atomic to prevent race conditions
  private readonly luaScript = `
    local key = KEYS[1]
    local burst_capacity = tonumber(ARGV[1])
    local refill_rate_per_min = tonumber(ARGV[2])
    local now_ms = tonumber(ARGV[3])

    -- Get current bucket state
    local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
    local current_tokens = tonumber(bucket[1])
    local last_refill_ms = tonumber(bucket[2])

    -- Initialize bucket if it doesn't exist
    if not current_tokens or not last_refill_ms then
      current_tokens = burst_capacity
      last_refill_ms = now_ms
    end

    -- Calculate tokens to add based on elapsed time
    local elapsed_ms = now_ms - last_refill_ms
    local refill_rate_per_ms = refill_rate_per_min / 60000
    local tokens_to_add = math.floor(elapsed_ms * refill_rate_per_ms)

    -- Refill tokens (capped at burst capacity)
    if tokens_to_add > 0 then
      current_tokens = math.min(burst_capacity, current_tokens + tokens_to_add)
      last_refill_ms = now_ms
    end

    -- Check if request can be allowed
    local allowed = 0
    local remaining = current_tokens

    if current_tokens >= 1 then
      allowed = 1
      current_tokens = current_tokens - 1
      remaining = current_tokens
    end

    -- Calculate when next token will be available
    local ms_per_token = 60000 / refill_rate_per_min
    local next_token_at_ms = now_ms + ms_per_token

    -- Save updated bucket state
    redis.call('HMSET', key, 'tokens', current_tokens, 'last_refill', last_refill_ms)
    redis.call('PEXPIRE', key, 120000) -- 2 minute TTL to clean up inactive keys

    return {allowed, remaining, next_token_at_ms}
  `;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
  }

  /**
   * Check if request is allowed under token bucket rate limit.
   *
   * @param keyId - API key ID or identifier
   * @param burstCapacity - Maximum tokens in bucket (burst limit)
   * @param refillRatePerMin - Tokens to add per minute (sustained rate)
   * @returns Rate limit result with allowed status and headers
   */
  async check(
    keyId: string,
    burstCapacity: number,
    refillRatePerMin: number
  ): Promise<RateLimitResult> {
    const redisKey = `screenforge:tokenbucket:${keyId}`;
    const now = Date.now();

    try {
      const result = await this.redis.eval(
        this.luaScript,
        1,
        redisKey,
        burstCapacity.toString(),
        refillRatePerMin.toString(),
        now.toString()
      ) as [number, number, number];

      const [allowed, remaining, nextTokenAtMs] = result;

      return {
        allowed: allowed === 1,
        remaining: Math.floor(remaining),
        limit: burstCapacity,
        resetAt: Math.ceil(nextTokenAtMs),
      };
    } catch (error) {
      // Graceful degradation: allow request if Redis is down
      console.error('Token bucket rate limiter error:', error);
      return {
        allowed: true,
        remaining: burstCapacity,
        limit: burstCapacity,
        resetAt: now + 60000,
      };
    }
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}
