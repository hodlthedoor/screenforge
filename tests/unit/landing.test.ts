import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('landing page', () => {
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

  it('returns 200 with HTML content type', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('contains hero headline and CTA', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    const body = res.body;
    expect(body).toContain('ScreenForge');
    expect(body).toContain('Screenshot &amp; Render API');
    expect(body).toContain('Get Started');
  });

  it('contains feature grid items', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    const body = res.body;
    expect(body).toContain('Screenshots');
    expect(body).toContain('PDF');
    expect(body).toContain('OG Cards');
    expect(body).toContain('Batch');
    expect(body).toContain('Caching');
    expect(body).toContain('Webhooks');
  });

  it('contains curl code example', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.body).toContain('curl');
    expect(res.body).toContain('/v1/screenshot');
  });

  it('contains pricing table', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    const body = res.body;
    expect(body).toContain('Free');
    expect(body).toContain('Starter');
    expect(body).toContain('Pro');
    expect(body).toContain('Business');
    expect(body).toContain('100 renders/mo');
    expect(body).toContain('5,000 renders/mo');
    expect(body).toContain('25,000 renders/mo');
    expect(body).toContain('Unlimited renders');
    expect(body).toContain('$29');
    expect(body).toContain('$79');
    expect(body).toContain('$199');
  });

  it('contains self-host callout with Docker command', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.body).toContain('docker');
    expect(res.body).toContain('Self-Host');
  });

  it('contains CTA links for signup and checkout', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    const body = res.body;
    expect(body).toContain('href="/register"');
    expect(body).toContain('href="/v1/billing/checkout?plan=starter"');
    expect(body).toContain('href="/v1/billing/checkout?plan=pro"');
    expect(body).toContain('href="/v1/billing/checkout?plan=business"');
  });

  it('contains live demo, comparison table, and testimonials sections', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    const body = res.body;
    expect(body).toContain('Try Live Demo');
    expect(body).toContain('demo-url');
    expect(body).toContain('/v1/screenshot');
    expect(body).toContain('Feature Comparison');
    expect(body).toContain('Concurrent renders');
    expect(body).toContain('Webhook support');
    expect(body).toContain('Custom CSS/JS');
    expect(body).toContain('Priority queue');
    expect(body).toContain('SLA');
    expect(body).toContain('Trusted by teams');
  });

  it('contains legal footer links', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    const body = res.body;
    expect(body).toContain('href="/terms"');
    expect(body).toContain('href="/privacy"');
  });

  it('serves landing page on /pricing alias', async () => {
    const res = await app.inject({ method: 'GET', url: '/pricing' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Pricing');
    expect(res.body).toContain('ScreenForge');
  });
});
