import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserPool } from '../../src/renderer/browser-pool.js';
import { takeScreenshot } from '../../src/renderer/screenshot.js';
import { screenshotOptionsSchema, thumbnailSchema } from '../../src/renderer/schemas.js';
import { FORMAT_EXT, FORMAT_CONTENT_TYPE, getExtFromFormat, getFormatFromContentType } from '../../src/utils/format.js';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rm, readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';

const FIXTURE_URL = pathToFileURL(resolve(__dirname, '../fixtures/test-page.html')).toString();

describe('AVIF format support', { timeout: 60_000 }, () => {
  describe('schema validation', () => {
    it('accepts avif as screenshot format', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        format: 'avif',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.format).toBe('avif');
      }
    });

    it('accepts avif as thumbnail format', () => {
      const result = thumbnailSchema.safeParse({
        width: 320,
        height: 240,
        fit: 'cover',
        format: 'avif',
        quality: 50,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('format utilities', () => {
    it('maps image/avif content type to avif extension', () => {
      expect(FORMAT_EXT['image/avif']).toBe('avif');
    });

    it('FORMAT_CONTENT_TYPE maps avif to image/avif', () => {
      expect(FORMAT_CONTENT_TYPE['avif']).toBe('image/avif');
    });

    it('getExtFromFormat returns avif for avif format', () => {
      expect(getExtFromFormat('avif')).toBe('avif');
    });

    it('getFormatFromContentType returns avif for image/avif', () => {
      expect(getFormatFromContentType('image/avif')).toBe('avif');
    });
  });

  describe('takeScreenshot with AVIF', () => {
    let pool: BrowserPool;

    beforeAll(async () => {
      pool = new BrowserPool(1, 100);
      await pool.init();
    });

    afterAll(async () => {
      await pool.close();
    });

    it('renders an AVIF screenshot', async () => {
      const result = await takeScreenshot(pool, {
        url: FIXTURE_URL,
        viewport: { width: 1280, height: 720 },
        format: 'avif',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      });

      expect(result.contentType).toBe('image/avif');
      expect(result.buffer.length).toBeGreaterThan(0);
      // AVIF files start with a ftyp box containing 'avif' brand
      // The file starts with the box size (4 bytes), then 'ftyp' (4 bytes)
      const ftypMarker = result.buffer.toString('ascii', 4, 8);
      expect(ftypMarker).toBe('ftyp');
    });

    it('respects quality parameter for AVIF', async () => {
      const lowQ = await takeScreenshot(pool, {
        url: FIXTURE_URL,
        viewport: { width: 640, height: 480 },
        format: 'avif',
        quality: 10,
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      });

      const highQ = await takeScreenshot(pool, {
        url: FIXTURE_URL,
        viewport: { width: 640, height: 480 },
        format: 'avif',
        quality: 90,
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      });

      // Higher quality should produce larger file
      expect(highQ.buffer.length).toBeGreaterThan(lowQ.buffer.length);
    });

    it('generates AVIF thumbnail', async () => {
      const result = await takeScreenshot(pool, {
        url: FIXTURE_URL,
        viewport: { width: 1280, height: 720 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
        thumbnail: {
          width: 320,
          height: 240,
          fit: 'cover',
          format: 'avif',
          quality: 50,
        },
      });

      expect(result.thumbnailBuffer).toBeDefined();
      expect(result.thumbnailBuffer!.length).toBeGreaterThan(0);
      // Verify AVIF ftyp box in thumbnail
      const ftypMarker = result.thumbnailBuffer!.toString('ascii', 4, 8);
      expect(ftypMarker).toBe('ftyp');
    });

    it('uses default quality of 50 for AVIF when not specified', async () => {
      const result = await takeScreenshot(pool, {
        url: FIXTURE_URL,
        viewport: { width: 640, height: 480 },
        format: 'avif',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      });

      // Just verify it succeeds with default quality
      expect(result.contentType).toBe('image/avif');
      expect(result.buffer.length).toBeGreaterThan(0);
    });
  });

  describe('Accept header content negotiation', () => {
    const TEST_STORAGE = resolve(__dirname, '../../storage-test-avif');
    let app: FastifyInstance;
    let fixtureServer: Server;
    let fixtureUrl: string;

    beforeAll(async () => {
      const html = await readFile(resolve(__dirname, '../fixtures/test-page.html'), 'utf-8');
      fixtureServer = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      });
      await new Promise<void>((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
      const addr = fixtureServer.address();
      if (addr && typeof addr === 'object') {
        fixtureUrl = `http://127.0.0.1:${addr.port}`;
      }

      process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
      process.env.NODE_ENV = 'test';
      process.env.STORAGE_PATH = TEST_STORAGE;
      process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
      process.env.ALLOW_PRIVATE_URLS = 'true';
      app = await buildServer();
    });

    afterAll(async () => {
      await app.close();
      await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
      await rm(TEST_STORAGE, { recursive: true, force: true });
      delete process.env.ALLOW_PRIVATE_URLS;
    });

    it('returns AVIF when Accept header includes image/avif and format not specified', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot?cache_ttl=0',
        headers: { accept: 'image/avif,image/webp,image/png,*/*' },
        payload: { url: fixtureUrl },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/avif');
    });

    it('returns WebP when Accept header includes image/webp but not avif and format not specified', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot?cache_ttl=0',
        headers: { accept: 'image/webp,image/png,*/*' },
        payload: { url: fixtureUrl },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/webp');
    });

    it('returns PNG when format is explicitly set, ignoring Accept header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot?cache_ttl=0',
        headers: { accept: 'image/avif,image/webp,*/*' },
        payload: { url: fixtureUrl, format: 'png' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    });

    it('returns PNG by default when no Accept header and no format specified', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/screenshot?cache_ttl=0',
        payload: { url: fixtureUrl },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    });
  });
});
