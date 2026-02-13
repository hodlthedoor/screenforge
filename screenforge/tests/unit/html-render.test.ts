import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserPool } from '../../src/renderer/browser-pool.js';
import { takeScreenshot } from '../../src/renderer/screenshot.js';
import { renderPdf } from '../../src/renderer/pdf.js';
import { screenshotOptionsSchema, pdfOptionsSchema } from '../../src/renderer/schemas.js';
import { RenderCache } from '../../src/cache/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SIMPLE_HTML = '<html><body><h1>Hello HTML Rendering</h1><p>This is a test</p></body></html>';
const LARGE_HTML = '<html><body>' + 'x'.repeat(3_000_000) + '</body></html>'; // 3MB+

describe('HTML rendering', { timeout: 60_000 }, () => {
  let pool: BrowserPool;
  let cache: RenderCache;
  let tempDir: string;

  beforeAll(async () => {
    pool = new BrowserPool(1, 100);
    await pool.init();
    tempDir = await mkdtemp(join(tmpdir(), 'screenforge-html-test-'));
    cache = new RenderCache('redis://127.0.0.1:6379/15', tempDir, 60);
  });

  afterAll(async () => {
    await pool.close();
    await cache.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('screenshotOptionsSchema', () => {
    it('accepts html instead of url', () => {
      const result = screenshotOptionsSchema.safeParse({ html: SIMPLE_HTML });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.html).toBe(SIMPLE_HTML);
      }
    });

    it('rejects when both url and html are provided', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        html: SIMPLE_HTML,
      });
      expect(result.success).toBe(false);
    });

    it('rejects when neither url nor html are provided', () => {
      const result = screenshotOptionsSchema.safeParse({
        viewport: { width: 1920, height: 1080 },
      });
      expect(result.success).toBe(false);
    });

    it('rejects html exceeding 2MB', () => {
      const result = screenshotOptionsSchema.safeParse({ html: LARGE_HTML });
      expect(result.success).toBe(false);
    });
  });

  describe('pdfOptionsSchema', () => {
    it('accepts html instead of url', () => {
      const result = pdfOptionsSchema.safeParse({ html: SIMPLE_HTML });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.html).toBe(SIMPLE_HTML);
      }
    });

    it('rejects when both url and html are provided', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        html: SIMPLE_HTML,
      });
      expect(result.success).toBe(false);
    });

    it('rejects when neither url nor html are provided', () => {
      const result = pdfOptionsSchema.safeParse({
        format: 'a4',
      });
      expect(result.success).toBe(false);
    });

    it('rejects html exceeding 2MB', () => {
      const result = pdfOptionsSchema.safeParse({ html: LARGE_HTML });
      expect(result.success).toBe(false);
    });
  });

  describe('takeScreenshot with HTML', () => {
    it('renders HTML to PNG', async () => {
      const options = screenshotOptionsSchema.parse({ html: SIMPLE_HTML });
      const result = await takeScreenshot(pool, options, 30_000);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.contentType).toBe('image/png');
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('renders styled HTML correctly', async () => {
      const styledHtml = `
        <html>
          <head>
            <style>
              body { background: #f0f0f0; font-family: Arial; padding: 20px; }
              h1 { color: #333; }
            </style>
          </head>
          <body>
            <h1>Styled Content</h1>
            <p>This HTML has inline styles</p>
          </body>
        </html>
      `;
      const options = screenshotOptionsSchema.parse({ html: styledHtml, format: 'jpeg', quality: 90 });
      const result = await takeScreenshot(pool, options, 30_000);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('image/jpeg');
    });
  });

  describe('renderPdf with HTML', () => {
    it('renders HTML to PDF', async () => {
      const options = pdfOptionsSchema.parse({ html: SIMPLE_HTML });
      const result = await renderPdf(pool, options, 30_000);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.contentType).toBe('application/pdf');
      expect(result.durationMs).toBeGreaterThan(0);
    });

    it('renders multi-page HTML to PDF', async () => {
      const longHtml = `
        <html>
          <body>
            ${Array.from({ length: 10 }, (_, i) => `<div style="page-break-after: always;"><h1>Page ${i + 1}</h1><p>Content for page ${i + 1}</p></div>`).join('\n')}
          </body>
        </html>
      `;
      const options = pdfOptionsSchema.parse({
        html: longHtml,
        format: 'a4',
        landscape: true,
        printBackground: true,
      });
      const result = await renderPdf(pool, options, 30_000);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(1000);
    });
  });

  describe('cache with HTML', () => {
    it('generates consistent hash for identical HTML', () => {
      const options1 = { html: SIMPLE_HTML, viewport: { width: 1920, height: 1080 }, format: 'png' as const };
      const options2 = { html: SIMPLE_HTML, viewport: { width: 1920, height: 1080 }, format: 'png' as const };

      const hash1 = RenderCache.hashOptions(options1);
      const hash2 = RenderCache.hashOptions(options2);

      expect(hash1).toBe(hash2);
    });

    it('generates different hashes for different HTML', () => {
      const options1 = { html: '<html><body>Version 1</body></html>' };
      const options2 = { html: '<html><body>Version 2</body></html>' };

      const hash1 = RenderCache.hashOptions(options1);
      const hash2 = RenderCache.hashOptions(options2);

      expect(hash1).not.toBe(hash2);
    });

    it('caches HTML renders', async () => {
      const options = screenshotOptionsSchema.parse({ html: SIMPLE_HTML });
      const optionsHash = RenderCache.hashOptions(options as unknown as Record<string, unknown>);

      // First render - cache miss
      const result1 = await takeScreenshot(pool, options, 30_000);
      await cache.set(optionsHash, result1.buffer, result1.contentType, 'png');

      // Second render - cache hit
      const cached = await cache.get(optionsHash);
      expect(cached).not.toBeNull();
      expect(cached?.contentType).toBe('image/png');

      const cachedBuffer = await cache.readFile(cached!.filePath);
      expect(cachedBuffer.length).toBe(result1.buffer.length);
    });
  });
});
