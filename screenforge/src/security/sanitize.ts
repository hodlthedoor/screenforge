const MAX_SELECTOR_LENGTH = 500;
const MAX_WAIT_FOR_LENGTH = 500;
const MAX_TEMPLATE_LENGTH = 10_000;
const MAX_URL_LENGTH = 2048;
const MAX_CALLBACK_URL_LENGTH = 2048;

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

export function sanitizeCallbackUrl(input: string | undefined): string | undefined {
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
  return input;
}

export class SanitizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SanitizeError';
  }
}
