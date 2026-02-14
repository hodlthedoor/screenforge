import { isPrivateUrl } from '../renderer/schemas.js';

const MAX_SELECTOR_LENGTH = 500;
const MAX_WAIT_FOR_LENGTH = 500;
const MAX_TEMPLATE_LENGTH = 10_000;
const MAX_URL_LENGTH = 2048;
const MAX_CALLBACK_URL_LENGTH = 2048;
const MAX_CUSTOM_CSS_LENGTH = 50 * 1024; // 50KB
const MAX_CUSTOM_JS_LENGTH = 10 * 1024; // 10KB
const MAX_HEADER_VALUE_LENGTH = 10_000;
const MAX_COOKIE_NAME_LENGTH = 500;
const MAX_COOKIE_VALUE_LENGTH = 5000;
const MAX_COOKIE_DOMAIN_LENGTH = 500;
const MAX_COOKIE_PATH_LENGTH = 500;

const DANGEROUS_PATTERNS = [
  /<script[^>]*>/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /data:\s*text\/html/i,
];

export function sanitizeSelector(input: string | undefined): string | undefined {
  if (!input) return undefined;
  if (input.length > MAX_SELECTOR_LENGTH) {
    throw new SanitizeError('Selector exceeds maximum length');
  }
  return input;
}

export function sanitizeWaitFor(input: string | undefined): string | undefined {
  if (!input) return undefined;
  if (input.length > MAX_WAIT_FOR_LENGTH) {
    throw new SanitizeError('waitFor selector exceeds maximum length');
  }
  return input;
}

export function sanitizeTemplate(input: string | undefined): string | undefined {
  if (!input) return undefined;
  if (input.length > MAX_TEMPLATE_LENGTH) {
    throw new SanitizeError('Template exceeds maximum length');
  }
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(input)) {
      throw new SanitizeError('Template contains potentially dangerous content');
    }
  }
  return input;
}

export function sanitizeUrl(input: string): string {
  if (input.length > MAX_URL_LENGTH) {
    throw new SanitizeError('URL exceeds maximum length');
  }
  return input;
}

export function sanitizeCallbackUrl(input: string | undefined, allowPrivate = false): string | undefined {
  if (!input) return undefined;
  if (input.length > MAX_CALLBACK_URL_LENGTH) {
    throw new SanitizeError('Callback URL exceeds maximum length');
  }
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new SanitizeError('Callback URL must use http or https protocol');
    }
  } catch (e) {
    if (e instanceof SanitizeError) throw e;
    throw new SanitizeError('Invalid callback URL');
  }
  if (!allowPrivate && isPrivateUrl(input)) {
    throw new SanitizeError('Callback URL must not target private/internal networks');
  }
  return input;
}

const DANGEROUS_JS_PATTERNS = [
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bnew\s+Function\b/,
  /=\s*Function\b/,
  /\bimport\s*\(/,
];

export function sanitizeCustomJs(input: string): string {
  if (Buffer.byteLength(input, 'utf-8') > MAX_CUSTOM_JS_LENGTH) {
    throw new SanitizeError('Custom JS exceeds maximum length (10KB)');
  }
  for (const pattern of DANGEROUS_JS_PATTERNS) {
    if (pattern.test(input)) {
      throw new SanitizeError('Custom JS contains dangerous patterns (eval, Function, import())');
    }
  }
  return input;
}

export function sanitizeCustomCss(input: string): string {
  if (Buffer.byteLength(input, 'utf-8') > MAX_CUSTOM_CSS_LENGTH) {
    throw new SanitizeError('Custom CSS exceeds maximum length (50KB)');
  }
  return input;
}

const BLOCKED_HEADERS = ['host', 'content-length', 'transfer-encoding'];

export function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;

  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    // Check for blocked headers (case-insensitive)
    if (BLOCKED_HEADERS.includes(key.toLowerCase())) {
      throw new SanitizeError(`Header "${key}" is not allowed`);
    }

    // Validate value is a string
    if (typeof value !== 'string') {
      throw new SanitizeError(`Header value for "${key}" must be a string`);
    }

    // Check length
    if (value.length > MAX_HEADER_VALUE_LENGTH) {
      throw new SanitizeError(`Header value for "${key}" exceeds maximum length`);
    }

    sanitized[key] = value;
  }

  return sanitized;
}

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export function sanitizeCookies(cookies: Cookie[] | undefined): Cookie[] | undefined {
  if (!cookies) return undefined;

  const sanitized: Cookie[] = [];

  for (const cookie of cookies) {
    // Validate required fields
    if (!cookie.name || typeof cookie.name !== 'string') {
      throw new SanitizeError('Cookie name is required and must be a string');
    }
    if (!cookie.value || typeof cookie.value !== 'string') {
      throw new SanitizeError('Cookie value is required and must be a string');
    }

    // Check name length
    if (cookie.name.length > MAX_COOKIE_NAME_LENGTH) {
      throw new SanitizeError('Cookie name exceeds maximum length');
    }

    // Check value length
    if (cookie.value.length > MAX_COOKIE_VALUE_LENGTH) {
      throw new SanitizeError('Cookie value exceeds maximum length');
    }

    // Check optional domain length
    if (cookie.domain && cookie.domain.length > MAX_COOKIE_DOMAIN_LENGTH) {
      throw new SanitizeError('Cookie domain exceeds maximum length');
    }

    // Check optional path length
    if (cookie.path && cookie.path.length > MAX_COOKIE_PATH_LENGTH) {
      throw new SanitizeError('Cookie path exceeds maximum length');
    }

    sanitized.push({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
    });
  }

  return sanitized;
}

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  url?: string;
}

/** Convert sanitized cookies to Playwright-compatible format, resolving domain/url fields. */
export function toPlaywrightCookies(
  cookies: Cookie[],
  fallbackUrl?: string,
): PlaywrightCookie[] {
  return cookies.map(cookie => {
    const pw: PlaywrightCookie = {
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
    };
    if (cookie.domain) {
      pw.domain = cookie.domain;
      pw.path = cookie.path ?? '/';
    } else if (fallbackUrl) {
      pw.url = fallbackUrl;
    }
    return pw;
  });
}

export class SanitizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SanitizeError';
  }
}
