import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/config/index.js';
import {
  sanitizeSelector,
  sanitizeWaitFor,
  sanitizeTemplate,
  sanitizeUrl,
  sanitizeCallbackUrl,
  SanitizeError,
} from '../../src/security/sanitize.js';
import { createError, type ErrorCode } from '../../src/security/errors.js';

describe('security', () => {
  describe('sanitizeSelector', () => {
    it('returns undefined for falsy input', () => {
      expect(sanitizeSelector(undefined)).toBeUndefined();
      expect(sanitizeSelector('')).toBeUndefined();
    });

    it('passes valid selectors through', () => {
      expect(sanitizeSelector('.my-class')).toBe('.my-class');
      expect(sanitizeSelector('#id > .child')).toBe('#id > .child');
    });

    it('throws for selectors exceeding 500 chars', () => {
      const longSelector = 'a'.repeat(501);
      expect(() => sanitizeSelector(longSelector)).toThrow(SanitizeError);
      expect(() => sanitizeSelector(longSelector)).toThrow('Selector exceeds maximum length');
    });

    it('allows exactly 500 chars', () => {
      expect(sanitizeSelector('a'.repeat(500))).toBe('a'.repeat(500));
    });
  });

  describe('sanitizeWaitFor', () => {
    it('returns undefined for falsy input', () => {
      expect(sanitizeWaitFor(undefined)).toBeUndefined();
    });

    it('passes valid waitFor through', () => {
      expect(sanitizeWaitFor('.loaded')).toBe('.loaded');
    });

    it('throws for waitFor exceeding 500 chars', () => {
      expect(() => sanitizeWaitFor('a'.repeat(501))).toThrow(SanitizeError);
      expect(() => sanitizeWaitFor('a'.repeat(501))).toThrow('waitFor selector exceeds maximum length');
    });
  });

  describe('sanitizeTemplate', () => {
    it('returns undefined for falsy input', () => {
      expect(sanitizeTemplate(undefined)).toBeUndefined();
    });

    it('passes safe templates through', () => {
      const safe = '<div>Page <span class="pageNumber"></span></div>';
      expect(sanitizeTemplate(safe)).toBe(safe);
    });

    it('throws for templates exceeding 10000 chars', () => {
      expect(() => sanitizeTemplate('a'.repeat(10001))).toThrow('Template exceeds maximum length');
    });

    it('blocks <script> tags', () => {
      expect(() => sanitizeTemplate('<script>alert(1)</script>')).toThrow('potentially dangerous');
    });

    it('blocks <script> tags case-insensitively', () => {
      expect(() => sanitizeTemplate('<SCRIPT>alert(1)</SCRIPT>')).toThrow('potentially dangerous');
    });

    it('blocks javascript: protocol', () => {
      expect(() => sanitizeTemplate('<a href="javascript:void(0)">')).toThrow('potentially dangerous');
    });

    it('blocks event handlers (onclick, onload, etc)', () => {
      expect(() => sanitizeTemplate('<div onclick="alert(1)">')).toThrow('potentially dangerous');
      expect(() => sanitizeTemplate('<img onload ="alert(1)">')).toThrow('potentially dangerous');
      expect(() => sanitizeTemplate('<body onerror= "x">')).toThrow('potentially dangerous');
    });

    it('blocks data:text/html URIs', () => {
      expect(() => sanitizeTemplate('<iframe src="data: text/html,<h1>hi</h1>">')).toThrow('potentially dangerous');
    });
  });

  describe('sanitizeUrl', () => {
    it('passes valid URLs through', () => {
      expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
    });

    it('throws for URLs exceeding 2048 chars', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2040);
      expect(() => sanitizeUrl(longUrl)).toThrow('URL exceeds maximum length');
    });

    it('allows URLs of exactly 2048 chars', () => {
      const url = 'https://e.co/' + 'a'.repeat(2035);
      expect(url.length).toBe(2048);
      expect(sanitizeUrl(url)).toBe(url);
    });
  });

  describe('sanitizeCallbackUrl', () => {
    it('returns undefined for falsy input', () => {
      expect(sanitizeCallbackUrl(undefined)).toBeUndefined();
    });

    it('passes valid http callback URLs', () => {
      expect(sanitizeCallbackUrl('http://example.com/webhook')).toBe('http://example.com/webhook');
      expect(sanitizeCallbackUrl('https://example.com/callback')).toBe('https://example.com/callback');
    });

    it('throws for callback URLs exceeding 2048 chars', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2040);
      expect(() => sanitizeCallbackUrl(longUrl)).toThrow('Callback URL exceeds maximum length');
    });

    it('throws for non-http/https protocols', () => {
      expect(() => sanitizeCallbackUrl('ftp://example.com/file')).toThrow('must use http or https');
      expect(() => sanitizeCallbackUrl('file:///etc/passwd')).toThrow('must use http or https');
    });

    it('throws for invalid URLs', () => {
      expect(() => sanitizeCallbackUrl('not-a-url')).toThrow('Invalid callback URL');
    });
  });

  describe('SanitizeError', () => {
    it('has correct name property', () => {
      const err = new SanitizeError('test');
      expect(err.name).toBe('SanitizeError');
      expect(err.message).toBe('test');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('createError', () => {
    it('creates error with default message', () => {
      const err = createError('VALIDATION_ERROR');
      expect(err).toEqual({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      });
    });

    it('creates error with custom detail', () => {
      const err = createError('INVALID_URL', 'URL must start with https');
      expect(err.error).toBe('URL must start with https');
      expect(err.code).toBe('INVALID_URL');
      expect(err.statusCode).toBe(400);
    });

    it('maps all error codes to correct HTTP status', () => {
      const expectedStatuses: Record<string, number> = {
        VALIDATION_ERROR: 400,
        INVALID_URL: 400,
        SSRF_BLOCKED: 400,
        AUTH_REQUIRED: 401,
        INVALID_API_KEY: 401,
        INVALID_ADMIN_KEY: 401,
        API_KEY_DISABLED: 403,
        QUOTA_EXCEEDED: 429,
        RATE_LIMITED: 429,
        RENDER_TIMEOUT: 504,
        RENDER_FAILED: 500,
        JOB_NOT_FOUND: 404,
        BATCH_NOT_FOUND: 404,
        BATCH_TOO_LARGE: 400,
        ADMIN_NOT_CONFIGURED: 503,
        INTERNAL_ERROR: 500,
      };

      for (const [code, expectedStatus] of Object.entries(expectedStatuses)) {
        const err = createError(code as ErrorCode);
        expect(err.statusCode, `${code} should map to ${expectedStatus}`).toBe(expectedStatus);
      }
    });
  });

  describe('request-id hook', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
      process.env.NODE_ENV = 'test';
      process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
      loadConfig();
      app = await buildServer({ skipBrowserInit: true });
    });

    afterAll(async () => {
      await app.close();
    });

    it('generates X-Request-Id when not provided', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-request-id']).toBeDefined();
      expect(typeof res.headers['x-request-id']).toBe('string');
      // UUID format
      expect(res.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('passes through provided X-Request-Id', async () => {
      const customId = 'my-custom-request-123';
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-request-id': customId },
      });
      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('includes X-Request-Id on error responses', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/nonexistent' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['x-request-id']).toBeDefined();
    });
  });
});
