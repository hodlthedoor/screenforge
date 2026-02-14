import { describe, it, expect } from 'vitest';
import { generateWebhookSignature, verifyWebhookSignature, parseSignatureHeader } from '../../src/webhooks/signer.js';

describe('webhook signer', () => {
  const testPayload = '{"jobId":"123","status":"completed"}';
  const testSecret = 'whsec_test_secret_key';
  const testTimestamp = 1707654321;

  describe('generateWebhookSignature', () => {
    it('generates consistent signature for same payload+secret+timestamp', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const sig2 = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      expect(sig1).toBe(sig2);
    });

    it('generates different signatures for different payloads', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const sig2 = generateWebhookSignature('{"different":"payload"}', testSecret, testTimestamp);
      expect(sig1).not.toBe(sig2);
    });

    it('generates different signatures for different secrets', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const sig2 = generateWebhookSignature(testPayload, 'different_secret', testTimestamp);
      expect(sig1).not.toBe(sig2);
    });

    it('generates different signatures for different timestamps', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const sig2 = generateWebhookSignature(testPayload, testSecret, testTimestamp + 100);
      expect(sig1).not.toBe(sig2);
    });

    it('returns signature in t=timestamp,v1=hmac format', () => {
      const sig = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      expect(sig).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
      expect(sig).toContain(`t=${testTimestamp}`);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('accepts valid signature', () => {
      const signature = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const result = verifyWebhookSignature(testPayload, signature, testSecret);
      expect(result.valid).toBe(true);
      expect(result.timestamp).toBe(testTimestamp);
    });

    it('rejects tampered payload', () => {
      const signature = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const result = verifyWebhookSignature('{"tampered":"data"}', signature, testSecret);
      expect(result.valid).toBe(false);
    });

    it('rejects wrong secret', () => {
      const signature = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const result = verifyWebhookSignature(testPayload, signature, 'wrong_secret');
      expect(result.valid).toBe(false);
    });

    it('rejects tampered timestamp', () => {
      const signature = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const tamperedSig = signature.replace(`t=${testTimestamp}`, `t=${testTimestamp + 100}`);
      const result = verifyWebhookSignature(testPayload, tamperedSig, testSecret);
      expect(result.valid).toBe(false);
    });

    it('rejects signature older than tolerance', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400s ago (exceeds default 300s tolerance)
      const signature = generateWebhookSignature(testPayload, testSecret, oldTimestamp);
      const result = verifyWebhookSignature(testPayload, signature, testSecret, 300);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('accepts signature within tolerance', () => {
      const recentTimestamp = Math.floor(Date.now() / 1000) - 100; // 100s ago (within 300s tolerance)
      const signature = generateWebhookSignature(testPayload, testSecret, recentTimestamp);
      const result = verifyWebhookSignature(testPayload, signature, testSecret, 300);
      expect(result.valid).toBe(true);
    });

    it('rejects signature from the future', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 400; // 400s in future (exceeds tolerance)
      const signature = generateWebhookSignature(testPayload, testSecret, futureTimestamp);
      const result = verifyWebhookSignature(testPayload, signature, testSecret, 300);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('future');
    });

    it('accepts signature slightly in the future within tolerance', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 100; // 100s in future (within 300s tolerance)
      const signature = generateWebhookSignature(testPayload, testSecret, futureTimestamp);
      const result = verifyWebhookSignature(testPayload, signature, testSecret, 300);
      expect(result.valid).toBe(true);
    });

    it('rejects malformed signature', () => {
      const result = verifyWebhookSignature(testPayload, 'invalid-format', testSecret);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('malformed');
    });
  });

  describe('parseSignatureHeader', () => {
    it('parses valid signature header', () => {
      const header = `t=${testTimestamp},v1=abc123def456`;
      const result = parseSignatureHeader(header);
      expect(result).toEqual({
        timestamp: testTimestamp,
        signature: 'abc123def456',
      });
    });

    it('returns null for malformed header', () => {
      expect(parseSignatureHeader('invalid')).toBeNull();
      expect(parseSignatureHeader('t=123')).toBeNull();
      expect(parseSignatureHeader('v1=abc')).toBeNull();
      expect(parseSignatureHeader('')).toBeNull();
    });

    it('returns null for missing parts', () => {
      expect(parseSignatureHeader('t=,v1=abc')).toBeNull();
      expect(parseSignatureHeader('t=123,v1=')).toBeNull();
    });
  });
});
