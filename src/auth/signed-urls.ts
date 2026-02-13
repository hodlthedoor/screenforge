import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignedUrlOptions {
  type: 'screenshot' | 'pdf';
  url?: string;
  html?: string;
  viewport?: { width: number; height: number };
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  selector?: string;
  waitFor?: string;
  darkMode?: boolean;
  deviceScaleFactor?: number;
  // PDF-specific options
  pageSize?: string;
  margins?: { top?: string; right?: string; bottom?: string; left?: string };
  landscape?: boolean;
  printBackground?: boolean;
  scale?: number;
  headerTemplate?: string;
  footerTemplate?: string;
  // Content filtering
  blockAds?: boolean;
  hideCookieConsents?: boolean;
  customCss?: string;
  customJs?: string;
}

export interface ValidationResult {
  valid: boolean;
  apiKeyId?: string;
  error?: 'MISSING_SIGNATURE' | 'MISSING_EXPIRY' | 'EXPIRED' | 'INVALID_SIGNATURE';
}

const MAX_EXPIRY_SECONDS = 30 * 24 * 3600; // 30 days
const DEFAULT_EXPIRY_SECONDS = 3600; // 1 hour

function serializeOptions(options: Record<string, unknown>): string {
  const sorted = Object.keys(options).sort();
  const pairs: string[] = [];

  for (const key of sorted) {
    const value = options[key];
    if (value === undefined || value === null) continue;

    if (typeof value === 'object' && !Array.isArray(value)) {
      // Handle nested objects (like viewport)
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (nestedValue !== undefined && nestedValue !== null) {
          pairs.push(`${key}.${nestedKey}=${encodeURIComponent(String(nestedValue))}`);
        }
      }
    } else {
      pairs.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  }

  return pairs.join('&');
}

function computeSignature(canonicalString: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(canonicalString);
  return hmac.digest('hex');
}

export function generateSignedUrl(
  apiKeyId: string,
  signingSecret: string,
  options: SignedUrlOptions,
  expiresInSeconds: number = DEFAULT_EXPIRY_SECONDS,
): string {
  // Cap expiry at maximum
  const cappedExpiry = Math.min(expiresInSeconds, MAX_EXPIRY_SECONDS);
  const expiresAt = Date.now() + cappedExpiry * 1000;

  // Build canonical query string (without signature)
  const queryParams: Record<string, unknown> = {
    api_key_id: apiKeyId,
    expires: expiresAt,
    ...options,
  };
  delete queryParams.type; // Type is in the path, not query string

  const canonicalQuery = serializeOptions(queryParams);

  // Compute HMAC signature
  const signature = computeSignature(canonicalQuery + expiresAt, signingSecret);

  // Build final signed URL
  const path = options.type === 'screenshot' ? '/v1/signed/screenshot' : '/v1/signed/pdf';
  return `${path}?${canonicalQuery}&signature=${signature}`;
}

export async function validateSignedUrl(
  queryParams: Record<string, string>,
  signingSecret: string,
): Promise<ValidationResult> {
  const { signature, expires, api_key_id: apiKeyId, ...params } = queryParams;

  if (!signature) {
    return { valid: false, error: 'MISSING_SIGNATURE' };
  }

  if (!expires) {
    return { valid: false, error: 'MISSING_EXPIRY' };
  }

  const expiresAt = Number(expires);
  if (Date.now() > expiresAt) {
    return { valid: false, error: 'EXPIRED' };
  }

  // Rebuild canonical query string (same order as generation)
  const canonicalParams: Record<string, unknown> = {
    api_key_id: apiKeyId,
    expires: expiresAt,
    ...params,
  };
  const canonicalQuery = serializeOptions(canonicalParams);

  // Compute expected signature
  const expectedSignature = computeSignature(canonicalQuery + expiresAt, signingSecret);

  // Constant-time comparison
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (signatureBuffer.length !== expectedBuffer.length) {
    return { valid: false, error: 'INVALID_SIGNATURE' };
  }

  const isValid = timingSafeEqual(signatureBuffer, expectedBuffer);

  if (!isValid) {
    return { valid: false, error: 'INVALID_SIGNATURE' };
  }

  return { valid: true, apiKeyId };
}
