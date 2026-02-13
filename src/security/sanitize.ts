import { isPrivateUrl } from '../renderer/schemas.js';

const MAX_SELECTOR_LENGTH = 500;
const MAX_WAIT_FOR_LENGTH = 500;
const MAX_TEMPLATE_LENGTH = 10_000;
const MAX_URL_LENGTH = 2048;
const MAX_CALLBACK_URL_LENGTH = 2048;
const MAX_CUSTOM_CSS_LENGTH = 50 * 1024; // 50KB
const MAX_CUSTOM_JS_LENGTH = 10 * 1024; // 10KB

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

export class SanitizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SanitizeError';
  }
}
