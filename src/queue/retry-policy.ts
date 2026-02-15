export enum ErrorCategory {
  TRANSIENT = 'transient',
  PERMANENT = 'permanent',
  RESOURCE = 'resource',
}

const TRANSIENT_PATTERNS = [
  /timeout/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /ERR_CONNECTION_REFUSED/i,
  /ERR_CONNECTION_RESET/i,
  /ERR_CONNECTION_TIMED_OUT/i,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /ETIMEDOUT/,
  /EPIPE/,
  /EHOSTUNREACH/,
  /Browser closed unexpectedly/i,
  /Target closed/i,
  /Session closed/i,
  /ERR_NETWORK_CHANGED/i,
  /ERR_INTERNET_DISCONNECTED/i,
  /net::ERR_FAILED/i,
  /ENOTFOUND/,
  /HTTP 408\b/i,
  /HTTP 429\b/i,
  /HTTP 5\d{2}\b/i,
];

const PERMANENT_PATTERNS = [
  /Invalid URL/i,
  /SSRF/i,
  /private IP blocked/i,
  /HTTP 400\b/i,
  /HTTP 401\b/i,
  /HTTP 403\b/i,
  /HTTP 404\b/i,
  /HTTP 405\b/i,
  /HTTP 406\b/i,
  /HTTP 409\b/i,
  /HTTP 410\b/i,
  /HTTP 411\b/i,
  /HTTP 413\b/i,
  /HTTP 415\b/i,
  /HTTP 422\b/i,
  /Protocol error/i,
  /ERR_INVALID_URL/i,
  /ERR_BLOCKED_BY_RESPONSE/i,
  /ERR_CERT_/i,
  /ERR_SSL_/i,
  /ERR_ABORTED/i,
];

const RESOURCE_PATTERNS = [
  /Out of memory/i,
  /OOM/,
  /pool exhausted/i,
  /Failed to create browser context/i,
  /Failed to launch browser/i,
  /Cannot allocate memory/i,
  /ENOMEM/,
  /ERR_INSUFFICIENT_RESOURCES/i,
];

export function classifyError(error: Error): ErrorCategory {
  const msg = error.message;

  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(msg)) return ErrorCategory.PERMANENT;
  }

  for (const pattern of RESOURCE_PATTERNS) {
    if (pattern.test(msg)) return ErrorCategory.RESOURCE;
  }

  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(msg)) return ErrorCategory.TRANSIENT;
  }

  // Unknown errors default to transient (will be retried)
  return ErrorCategory.TRANSIENT;
}

const TIER_MAX_RETRIES: Record<string, number> = {
  free: 2,
  starter: 3,
  pro: 5,
  business: 10,
};

export function getMaxRetries(tier: string): number {
  return TIER_MAX_RETRIES[tier] ?? TIER_MAX_RETRIES.free;
}

const BASE_DELAY: Record<ErrorCategory, number> = {
  [ErrorCategory.TRANSIENT]: 1000,
  [ErrorCategory.PERMANENT]: 0, // never retried
  [ErrorCategory.RESOURCE]: 5000,
};

/** Maximum backoff delay: 60 seconds */
const MAX_BACKOFF_MS = 60_000;

export function calculateBackoff(category: ErrorCategory, attempt: number): number {
  const base = BASE_DELAY[category];
  const exponential = Math.min(base * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = Math.floor(Math.random() * 1000);
  return exponential + jitter;
}

export interface RetryDecision {
  retry: boolean;
  delayMs?: number;
}

/** Fixed set of permanent failure reason labels for Prometheus (prevents cardinality explosion) */
export type PermanentFailureReason =
  | 'invalid_url'
  | 'ssrf_blocked'
  | 'http_client_error'
  | 'protocol_error'
  | 'ssl_error'
  | 'blocked_by_response'
  | 'aborted'
  | 'unknown';

const FAILURE_REASON_PATTERNS: Array<{ pattern: RegExp; reason: PermanentFailureReason }> = [
  { pattern: /Protocol error/i, reason: 'protocol_error' },
  { pattern: /Invalid URL|ERR_INVALID_URL/i, reason: 'invalid_url' },
  { pattern: /SSRF|private IP blocked/i, reason: 'ssrf_blocked' },
  { pattern: /HTTP 4\d{2}/i, reason: 'http_client_error' },
  { pattern: /ERR_CERT_|ERR_SSL_/i, reason: 'ssl_error' },
  { pattern: /ERR_BLOCKED_BY_RESPONSE/i, reason: 'blocked_by_response' },
  { pattern: /ERR_ABORTED/i, reason: 'aborted' },
];

export function classifyPermanentReason(error: Error): PermanentFailureReason {
  const msg = error.message;
  for (const { pattern, reason } of FAILURE_REASON_PATTERNS) {
    if (pattern.test(msg)) return reason;
  }
  return 'unknown';
}

export function shouldRetry(
  category: ErrorCategory,
  attempt: number,
  tier: string,
): RetryDecision {
  if (category === ErrorCategory.PERMANENT) {
    return { retry: false };
  }

  const maxRetries = getMaxRetries(tier);
  if (attempt >= maxRetries) {
    return { retry: false };
  }

  return {
    retry: true,
    delayMs: calculateBackoff(category, attempt),
  };
}
