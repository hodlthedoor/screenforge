import { describe, it, expect } from 'vitest';
import {
  classifyError,
  getMaxRetries,
  calculateBackoff,
  shouldRetry,
  ErrorCategory,
} from '../../src/queue/retry-policy.js';

describe('classifyError', () => {
  it('classifies network timeout as TRANSIENT', () => {
    expect(classifyError(new Error('Navigation timeout of 30000ms exceeded'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies DNS failure as TRANSIENT', () => {
    expect(classifyError(new Error('net::ERR_NAME_NOT_RESOLVED'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies connection refused as TRANSIENT', () => {
    expect(classifyError(new Error('net::ERR_CONNECTION_REFUSED'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies connection reset as TRANSIENT', () => {
    expect(classifyError(new Error('net::ERR_CONNECTION_RESET'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies temporary browser crash as TRANSIENT', () => {
    expect(classifyError(new Error('Browser closed unexpectedly'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies ECONNREFUSED as TRANSIENT', () => {
    expect(classifyError(new Error('connect ECONNREFUSED 127.0.0.1:3000'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies ETIMEDOUT as TRANSIENT', () => {
    expect(classifyError(new Error('connect ETIMEDOUT'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies invalid URL as PERMANENT', () => {
    expect(classifyError(new Error('Invalid URL: not-a-url'))).toBe(ErrorCategory.PERMANENT);
  });

  it('classifies SSRF blocked as PERMANENT', () => {
    expect(classifyError(new Error('SSRF: private IP blocked'))).toBe(ErrorCategory.PERMANENT);
  });

  it('classifies 404 as PERMANENT', () => {
    expect(classifyError(new Error('Page returned HTTP 404'))).toBe(ErrorCategory.PERMANENT);
  });

  it('classifies 403 as PERMANENT', () => {
    expect(classifyError(new Error('Page returned HTTP 403'))).toBe(ErrorCategory.PERMANENT);
  });

  it('classifies 401 as PERMANENT', () => {
    expect(classifyError(new Error('Page returned HTTP 401'))).toBe(ErrorCategory.PERMANENT);
  });

  it('classifies protocol error as PERMANENT', () => {
    expect(classifyError(new Error('Protocol error: invalid URL scheme'))).toBe(ErrorCategory.PERMANENT);
  });

  it('classifies browser OOM as RESOURCE', () => {
    expect(classifyError(new Error('Page crashed! Out of memory'))).toBe(ErrorCategory.RESOURCE);
  });

  it('classifies pool exhausted as RESOURCE', () => {
    expect(classifyError(new Error('Browser pool exhausted'))).toBe(ErrorCategory.RESOURCE);
  });

  it('classifies context creation failure as RESOURCE', () => {
    expect(classifyError(new Error('Failed to create browser context'))).toBe(ErrorCategory.RESOURCE);
  });

  it('defaults unknown errors to TRANSIENT', () => {
    expect(classifyError(new Error('Something went wrong'))).toBe(ErrorCategory.TRANSIENT);
  });
});

describe('getMaxRetries', () => {
  it('returns 2 for free tier', () => {
    expect(getMaxRetries('free')).toBe(2);
  });

  it('returns 3 for starter tier', () => {
    expect(getMaxRetries('starter')).toBe(3);
  });

  it('returns 5 for pro tier', () => {
    expect(getMaxRetries('pro')).toBe(5);
  });

  it('returns 10 for business tier', () => {
    expect(getMaxRetries('business')).toBe(10);
  });

  it('defaults unknown tiers to free (2)', () => {
    expect(getMaxRetries('unknown')).toBe(2);
  });
});

describe('calculateBackoff', () => {
  it('returns exponentially increasing delays for TRANSIENT', () => {
    const d0 = calculateBackoff(ErrorCategory.TRANSIENT, 0);
    const d1 = calculateBackoff(ErrorCategory.TRANSIENT, 1);
    const d2 = calculateBackoff(ErrorCategory.TRANSIENT, 2);

    // Base delay is 1000ms for transient
    // attempt 0: 1000 * 2^0 = 1000 + jitter (0-1000)
    expect(d0).toBeGreaterThanOrEqual(1000);
    expect(d0).toBeLessThanOrEqual(2000);

    // attempt 1: 1000 * 2^1 = 2000 + jitter (0-1000)
    expect(d1).toBeGreaterThanOrEqual(2000);
    expect(d1).toBeLessThanOrEqual(3000);

    // attempt 2: 1000 * 2^2 = 4000 + jitter (0-1000)
    expect(d2).toBeGreaterThanOrEqual(4000);
    expect(d2).toBeLessThanOrEqual(5000);
  });

  it('returns longer delays for RESOURCE errors', () => {
    const d0 = calculateBackoff(ErrorCategory.RESOURCE, 0);
    const d1 = calculateBackoff(ErrorCategory.RESOURCE, 1);

    // Base delay is 5000ms for resource
    // attempt 0: 5000 * 2^0 = 5000 + jitter (0-1000)
    expect(d0).toBeGreaterThanOrEqual(5000);
    expect(d0).toBeLessThanOrEqual(6000);

    // attempt 1: 5000 * 2^1 = 10000 + jitter (0-1000)
    expect(d1).toBeGreaterThanOrEqual(10000);
    expect(d1).toBeLessThanOrEqual(11000);
  });

  it('jitter is within 0-1000ms bounds', () => {
    // Run multiple times to check jitter is always in bounds
    for (let i = 0; i < 50; i++) {
      const delay = calculateBackoff(ErrorCategory.TRANSIENT, 0);
      // base = 1000, jitter 0-1000
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(2000);
    }
  });
});

describe('shouldRetry', () => {
  it('returns true for TRANSIENT error within retry limit', () => {
    const result = shouldRetry(ErrorCategory.TRANSIENT, 0, 'free');
    expect(result.retry).toBe(true);
    expect(result.delayMs).toBeGreaterThan(0);
  });

  it('returns false for PERMANENT error (never retry)', () => {
    const result = shouldRetry(ErrorCategory.PERMANENT, 0, 'business');
    expect(result.retry).toBe(false);
  });

  it('returns true for RESOURCE error within retry limit', () => {
    const result = shouldRetry(ErrorCategory.RESOURCE, 0, 'free');
    expect(result.retry).toBe(true);
    expect(result.delayMs).toBeGreaterThanOrEqual(5000);
  });

  it('returns false when attempt count exceeds tier max retries', () => {
    // free tier max = 2
    const result = shouldRetry(ErrorCategory.TRANSIENT, 2, 'free');
    expect(result.retry).toBe(false);
  });

  it('allows more retries for higher tiers', () => {
    // business tier max = 10, attempt 5 should still retry
    const result = shouldRetry(ErrorCategory.TRANSIENT, 5, 'business');
    expect(result.retry).toBe(true);
  });

  it('PERMANENT errors never retry regardless of tier', () => {
    for (const tier of ['free', 'starter', 'pro', 'business']) {
      const result = shouldRetry(ErrorCategory.PERMANENT, 0, tier);
      expect(result.retry).toBe(false);
    }
  });
});
