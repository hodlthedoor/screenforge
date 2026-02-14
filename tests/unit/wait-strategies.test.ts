import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserPool } from '../../src/renderer/browser-pool.js';
import { takeScreenshot } from '../../src/renderer/screenshot.js';
import { renderPdf } from '../../src/renderer/pdf.js';
import { screenshotOptionsSchema } from '../../src/renderer/schemas.js';

describe('wait strategies', { timeout: 60_000 }, () => {
  let pool: BrowserPool;

  beforeAll(async () => {
    pool = new BrowserPool(1, 100);
    await pool.init();
  });

  afterAll(async () => {
    await pool.close();
  });

  describe('schema validation', () => {
    it('accepts legacy waitFor string (backwards compat)', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        waitFor: '#content',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.waitFor).toBe('#content');
      }
    });

    it('accepts wait strategy with type networkidle', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        wait: { type: 'networkidle' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.wait).toEqual({ type: 'networkidle' });
      }
    });

    it('accepts wait strategy with type delay', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        wait: { type: 'delay', value: 2000 },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.wait).toEqual({ type: 'delay', value: 2000 });
      }
    });

    it('rejects delay > 30000ms', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        wait: { type: 'delay', value: 40000 },
      });
      expect(result.success).toBe(false);
    });

    it('accepts wait strategy with type selector', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        wait: { type: 'selector', value: '#content' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.wait).toEqual({ type: 'selector', value: '#content' });
      }
    });

    it('accepts wait strategy with type function', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        wait: { type: 'function', value: '() => document.readyState === "complete"' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.wait).toEqual({ type: 'function', value: '() => document.readyState === "complete"' });
      }
    });

    it('accepts wait strategy with type hidden', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        wait: { type: 'hidden', value: '.loading-spinner' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.wait).toEqual({ type: 'hidden', value: '.loading-spinner' });
      }
    });

    it('rejects invalid wait type', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        wait: { type: 'invalid', value: 'test' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects both waitFor and wait', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        waitFor: '#content',
        wait: { type: 'networkidle' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('rendering with wait strategies', () => {
    it('networkidle waits for lazy-loaded content', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Test</title></head>
        <body>
          <div id="initial">Initial Content</div>
          <div id="lazy"></div>
          <script>
            setTimeout(() => {
              document.getElementById('lazy').textContent = 'Lazy Loaded';
            }, 100);
          </script>
        </body>
        </html>
      `;

      const result = await takeScreenshot(pool, {
        html,
        wait: { type: 'networkidle' },
        viewport: { width: 800, height: 600 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      }, 30_000);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('delay adds minimum wait time', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Test</title></head>
        <body><h1>Test</h1></body>
        </html>
      `;

      const start = Date.now();
      const result = await takeScreenshot(pool, {
        html,
        wait: { type: 'delay', value: 1000 },
        viewport: { width: 800, height: 600 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      }, 30_000);
      const elapsed = Date.now() - start;

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(elapsed).toBeGreaterThanOrEqual(1000);
    });

    it('selector waits for element to appear', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Test</title></head>
        <body>
          <div id="container"></div>
          <script>
            setTimeout(() => {
              const div = document.createElement('div');
              div.id = 'target';
              div.textContent = 'Target Element';
              document.getElementById('container').appendChild(div);
            }, 200);
          </script>
        </body>
        </html>
      `;

      const result = await takeScreenshot(pool, {
        html,
        wait: { type: 'selector', value: '#target' },
        viewport: { width: 800, height: 600 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      }, 30_000);

      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('function waits until JS expression returns truthy', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Test</title></head>
        <body>
          <div id="status">loading</div>
          <script>
            setTimeout(() => {
              document.getElementById('status').textContent = 'ready';
            }, 200);
          </script>
        </body>
        </html>
      `;

      const result = await takeScreenshot(pool, {
        html,
        wait: { type: 'function', value: '() => document.getElementById("status").textContent === "ready"' },
        viewport: { width: 800, height: 600 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      }, 30_000);

      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('hidden waits for element to disappear', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Test</title></head>
        <body>
          <div class="loading-spinner">Loading...</div>
          <div id="content" style="display:none">Content</div>
          <script>
            setTimeout(() => {
              document.querySelector('.loading-spinner').remove();
              document.getElementById('content').style.display = 'block';
            }, 200);
          </script>
        </body>
        </html>
      `;

      const result = await takeScreenshot(pool, {
        html,
        wait: { type: 'hidden', value: '.loading-spinner' },
        viewport: { width: 800, height: 600 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      }, 30_000);

      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('legacy waitFor string still works', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Test</title></head>
        <body>
          <div id="container"></div>
          <script>
            setTimeout(() => {
              const div = document.createElement('div');
              div.id = 'legacy-target';
              div.textContent = 'Legacy Target';
              document.getElementById('container').appendChild(div);
            }, 200);
          </script>
        </body>
        </html>
      `;

      const result = await takeScreenshot(pool, {
        html,
        waitFor: '#legacy-target',
        viewport: { width: 800, height: 600 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      }, 30_000);

      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('PDF rendering supports wait strategies', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>PDF Test</title></head>
        <body>
          <div id="content"></div>
          <script>
            setTimeout(() => {
              document.getElementById('content').textContent = 'PDF Content Ready';
            }, 200);
          </script>
        </body>
        </html>
      `;

      const result = await renderPdf(pool, {
        html,
        wait: { type: 'selector', value: '#content' },
        format: 'a4',
        landscape: false,
        margins: { top: '0', right: '0', bottom: '0', left: '0' },
        printBackground: true,
        scale: 1,
      }, 30_000);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('application/pdf');
    });
  });
});
