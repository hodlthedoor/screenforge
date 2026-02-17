import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkRateLimit } from '../../src/auth/rate-limit-check.js';
import type { SlidingWindowRateLimiter } from '../../src/auth/rate-limiter.js';
import type { TokenBucketRateLimiter } from '../../src/auth/token-bucket.js';
import type { RateLimitResult } from '../../src/auth/rate-limit-types.js';
import type { Config } from '../../src/config/index.js';

// Mock config module
vi.mock('../../src/config/index.js', () => ({
  getConfig: vi.fn(),
}));

// Mock billing/plans module
vi.mock('../../src/billing/plans.js', () => ({
  getPlanByTier: vi.fn(),
}));

import { getConfig } from '../../src/config/index.js';
import { getPlanByTier } from '../../src/billing/plans.js';

const mockedGetConfig = vi.mocked(getConfig);
const mockedGetPlanByTier = vi.mocked(getPlanByTier);

function makeSlidingWindowMock(result: RateLimitResult) {
  return {
    check: vi.fn().mockResolvedValue(result),
    close: vi.fn(),
  } as unknown as SlidingWindowRateLimiter;
}

function makeTokenBucketMock(result: RateLimitResult) {
  return {
    check: vi.fn().mockResolvedValue(result),
    close: vi.fn(),
  } as unknown as TokenBucketRateLimiter;
}

describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when TOKEN_BUCKET_ENABLED is false (sliding window)', () => {
    beforeEach(() => {
      mockedGetConfig.mockReturnValue({ TOKEN_BUCKET_ENABLED: false } as Config);
    });

    it('delegates to sliding window limiter with key and rate limit', async () => {
      const expected: RateLimitResult = { allowed: true, remaining: 9, limit: 10, resetAt: Date.now() + 60000 };
      const limiter = makeSlidingWindowMock(expected);

      const result = await checkRateLimit(limiter, 'key-123', 'free', 10);

      expect(result).toEqual(expected);
      expect(vi.mocked(limiter.check)).toHaveBeenCalledWith('key-123', 10);
    });

    it('passes through denied results from sliding window', async () => {
      const expected: RateLimitResult = { allowed: false, remaining: 0, limit: 10, resetAt: Date.now() + 60000 };
      const limiter = makeSlidingWindowMock(expected);

      const result = await checkRateLimit(limiter, 'key-456', 'free', 10);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('when TOKEN_BUCKET_ENABLED is true', () => {
    beforeEach(() => {
      mockedGetConfig.mockReturnValue({ TOKEN_BUCKET_ENABLED: true } as Config);
    });

    it('delegates to token bucket limiter with plan burst/refill params', async () => {
      mockedGetPlanByTier.mockReturnValue({
        name: 'Starter', tier: 'starter', priceMonthly: 29,
        stripePriceId: 'price_starter', rateLimit: 50, monthlyQuota: 5000,
        maxSchedules: 10, maxExtractionsDaily: 50, maxAccessibilityDaily: 25,
        burstCapacity: 30, refillRatePerMin: 60,
      });

      const expected: RateLimitResult = { allowed: true, remaining: 29, limit: 30, resetAt: Date.now() + 1000 };
      const limiter = makeTokenBucketMock(expected);

      const result = await checkRateLimit(limiter, 'key-789', 'starter', 50);

      expect(result).toEqual(expected);
      expect(vi.mocked(limiter.check)).toHaveBeenCalledWith('key-789', 30, 60);
      expect(mockedGetPlanByTier).toHaveBeenCalledWith('starter');
    });

    it('throws on invalid tier', async () => {
      mockedGetPlanByTier.mockReturnValue(undefined);
      const limiter = makeTokenBucketMock({ allowed: true, remaining: 10, limit: 10, resetAt: Date.now() });

      await expect(checkRateLimit(limiter, 'key-bad', 'nonexistent', 10))
        .rejects.toThrow('Invalid tier: nonexistent');
    });

    it('passes through denied results from token bucket', async () => {
      mockedGetPlanByTier.mockReturnValue({
        name: 'Free', tier: 'free', priceMonthly: 0,
        stripePriceId: null, rateLimit: 10, monthlyQuota: 100,
        maxSchedules: 3, maxExtractionsDaily: 10, maxAccessibilityDaily: 5,
        burstCapacity: 10, refillRatePerMin: 5,
      });

      const expected: RateLimitResult = { allowed: false, remaining: 0, limit: 10, resetAt: Date.now() + 12000 };
      const limiter = makeTokenBucketMock(expected);

      const result = await checkRateLimit(limiter, 'key-denied', 'free', 10);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });
});
