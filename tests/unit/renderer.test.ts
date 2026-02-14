import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserPool } from '../../src/renderer/browser-pool.js';
import { takeScreenshot } from '../../src/renderer/screenshot.js';
import { renderPdf } from '../../src/renderer/pdf.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FIXTURE_URL = pathToFileURL(resolve(__dirname, '../fixtures/test-page.html')).toString();

describe('renderer', { timeout: 60_000 }, () => {
  let pool: BrowserPool;

  beforeAll(async () => {
    pool = new BrowserPool(1, 100);
    await pool.init();
  });

  afterAll(async () => {
    await pool.close();
  });

  describe('takeScreenshot', () => {
    it('renders a PNG screenshot', async () => {
      const result = await takeScreenshot(pool, {
        url: FIXTURE_URL,
        viewport: { width: 1280, height: 720 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.contentType).toBe('image/png');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      // PNG magic bytes
      expect(result.buffer[0]).toBe(0x89);
      expect(result.buffer[1]).toBe(0x50); // P
      expect(result.buffer[2]).toBe(0x4e); // N
      expect(result.buffer[3]).toBe(0x47); // G
    });

    it('renders a JPEG screenshot', async () => {
      const result = await takeScreenshot(pool, {
        url: FIXTURE_URL,
        viewport: { width: 1280, height: 720 },
        format: 'jpeg',
        quality: 80,
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
      });

      expect(result.contentType).toBe('image/jpeg');
      expect(result.buffer.length).toBeGreaterThan(0);
      // JPEG magic bytes
      expect(result.buffer[0]).toBe(0xff);
      expect(result.buffer[1]).toBe(0xd8);
    });

    it('renders with dark mode', async () => {
      const result = await takeScreenshot(pool, {
        url: FIXTURE_URL,
        viewport: { width: 1280, height: 720 },
        format: 'png',
        fullPage: false,
        darkMode: true,
        deviceScaleFactor: 1,
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('renders with selector targeting', async () => {
      const result = await takeScreenshot(pool, {
        url: FIXTURE_URL,
        viewport: { width: 1280, height: 720 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
        selector: '#target',
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('renders full page', async () => {
      const result = await takeScreenshot(pool, {
        url: FIXTURE_URL,
        viewport: { width: 1280, height: 720 },
        format: 'png',
        fullPage: true,
        darkMode: false,
        deviceScaleFactor: 1,
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('applies timezone emulation', async () => {
      const result = await takeScreenshot(pool, {
        html: '<div id="tz"></div><script>document.getElementById("tz").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;</script>',
        viewport: { width: 1280, height: 720 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
        timezone: 'America/New_York',
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('applies locale emulation', async () => {
      const result = await takeScreenshot(pool, {
        html: '<div id="locale"></div><script>document.getElementById("locale").textContent = navigator.language;</script>',
        viewport: { width: 1280, height: 720 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
        locale: 'fr-FR',
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('applies geolocation emulation', async () => {
      const result = await takeScreenshot(pool, {
        html: '<div id="geo">Loading...</div><script>navigator.geolocation.getCurrentPosition(p => document.getElementById("geo").textContent = p.coords.latitude + "," + p.coords.longitude);</script>',
        viewport: { width: 1280, height: 720 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
        geolocation: { latitude: 51.5074, longitude: -0.1278 },
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    });
  });

  describe('renderPdf', () => {
    it('renders a PDF', async () => {
      const result = await renderPdf(pool, {
        url: FIXTURE_URL,
        format: 'a4',
        landscape: false,
        margins: { top: '0', right: '0', bottom: '0', left: '0' },
        printBackground: true,
        scale: 1,
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.contentType).toBe('application/pdf');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      // PDF magic bytes
      expect(result.buffer.slice(0, 5).toString()).toBe('%PDF-');
    });

    it('renders letter landscape PDF', async () => {
      const result = await renderPdf(pool, {
        url: FIXTURE_URL,
        format: 'letter',
        landscape: true,
        margins: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
        printBackground: true,
        scale: 0.75,
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('application/pdf');
    });

    it('applies timezone emulation', async () => {
      const result = await renderPdf(pool, {
        html: '<div id="tz"></div><script>document.getElementById("tz").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;</script>',
        format: 'a4',
        landscape: false,
        margins: { top: '0', right: '0', bottom: '0', left: '0' },
        printBackground: true,
        scale: 1,
        timezone: 'Asia/Tokyo',
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('application/pdf');
    });

    it('applies locale emulation', async () => {
      const result = await renderPdf(pool, {
        html: '<div id="locale"></div><script>document.getElementById("locale").textContent = navigator.language;</script>',
        format: 'a4',
        landscape: false,
        margins: { top: '0', right: '0', bottom: '0', left: '0' },
        printBackground: true,
        scale: 1,
        locale: 'de-DE',
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('application/pdf');
    });
  });

  describe('proxy support', () => {
    it('accepts proxy config for screenshots', async () => {
      const result = await takeScreenshot(pool, {
        url: FIXTURE_URL,
        viewport: { width: 1280, height: 720 },
        format: 'png',
        fullPage: false,
        darkMode: false,
        deviceScaleFactor: 1,
        proxy: { server: 'http://proxy.example.com:8080' }, // Config accepted even if no proxy exists
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('image/png');
    });

    it('accepts proxy config for PDFs', async () => {
      const result = await renderPdf(pool, {
        url: FIXTURE_URL,
        format: 'a4',
        landscape: false,
        margins: { top: '0', right: '0', bottom: '0', left: '0' },
        printBackground: true,
        scale: 1,
        proxy: { server: 'http://proxy.example.com:8080', username: 'user', password: 'pass' },
      });

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.contentType).toBe('application/pdf');
    });
  });
});
