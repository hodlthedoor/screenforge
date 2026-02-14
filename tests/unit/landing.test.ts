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

  describe('SEO meta tags', () => {
    it('contains essential meta tags', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const body = res.body;
      expect(body).toContain('<meta name="description"');
      expect(body).toContain('og:title');
      expect(body).toContain('og:description');
      expect(body).toContain('og:image');
      expect(body).toContain('og:url');
      expect(body).toContain('twitter:card');
      expect(body).toContain('twitter:title');
      expect(body).toContain('twitter:description');
    });

    it('contains JSON-LD structured data', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const body = res.body;
      expect(body).toContain('application/ld+json');
      expect(body).toContain('SoftwareApplication');
      expect(body).toContain('schema.org');
    });

    it('contains canonical link', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.body).toContain('<link rel="canonical"');
    });
  });

  describe('cache headers', () => {
    it('sets Cache-Control on landing page', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.headers['cache-control']).toBe('public, max-age=3600');
    });
  });

  describe('CTA and social proof', () => {
    it('has Get Started Free CTA above the fold', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.body).toContain('Get Started Free');
    });

    it('has social proof section', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.body).toContain('developers');
    });
  });

  describe('robots.txt', () => {
    it('returns valid robots.txt', async () => {
      const res = await app.inject({ method: 'GET', url: '/robots.txt' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      const body = res.body;
      expect(body).toContain('User-agent: *');
      expect(body).toContain('Allow: /');
      expect(body).toContain('Allow: /docs');
      expect(body).toContain('Allow: /terms');
      expect(body).toContain('Allow: /privacy');
      expect(body).toContain('Disallow: /dashboard');
      expect(body).toContain('Disallow: /v1/');
      expect(body).toContain('Disallow: /admin');
      expect(body).toContain('Sitemap:');
    });
  });

  describe('sitemap.xml', () => {
    it('returns valid sitemap XML', async () => {
      const res = await app.inject({ method: 'GET', url: '/sitemap.xml' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/xml');
      const body = res.body;
      expect(body).toContain('<?xml');
      expect(body).toContain('<urlset');
      expect(body).toContain('sitemaps.org');
      expect(body).toContain('<loc>');
      // Should contain public pages
      expect(body).toContain('/docs');
      expect(body).toContain('/terms');
      expect(body).toContain('/privacy');
    });

    it('does not include private paths in sitemap', async () => {
      const res = await app.inject({ method: 'GET', url: '/sitemap.xml' });
      const body = res.body;
      expect(body).not.toContain('/dashboard');
      expect(body).not.toContain('/v1/');
      expect(body).not.toContain('/admin');
    });
  });
});
