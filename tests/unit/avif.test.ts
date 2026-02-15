import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserPool } from '../../src/renderer/browser-pool.js';
import { takeScreenshot } from '../../src/renderer/screenshot.js';
import { screenshotOptionsSchema, thumbnailSchema } from '../../src/renderer/schemas.js';
import { FORMAT_EXT, getExtFromFormat, getFormatFromContentType } from '../../src/utils/format.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
});
