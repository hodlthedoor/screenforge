import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { SlidingWindowRateLimiter } from '../../src/auth/rate-limiter.js';
import { Redis } from 'ioredis';

const REDIS_URL = 'redis://127.0.0.1:6379/15';

describe('SlidingWindowRateLimiter', () => {
  let limiter: SlidingWindowRateLimiter;
  let redis: Redis;

  beforeAll(() => {
    limiter = new SlidingWindowRateLimiter(REDIS_URL);
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
  });

  beforeEach(async () => {
    // Clean up rate limit keys
    const keys = await redis.keys('screenforge:ratelimit:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    await limiter.close();
    redis.disconnect();
  });

  it('allows requests under the limit', async () => {
    const result = await limiter.check('test-key-1', 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeLessThanOrEqual(10);
    expect(result.limit).toBe(10);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });

  it('tracks remaining count correctly', async () => {
    const limit = 5;
    for (let i = 0; i < 3; i++) {
      await limiter.check('test-key-remaining', limit);
    }
    const result = await limiter.check('test-key-remaining', limit);
    expect(result.allowed).toBe(true);
    // After 4 requests, remaining = 5 - 4 = 1
    expect(result.remaining).toBe(1);
  });

  it('blocks requests over the limit', async () => {
    const limit = 3;
    // Make exactly limit requests
    for (let i = 0; i < limit; i++) {
      const r = await limiter.check('test-key-block', limit);
      expect(r.allowed).toBe(true);
    }
    // Next request should be blocked
    const blocked = await limiter.check('test-key-block', limit);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('returns correct limit value', async () => {
    const result10 = await limiter.check('test-key-limit-10', 10);
    expect(result10.limit).toBe(10);

    const result200 = await limiter.check('test-key-limit-200', 200);
    expect(result200.limit).toBe(200);
  });

  it('returns resetAt in the future', async () => {
    const before = Date.now();
    const result = await limiter.check('test-key-reset', 10);
    // resetAt should be roughly now + 60s (default window)
    expect(result.resetAt).toBeGreaterThan(before);
    expect(result.resetAt).toBeLessThanOrEqual(before + 61_000);
  });

  it('isolates different keys', async () => {
    const limit = 2;
    // Exhaust key A
    await limiter.check('key-a', limit);
    await limiter.check('key-a', limit);
    const blockedA = await limiter.check('key-a', limit);
    expect(blockedA.allowed).toBe(false);

    // Key B should still be allowed
    const allowedB = await limiter.check('key-b', limit);
    expect(allowedB.allowed).toBe(true);
  });
});
