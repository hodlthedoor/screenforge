import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { TokenBucketRateLimiter } from '../../src/auth/token-bucket.js';
import { Redis } from 'ioredis';

const REDIS_URL = 'redis://127.0.0.1:6379/15';

describe('TokenBucketRateLimiter', () => {
  let limiter: TokenBucketRateLimiter;
  let redis: Redis;

  beforeAll(() => {
    limiter = new TokenBucketRateLimiter(REDIS_URL);
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
  });

  beforeEach(async () => {
    // Clean up token bucket keys
    const keys = await redis.keys('screenforge:tokenbucket:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    await limiter.close();
    redis.disconnect();
  });

  describe('burst allowance', () => {
    it('allows burst up to bucket capacity', async () => {
      const burstCapacity = 10;
      const refillRate = 5;

      // Should allow all burst requests immediately
      for (let i = 0; i < burstCapacity; i++) {
        const result = await limiter.check('test-burst', burstCapacity, refillRate);
        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(burstCapacity);
      }

      // Next request should be denied (bucket empty)
      const denied = await limiter.check('test-burst', burstCapacity, refillRate);
      expect(denied.allowed).toBe(false);
      expect(denied.remaining).toBe(0);
    });

    it('returns correct remaining token count', async () => {
      const burstCapacity = 10;
      const refillRate = 5;

      // First request: 10 -> 9 tokens
      const result1 = await limiter.check('test-remaining', burstCapacity, refillRate);
      expect(result1.remaining).toBe(burstCapacity - 1);

      // Second request: 9 -> 8 tokens
      const result2 = await limiter.check('test-remaining', burstCapacity, refillRate);
      expect(result2.remaining).toBe(burstCapacity - 2);

      // Third request: 8 -> 7 tokens
      const result3 = await limiter.check('test-remaining', burstCapacity, refillRate);
      expect(result3.remaining).toBe(burstCapacity - 3);
    });
  });

  describe('sustained rate enforcement', () => {
    it('enforces sustained rate after burst is exhausted', async () => {
      const burstCapacity = 5;
      const refillRate = 10; // 10 tokens per minute = 1 token every 6000ms

      // Exhaust burst
      for (let i = 0; i < burstCapacity; i++) {
        await limiter.check('test-sustained', burstCapacity, refillRate);
      }

      // Should be denied immediately
      const denied = await limiter.check('test-sustained', burstCapacity, refillRate);
      expect(denied.allowed).toBe(false);

      // Wait for one token to refill (6000ms)
      await new Promise(resolve => setTimeout(resolve, 6100));

      // Should now allow one request
      const allowed = await limiter.check('test-sustained', burstCapacity, refillRate);
      expect(allowed.allowed).toBe(true);
      expect(allowed.remaining).toBe(0);
    });

    it('does not refill beyond burst capacity', async () => {
      const burstCapacity = 10;
      const refillRate = 60; // 60 per minute = 1 per second

      // Use 3 tokens
      await limiter.check('test-max-cap', burstCapacity, refillRate);
      await limiter.check('test-max-cap', burstCapacity, refillRate);
      await limiter.check('test-max-cap', burstCapacity, refillRate);

      // Wait long enough to refill more than capacity (10+ seconds)
      await new Promise(resolve => setTimeout(resolve, 11000));

      // Remaining should be capped at burstCapacity, not exceed it
      const result = await limiter.check('test-max-cap', burstCapacity, refillRate);
      expect(result.remaining).toBeLessThanOrEqual(burstCapacity);
    }, 15000);
  });

  describe('refill timing', () => {
    it('refills tokens based on elapsed time', async () => {
      const burstCapacity = 20;
      const refillRate = 60; // 60 per minute = 1 per second

      // Use 10 tokens
      for (let i = 0; i < 10; i++) {
        await limiter.check('test-refill-timing', burstCapacity, refillRate);
      }

      // Wait 5 seconds -> should refill ~5 tokens
      await new Promise(resolve => setTimeout(resolve, 5100));

      const result = await limiter.check('test-refill-timing', burstCapacity, refillRate);
      expect(result.allowed).toBe(true);
      // Started with 10 remaining after burst, refilled ~5, used 1 = ~14 remaining
      expect(result.remaining).toBeGreaterThanOrEqual(13);
      expect(result.remaining).toBeLessThanOrEqual(15);
    });

    it('handles fractional token refills correctly', async () => {
      const burstCapacity = 10;
      const refillRate = 5; // 5 per minute = 1 token every 12 seconds

      // Use all tokens
      for (let i = 0; i < burstCapacity; i++) {
        await limiter.check('test-fractional', burstCapacity, refillRate);
      }

      // Wait 6 seconds (should refill 0.5 tokens, rounded down to 0)
      await new Promise(resolve => setTimeout(resolve, 6100));
      const denied = await limiter.check('test-fractional', burstCapacity, refillRate);
      expect(denied.allowed).toBe(false);

      // Wait another 7 seconds (total 13s -> 1+ token refilled)
      await new Promise(resolve => setTimeout(resolve, 7000));
      const allowed = await limiter.check('test-fractional', burstCapacity, refillRate);
      expect(allowed.allowed).toBe(true);
    }, 15000);
  });

  describe('concurrent requests', () => {
    it('handles concurrent requests atomically', async () => {
      const burstCapacity = 10;
      const refillRate = 5;
      const concurrency = 20;

      // Launch 20 concurrent requests for the same key
      const results = await Promise.all(
        Array.from({ length: concurrency }, () =>
          limiter.check('test-concurrent', burstCapacity, refillRate)
        )
      );

      // Exactly 10 should be allowed (burst capacity)
      const allowedCount = results.filter(r => r.allowed).length;
      expect(allowedCount).toBe(burstCapacity);

      // Exactly 10 should be denied
      const deniedCount = results.filter(r => !r.allowed).length;
      expect(deniedCount).toBe(concurrency - burstCapacity);
    });

    it('prevents race conditions between concurrent keys', async () => {
      const burstCapacity = 5;
      const refillRate = 10;

      // Each key should get its own independent bucket
      const results = await Promise.all([
        limiter.check('key-a', burstCapacity, refillRate),
        limiter.check('key-b', burstCapacity, refillRate),
        limiter.check('key-a', burstCapacity, refillRate),
        limiter.check('key-b', burstCapacity, refillRate),
      ]);

      expect(results[0].allowed).toBe(true);
      expect(results[1].allowed).toBe(true);
      expect(results[2].allowed).toBe(true);
      expect(results[3].allowed).toBe(true);
    });
  });

  describe('per-tier configuration', () => {
    it('enforces free tier limits (10 burst, 5/min)', async () => {
      const burstCapacity = 10;
      const refillRate = 5;

      // Use all burst
      for (let i = 0; i < burstCapacity; i++) {
        const result = await limiter.check('free-tier', burstCapacity, refillRate);
        expect(result.allowed).toBe(true);
      }

      // Should deny next
      const denied = await limiter.check('free-tier', burstCapacity, refillRate);
      expect(denied.allowed).toBe(false);
    });

    it('enforces starter tier limits (30 burst, 60/min)', async () => {
      const burstCapacity = 30;
      const refillRate = 60;

      // Use all burst
      for (let i = 0; i < burstCapacity; i++) {
        const result = await limiter.check('starter-tier', burstCapacity, refillRate);
        expect(result.allowed).toBe(true);
      }

      const denied = await limiter.check('starter-tier', burstCapacity, refillRate);
      expect(denied.allowed).toBe(false);
    });

    it('enforces pro tier limits (100 burst, 300/min)', async () => {
      const burstCapacity = 100;
      const refillRate = 300;

      // Use all burst
      for (let i = 0; i < burstCapacity; i++) {
        const result = await limiter.check('pro-tier', burstCapacity, refillRate);
        expect(result.allowed).toBe(true);
      }

      const denied = await limiter.check('pro-tier', burstCapacity, refillRate);
      expect(denied.allowed).toBe(false);
    });

    it('enforces business tier limits (500 burst, 1500/min)', async () => {
      const burstCapacity = 500;
      const refillRate = 1500;

      // Use all burst with concurrent requests (should allow exactly 500)
      const results = await Promise.all(
        Array.from({ length: burstCapacity + 10 }, () =>
          limiter.check('business-tier', burstCapacity, refillRate)
        )
      );

      // Exactly 500 should be allowed
      const allowedCount = results.filter(r => r.allowed).length;
      expect(allowedCount).toBe(burstCapacity);

      // At least 10 should be denied
      const deniedCount = results.filter(r => !r.allowed).length;
      expect(deniedCount).toBeGreaterThanOrEqual(10);
    });
  });

  describe('rate limit headers', () => {
    it('returns X-RateLimit-Limit matching burst capacity', async () => {
      const burstCapacity = 50;
      const refillRate = 100;

      const result = await limiter.check('test-headers', burstCapacity, refillRate);
      expect(result.limit).toBe(burstCapacity);
    });

    it('returns X-RateLimit-Remaining as current token count', async () => {
      const burstCapacity = 20;
      const refillRate = 40;

      const result1 = await limiter.check('test-remaining-header', burstCapacity, refillRate);
      expect(result1.remaining).toBe(burstCapacity - 1);

      const result2 = await limiter.check('test-remaining-header', burstCapacity, refillRate);
      expect(result2.remaining).toBe(burstCapacity - 2);
    });

    it('returns X-RateLimit-Reset as Unix epoch timestamp', async () => {
      const burstCapacity = 10;
      const refillRate = 60; // 1 per second

      // Exhaust bucket
      for (let i = 0; i < burstCapacity; i++) {
        await limiter.check('test-reset-header', burstCapacity, refillRate);
      }

      const result = await limiter.check('test-reset-header', burstCapacity, refillRate);
      expect(result.resetAt).toBeGreaterThan(Date.now());
      // Reset should be approximately 1 second from now (when next token refills)
      expect(result.resetAt).toBeLessThanOrEqual(Date.now() + 2000);
    });

    it('includes Retry-After in seconds when denied', async () => {
      const burstCapacity = 5;
      const refillRate = 60; // 1 per second

      // Exhaust bucket
      for (let i = 0; i < burstCapacity; i++) {
        await limiter.check('test-retry-after', burstCapacity, refillRate);
      }

      const denied = await limiter.check('test-retry-after', burstCapacity, refillRate);
      expect(denied.allowed).toBe(false);
      expect(denied.resetAt).toBeGreaterThan(Date.now());

      const retryAfterSeconds = Math.ceil((denied.resetAt - Date.now()) / 1000);
      expect(retryAfterSeconds).toBeGreaterThanOrEqual(0);
      expect(retryAfterSeconds).toBeLessThanOrEqual(2);
    });
  });

  describe('input validation', () => {
    it('rejects zero burst capacity', async () => {
      await expect(limiter.check('test-zero-burst', 0, 5)).rejects.toThrow(
        'burstCapacity must be a positive number'
      );
    });

    it('rejects negative burst capacity', async () => {
      await expect(limiter.check('test-neg-burst', -10, 5)).rejects.toThrow(
        'burstCapacity must be a positive number'
      );
    });

    it('rejects negative refill rate', async () => {
      await expect(limiter.check('test-neg-refill', 10, -5)).rejects.toThrow(
        'refillRatePerMin must be non-negative'
      );
    });

    it('allows zero refill rate (fixed capacity bucket)', async () => {
      const burstCapacity = 3;
      const refillRate = 0;

      // Should allow burst
      for (let i = 0; i < burstCapacity; i++) {
        const result = await limiter.check('test-zero-refill', burstCapacity, refillRate);
        expect(result.allowed).toBe(true);
      }

      // Should deny with no refill
      const denied = await limiter.check('test-zero-refill', burstCapacity, refillRate);
      expect(denied.allowed).toBe(false);
      expect(denied.remaining).toBe(0);
    });
  });

  describe('graceful degradation', () => {
    it('allows requests when Redis is down', async () => {
      const brokenLimiter = new TokenBucketRateLimiter('redis://invalid-host:9999');

      // Should gracefully degrade to allowing requests
      const result = await brokenLimiter.check('test-redis-down', 10, 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10);
      expect(result.limit).toBe(10);

      await brokenLimiter.close();
    });

    it('handles Redis errors gracefully', async () => {
      const burstCapacity = 10;
      const refillRate = 5;

      // Mock Redis eval to fail — access private redis for testing
      const redis = (limiter as unknown as Record<string, Record<string, unknown>>).redis;
      const originalEval = redis.eval;
      redis.eval = vi.fn().mockRejectedValue(new Error('Redis connection lost'));

      const result = await limiter.check('test-error', burstCapacity, refillRate);
      expect(result.allowed).toBe(true);

      // Restore original
      redis.eval = originalEval;
    });
  });

  describe('isolation', () => {
    it('isolates different API keys', async () => {
      const burstCapacity = 3;
      const refillRate = 10;

      // Exhaust key-1
      await limiter.check('key-1', burstCapacity, refillRate);
      await limiter.check('key-1', burstCapacity, refillRate);
      await limiter.check('key-1', burstCapacity, refillRate);

      const denied1 = await limiter.check('key-1', burstCapacity, refillRate);
      expect(denied1.allowed).toBe(false);

      // key-2 should have full bucket
      const allowed2 = await limiter.check('key-2', burstCapacity, refillRate);
      expect(allowed2.allowed).toBe(true);
      expect(allowed2.remaining).toBe(burstCapacity - 1);
    });
  });
});
