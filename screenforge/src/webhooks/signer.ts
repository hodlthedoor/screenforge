import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignatureVerificationResult {
  valid: boolean;
  timestamp?: number;
  error?: string;
}

export interface ParsedSignature {
  timestamp: number;
  signature: string;
}

export function generateWebhookSignature(payload: string, secret: string, timestamp: number): string {
  const signedPayload = `${timestamp}.${payload}`;
  const hmac = createHmac('sha256', secret);
  hmac.update(signedPayload);
  const signature = hmac.digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export function parseSignatureHeader(header: string): ParsedSignature | null {
  const parts = header.split(',');
  const tPart = parts.find((p) => p.startsWith('t='));
  const v1Part = parts.find((p) => p.startsWith('v1='));

  if (!tPart || !v1Part) return null;

  const timestamp = parseInt(tPart.slice(2), 10);
  const signature = v1Part.slice(3);

  if (isNaN(timestamp) || !signature) return null;

  return { timestamp, signature };
}

export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds?: number,
): SignatureVerificationResult {
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return { valid: false, error: 'malformed signature header' };
  }

  const { timestamp, signature } = parsed;

  // Check timestamp tolerance (only if specified)
  if (toleranceSeconds !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    if (now - timestamp > toleranceSeconds) {
      return { valid: false, timestamp, error: 'signature expired' };
    }
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const hmac = createHmac('sha256', secret);
  hmac.update(signedPayload);
  const expectedSignature = hmac.digest('hex');

  // Timing-safe comparison
  if (signature.length !== expectedSignature.length) {
    return { valid: false, timestamp };
  }

  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  try {
    if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { valid: false, timestamp };
    }
  } catch {
    return { valid: false, timestamp };
  }

  return { valid: true, timestamp };
}
