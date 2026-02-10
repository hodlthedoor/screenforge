export const ERROR_CODES = {
  VALIDATION_ERROR: { status: 400, message: 'Validation failed' },
  INVALID_URL: { status: 400, message: 'Invalid or blocked URL' },
  SSRF_BLOCKED: { status: 400, message: 'URLs targeting private networks are not allowed' },
  AUTH_REQUIRED: { status: 401, message: 'API key required' },
  INVALID_API_KEY: { status: 401, message: 'Invalid API key' },
  INVALID_ADMIN_KEY: { status: 401, message: 'Invalid admin API key' },
  API_KEY_DISABLED: { status: 403, message: 'API key is disabled' },
  QUOTA_EXCEEDED: { status: 429, message: 'Monthly quota exceeded' },
  RATE_LIMITED: { status: 429, message: 'Rate limit exceeded' },
  RENDER_TIMEOUT: { status: 504, message: 'Render timed out' },
  RENDER_FAILED: { status: 500, message: 'Render failed' },
  JOB_NOT_FOUND: { status: 404, message: 'Job not found' },
  BATCH_NOT_FOUND: { status: 404, message: 'Batch not found' },
  BATCH_TOO_LARGE: { status: 400, message: 'Batch exceeds maximum of 50 requests' },
  ADMIN_NOT_CONFIGURED: { status: 503, message: 'Admin API not configured' },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function createError(code: ErrorCode, detail?: string, extra?: Record<string, unknown>) {
  const def = ERROR_CODES[code];
  return {
    error: detail ?? def.message,
    code,
    statusCode: def.status,
    ...extra,
  };
}
