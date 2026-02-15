import { describe, it, expect } from 'vitest';
import {
  classifyError,
  getMaxRetries,
  calculateBackoff,
  shouldRetry,
  classifyPermanentReason,
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

  it('classifies HTTP 408 (Request Timeout) as TRANSIENT', () => {
    expect(classifyError(new Error('Page returned HTTP 408'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies HTTP 429 (Too Many Requests) as TRANSIENT', () => {
    expect(classifyError(new Error('Page returned HTTP 429'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies HTTP 500 as TRANSIENT', () => {
    expect(classifyError(new Error('Page returned HTTP 500'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies HTTP 502 as TRANSIENT', () => {
    expect(classifyError(new Error('Page returned HTTP 502'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies HTTP 503 as TRANSIENT', () => {
    expect(classifyError(new Error('Page returned HTTP 503'))).toBe(ErrorCategory.TRANSIENT);
  });

  it('classifies HTTP 504 as TRANSIENT', () => {
    expect(classifyError(new Error('Page returned HTTP 504'))).toBe(ErrorCategory.TRANSIENT);
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

  it('classifies 400 as PERMANENT', () => {
    expect(classifyError(new Error('Page returned HTTP 400'))).toBe(ErrorCategory.PERMANENT);
  });

  it('classifies 410 as PERMANENT', () => {
    expect(classifyError(new Error('Page returned HTTP 410'))).toBe(ErrorCategory.PERMANENT);
  });

  it('classifies 422 as PERMANENT', () => {
    expect(classifyError(new Error('Page returned HTTP 422'))).toBe(ErrorCategory.PERMANENT);
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

  it('caps backoff at 60 seconds plus jitter', () => {
    // TRANSIENT at attempt 10: 1000 * 2^10 = 1,024,000 → capped to 60,000
    const d10 = calculateBackoff(ErrorCategory.TRANSIENT, 10);
    expect(d10).toBeGreaterThanOrEqual(60000);
    expect(d10).toBeLessThanOrEqual(61000);

    // RESOURCE at attempt 5: 5000 * 2^5 = 160,000 → capped to 60,000
    const r5 = calculateBackoff(ErrorCategory.RESOURCE, 5);
    expect(r5).toBeGreaterThanOrEqual(60000);
    expect(r5).toBeLessThanOrEqual(61000);
  });

  it('caps high attempts to same max (no unbounded growth)', () => {
    const d20 = calculateBackoff(ErrorCategory.TRANSIENT, 20);
    const d30 = calculateBackoff(ErrorCategory.TRANSIENT, 30);
    // Both should be capped at MAX_BACKOFF_MS (60000) + jitter (0-1000)
    expect(d20).toBeLessThanOrEqual(61000);
    expect(d30).toBeLessThanOrEqual(61000);
  });

  it('jitter is within 0-1000ms bounds', () => {
    for (let i = 0; i < 50; i++) {
      const delay = calculateBackoff(ErrorCategory.TRANSIENT, 0);
      // base = 1000, jitter 0-1000
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(2000);
    }
  });
});

describe('classifyPermanentReason', () => {
  it('returns invalid_url for Invalid URL errors', () => {
    expect(classifyPermanentReason(new Error('Invalid URL: not-a-url'))).toBe('invalid_url');
  });

  it('returns invalid_url for ERR_INVALID_URL errors', () => {
    expect(classifyPermanentReason(new Error('net::ERR_INVALID_URL'))).toBe('invalid_url');
  });

  it('returns ssrf_blocked for SSRF errors', () => {
    expect(classifyPermanentReason(new Error('SSRF: private IP blocked'))).toBe('ssrf_blocked');
  });

  it('returns http_client_error for HTTP 4xx errors', () => {
    expect(classifyPermanentReason(new Error('Page returned HTTP 404'))).toBe('http_client_error');
    expect(classifyPermanentReason(new Error('Page returned HTTP 403'))).toBe('http_client_error');
    expect(classifyPermanentReason(new Error('Page returned HTTP 401'))).toBe('http_client_error');
    expect(classifyPermanentReason(new Error('Page returned HTTP 422'))).toBe('http_client_error');
  });

  it('returns protocol_error for protocol errors', () => {
    expect(classifyPermanentReason(new Error('Protocol error: invalid URL scheme'))).toBe('protocol_error');
  });

  it('returns ssl_error for certificate/SSL errors', () => {
    expect(classifyPermanentReason(new Error('net::ERR_CERT_AUTHORITY_INVALID'))).toBe('ssl_error');
    expect(classifyPermanentReason(new Error('net::ERR_SSL_PROTOCOL_ERROR'))).toBe('ssl_error');
  });

  it('returns blocked_by_response for ERR_BLOCKED_BY_RESPONSE', () => {
    expect(classifyPermanentReason(new Error('net::ERR_BLOCKED_BY_RESPONSE'))).toBe('blocked_by_response');
  });

  it('returns aborted for ERR_ABORTED', () => {
    expect(classifyPermanentReason(new Error('net::ERR_ABORTED'))).toBe('aborted');
  });

  it('returns unknown for unrecognized permanent errors', () => {
    expect(classifyPermanentReason(new Error('Some unknown permanent error'))).toBe('unknown');
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
