import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { getPool, closePool, resetPool } from '../../src/db/index.js';
import { loadConfig } from '../../src/config/index.js';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { generateOgHtml } from '../../src/routes/og.js';

const TEST_STORAGE = resolve(import.meta.dirname, '../../storage-og-test');

describe('OG card generation', { timeout: 120_000 }, () => {
  let app: FastifyInstance;
  let ogServer: Server;
  let ogServerUrl: string;

  beforeAll(async () => {
    // HTTP server that serves a page with OG meta tags
    ogServer = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
        <html><head>
          <title>My Page Title</title>
          <meta property="og:title" content="OG Title">
          <meta property="og:description" content="OG Description here">
          <meta property="og:site_name" content="My Site">
          <meta property="og:image" content="https://example.com/image.jpg">
        </head><body><h1>Hello</h1></body></html>`);
    });
    await new Promise<void>((r) => ogServer.listen(0, '127.0.0.1', r));
    const addr = ogServer.address();
    if (addr && typeof addr === 'object') {
      ogServerUrl = `http://127.0.0.1:${addr.port}`;
    }

    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_PATH = TEST_STORAGE;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.ALLOW_PRIVATE_URLS = 'true';
    process.env.REQUIRE_AUTH = 'false';
    loadConfig();

    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((r) => ogServer.close(() => r()));
    await rm(TEST_STORAGE, { recursive: true, force: true });
    const pool = getPool();
    await pool.query('DELETE FROM usage_daily');
    await pool.query('DELETE FROM render_jobs');
    await pool.query('DELETE FROM batch_jobs');
    // No API keys created in this test file
    await closePool();
    resetPool();
    delete process.env.ALLOW_PRIVATE_URLS;
    delete process.env.REQUIRE_AUTH;
  });

  describe('generateOgHtml', () => {
    it('generates HTML with title', () => {
      const html = generateOgHtml({ title: 'My Card', theme: 'light', template: 'default' });
      expect(html).toContain('My Card');
      expect(html).toContain('1200px');
      expect(html).toContain('630px');
    });

    it('generates dark theme HTML', () => {
      const html = generateOgHtml({ title: 'Dark Card', theme: 'dark', template: 'default' });
      expect(html).toContain('#1a1a2e');
      expect(html).toContain('Dark Card');
    });

    it('includes description and site name', () => {
      const html = generateOgHtml({
        title: 'Test',
        description: 'A description',
        siteName: 'MySite',
        theme: 'light',
        template: 'default',
      });
      expect(html).toContain('A description');
      expect(html).toContain('MySite');
    });

    it('escapes HTML in title and description', () => {
      const html = generateOgHtml({
        title: '<script>alert(1)</script>',
        description: 'a "quoted" & <tagged> thing',
        theme: 'light',
        template: 'default',
      });
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&amp;');
      expect(html).toContain('&quot;quoted&quot;');
      expect(html).not.toContain('<script>alert');
    });

    it('includes background image when provided', () => {
      const html = generateOgHtml({
        title: 'Image Card',
        image: 'https://example.com/img.jpg',
        theme: 'light',
        template: 'default',
      });
      expect(html).toContain('https://example.com/img.jpg');
      expect(html).toContain('image-section');
    });

    it('uses fetched metadata as fallback', () => {
      const html = generateOgHtml({
        theme: 'light',
        template: 'default',
        fetchedMeta: {
          title: 'Fetched Title',
          description: 'Fetched Desc',
          siteName: 'Fetched Site',
        },
      });
      expect(html).toContain('Fetched Title');
      expect(html).toContain('Fetched Desc');
      expect(html).toContain('Fetched Site');
    });
  });

  describe('POST /v1/og', () => {
    it('generates OG card with custom title', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/og',
        payload: { title: 'Custom Title Card', theme: 'light' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['x-cache']).toBe('MISS');
      // PNG magic bytes
      expect(res.rawPayload[0]).toBe(0x89);
      expect(res.rawPayload[1]).toBe(0x50);
    });

    it('returns cache HIT on second identical request', async () => {
      const payload = { title: 'Cache Test Card', description: 'Testing cache', theme: 'dark' };
      await app.inject({ method: 'POST', url: '/v1/og', payload });
      const res = await app.inject({ method: 'POST', url: '/v1/og', payload });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-cache']).toBe('HIT');
    });

    it('fetches OG metadata from URL', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/og',
        payload: { url: ogServerUrl },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    });

    it('returns 400 when neither url nor title provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/og',
        payload: { theme: 'light' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('generates dark theme OG card', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/og',
        payload: { title: 'Dark Theme', theme: 'dark' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    });
  });
});
