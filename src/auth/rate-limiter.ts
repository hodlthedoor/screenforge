import { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

export class SlidingWindowRateLimiter {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
  }

  async check(keyId: string, limit: number, windowMs = 60_000): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - windowMs;
    const redisKey = `screenforge:ratelimit:${keyId}`;

    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(redisKey, 0, windowStart);
    pipeline.zadd(redisKey, now.toString(), `${now}-${Math.random().toString(36).slice(2, 8)}`);
    pipeline.zcard(redisKey);
    pipeline.pexpire(redisKey, windowMs);

    const results = await pipeline.exec();
    if (!results) {
      return { allowed: true, remaining: limit, limit, resetAt: now + windowMs };
    }

    const count = (results[2]?.[1] as number) ?? 0;
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    const resetAt = now + windowMs;

    if (!allowed) {
      // Remove the entry we just added since it's over limit
      await this.redis.zremrangebyscore(redisKey, now, now + 1);
    }

    return { allowed, remaining, limit, resetAt };
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}
