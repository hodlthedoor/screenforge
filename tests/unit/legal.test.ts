import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('legal pages', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    app = await buildServer({ skipBrowserInit: true });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /terms', () => {
    it('returns 200 with HTML content type', async () => {
      const res = await app.inject({ method: 'GET', url: '/terms' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('contains required Terms of Service sections', async () => {
      const res = await app.inject({ method: 'GET', url: '/terms' });
      const body = res.body.toLowerCase();
      expect(body).toContain('acceptable use');
      expect(body).toContain('rate limit');
      expect(body).toContain('data retention');
    });

    it('contains service description, API key responsibilities, liability, and termination', async () => {
      const res = await app.inject({ method: 'GET', url: '/terms' });
      const body = res.body.toLowerCase();
      expect(body).toContain('api key');
      expect(body).toContain('limitation of liability');
      expect(body).toContain('termination');
    });
  });

  describe('GET /privacy', () => {
    it('returns 200 with HTML content type', async () => {
      const res = await app.inject({ method: 'GET', url: '/privacy' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
    });

    it('contains required Privacy Policy sections', async () => {
      const res = await app.inject({ method: 'GET', url: '/privacy' });
      const body = res.body.toLowerCase();
      expect(body).toContain('data we collect');
      expect(body).toContain('third-party');
      expect(body).toContain('cookies');
      expect(body).toContain('gdpr');
    });

    it('contains data types and deletion rights', async () => {
      const res = await app.inject({ method: 'GET', url: '/privacy' });
      const body = res.body.toLowerCase();
      expect(body).toContain('email');
      expect(body).toContain('ip');
      expect(body).toContain('stripe');
      expect(body).toContain('deletion');
    });
  });
});
