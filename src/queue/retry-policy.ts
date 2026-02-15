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
];

const PERMANENT_PATTERNS = [
  /Invalid URL/i,
  /SSRF/i,
  /private IP blocked/i,
  /HTTP 4(?:0[0-46-9]|1\d|2\d|3\d|4\d|5\d)/i, // 400-459 except 408 (timeout)
  /HTTP 404/i,
  /HTTP 403/i,
  /HTTP 401/i,
  /HTTP 410/i,
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

export function calculateBackoff(category: ErrorCategory, attempt: number): number {
  const base = BASE_DELAY[category];
  const exponential = base * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 1000);
  return exponential + jitter;
}

export interface RetryDecision {
  retry: boolean;
  delayMs?: number;
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
