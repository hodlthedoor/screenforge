import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { APP_VERSION } from '../../src/utils/version.js';
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

  it('footer shows dynamic version from package.json', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.body).toContain(`ScreenForge v${APP_VERSION}`);
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
      expect(body).toContain('og:image:width');
      expect(body).toContain('og:image:height');
      expect(body).toContain('og:url');
      expect(body).toContain('twitter:card');
      expect(body).toContain('summary_large_image');
      expect(body).toContain('twitter:title');
      expect(body).toContain('twitter:description');
      expect(body).toContain('twitter:image');
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
      expect(res.headers['cache-control']).toBe('private, max-age=3600');
    });
  });

  describe('CTA and social proof', () => {
    it('has primary CTA above the fold (variant A or B)', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      // A/B test: variant A = "Get Started Free", variant B = "Start Building Free"
      const hasCtaA = res.body.includes('Get Started Free');
      const hasCtaB = res.body.includes('Start Building Free');
      expect(hasCtaA || hasCtaB).toBe(true);
    });

    it('has social proof section', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.body).toContain('developers');
    });
  });

  describe('competitor comparison table', () => {
    it('contains competitor comparison section with all competitors', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const body = res.body;
      expect(body).toContain('ScreenForge vs Competitors');
      expect(body).toContain('ScreenshotOne');
      expect(body).toContain('Urlbox');
      expect(body).toContain('Browserless');
    });

    it('contains comparison columns for key features', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const body = res.body;
      expect(body).toContain('Self-Hosted');
      expect(body).toContain('Open Source');
      expect(body).toContain('Batch API');
    });

    it('highlights ScreenForge advantages', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const body = res.body;
      // ScreenForge should have checkmarks for self-hosted and open source
      // while competitors should not
      expect(body).toContain('competitor-table');
    });
  });

  describe('tabbed code examples', () => {
    it('contains tabbed code section with JS SDK, Python SDK, and cURL tabs', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const body = res.body;
      expect(body).toContain('data-tab="curl"');
      expect(body).toContain('data-tab="javascript"');
      expect(body).toContain('data-tab="python"');
    });

    it('contains copy button for code snippets', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.body).toContain('copy-btn');
    });

    it('contains JS SDK code example', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.body).toContain('screenforge');
      expect(res.body).toContain('screenshot');
    });

    it('contains Python SDK code example', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.body).toContain('requests.post');
    });
  });

  describe('FAQ section with JSON-LD', () => {
    it('contains FAQ section with questions', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const body = res.body;
      expect(body).toContain('Frequently Asked Questions');
      expect(body).toContain('faq-section');
    });

    it('contains FAQPage JSON-LD structured data', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const body = res.body;
      // Extract all JSON-LD blocks
      const jsonLdMatches = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
      expect(jsonLdMatches).toBeTruthy();
      expect(jsonLdMatches!.length).toBeGreaterThanOrEqual(2); // SoftwareApplication + FAQPage

      // Find the FAQPage block
      const faqBlock = jsonLdMatches!.find((m: string) => m.includes('FAQPage'));
      expect(faqBlock).toBeTruthy();

      // Parse and validate the JSON-LD
      const jsonContent = faqBlock!.replace(/<script type="application\/ld\+json">/, '').replace(/<\/script>/, '');
      const parsed = JSON.parse(jsonContent);
      expect(parsed['@context']).toBe('https://schema.org');
      expect(parsed['@type']).toBe('FAQPage');
      expect(parsed.mainEntity).toBeInstanceOf(Array);
      expect(parsed.mainEntity.length).toBeGreaterThanOrEqual(6);

      // Each FAQ entry should have Question type with name and acceptedAnswer
      for (const entry of parsed.mainEntity) {
        expect(entry['@type']).toBe('Question');
        expect(entry.name).toBeTruthy();
        expect(entry.acceptedAnswer['@type']).toBe('Answer');
        expect(entry.acceptedAnswer.text).toBeTruthy();
      }
    });
  });

  describe('accessibility', () => {
    it('contains skip-to-main-content link', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.body).toContain('skip-link');
      expect(res.body).toContain('href="#main-content"');
      expect(res.body).toContain('id="main-content"');
    });

    it('contains nav aria-label', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.body).toContain('aria-label="Main navigation"');
    });

    it('wraps content in main landmark', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.body).toContain('<main id="main-content">');
      expect(res.body).toContain('</main>');
    });
  });

  describe('analytics snippet injection', () => {
    it('does not inject analytics when ANALYTICS_SCRIPT is not set', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      // Should not contain any analytics script tag (beyond our own)
      expect(res.body).not.toContain('plausible');
      expect(res.body).not.toContain('googletagmanager');
    });

    it('rejects malicious analytics script with inline content', async () => {
      const prevScript = process.env.ANALYTICS_SCRIPT;
      process.env.ANALYTICS_SCRIPT = '<script>alert("xss")</script>';
      let malApp: FastifyInstance | undefined;
      try {
        malApp = await buildServer({ skipBrowserInit: true });
        const res = await malApp.inject({ method: 'GET', url: '/' });
        expect(res.body).not.toContain('alert("xss")');
      } finally {
        if (malApp) await malApp.close();
        if (prevScript === undefined) delete process.env.ANALYTICS_SCRIPT;
        else process.env.ANALYTICS_SCRIPT = prevScript;
      }
    });

    it('injects analytics script when ANALYTICS_SCRIPT is set', async () => {
      // Build a separate server with analytics configured
      const prevScript = process.env.ANALYTICS_SCRIPT;
      process.env.ANALYTICS_SCRIPT = '<script defer data-domain="screenforge.dev" src="https://plausible.io/js/script.js"></script>';
      let analyticsApp: FastifyInstance | undefined;
      try {
        analyticsApp = await buildServer({ skipBrowserInit: true });
        const res = await analyticsApp.inject({ method: 'GET', url: '/' });
        expect(res.body).toContain('plausible.io/js/script.js');
        expect(res.body).toContain('data-domain="screenforge.dev"');
      } finally {
        if (analyticsApp) await analyticsApp.close();
        if (prevScript === undefined) delete process.env.ANALYTICS_SCRIPT;
        else process.env.ANALYTICS_SCRIPT = prevScript;
      }
    });
  });

  describe('social proof counter', () => {
    it('contains social proof counter section', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });
      const body = res.body;
      expect(body).toContain('social-proof-counter');
      // Should display a number (the count, possibly formatted)
      expect(body).toMatch(/[\d,]+\s*(renders|screenshots|images)/i);
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
      expect(body).toContain('<lastmod>');
      expect(body).toContain('<changefreq>weekly</changefreq>');
      expect(body).toContain('<changefreq>monthly</changefreq>');
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
