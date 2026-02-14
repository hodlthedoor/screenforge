import { describe, it, expect } from 'vitest';
import { screenshotOptionsSchema, pdfOptionsSchema, isPrivateUrl } from '../../src/renderer/schemas.js';

describe('screenshotOptionsSchema', () => {
  it('accepts valid minimal options', () => {
    const result = screenshotOptionsSchema.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://example.com');
      expect(result.data.viewport.width).toBe(1920);
      expect(result.data.viewport.height).toBe(1080);
      expect(result.data.format).toBe('png');
      expect(result.data.fullPage).toBe(false);
      expect(result.data.darkMode).toBe(false);
      expect(result.data.deviceScaleFactor).toBe(1);
    }
  });

  it('accepts all options', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      viewport: { width: 1280, height: 720 },
      format: 'jpeg',
      quality: 80,
      fullPage: true,
      selector: '#main',
      waitFor: '.loaded',
      darkMode: true,
      deviceScaleFactor: 2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe('jpeg');
      expect(result.data.quality).toBe(80);
      expect(result.data.fullPage).toBe(true);
      expect(result.data.selector).toBe('#main');
      expect(result.data.darkMode).toBe(true);
      expect(result.data.deviceScaleFactor).toBe(2);
    }
  });

  it('rejects missing url', () => {
    const result = screenshotOptionsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid url', () => {
    const result = screenshotOptionsSchema.safeParse({ url: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects file:// URLs (non-http protocol)', () => {
    const result = screenshotOptionsSchema.safeParse({ url: 'file:///etc/passwd' });
    expect(result.success).toBe(false);
  });

  it('rejects ftp:// URLs (non-http protocol)', () => {
    const result = screenshotOptionsSchema.safeParse({ url: 'ftp://example.com/file' });
    expect(result.success).toBe(false);
  });

  it('rejects webp format (unsupported by Playwright)', () => {
    const result = screenshotOptionsSchema.safeParse({ url: 'https://example.com', format: 'webp' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid format', () => {
    const result = screenshotOptionsSchema.safeParse({ url: 'https://example.com', format: 'bmp' });
    expect(result.success).toBe(false);
  });

  it('rejects quality out of range', () => {
    const result = screenshotOptionsSchema.safeParse({ url: 'https://example.com', quality: 200 });
    expect(result.success).toBe(false);
  });

  it('rejects viewport too large', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      viewport: { width: 10000, height: 1080 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects deviceScaleFactor out of range', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      deviceScaleFactor: 0.1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid clip region', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      clip: { x: 100, y: 50, width: 800, height: 600 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clip).toEqual({ x: 100, y: 50, width: 800, height: 600 });
    }
  });

  it('accepts clip at origin (0, 0)', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      clip: { x: 0, y: 0, width: 500, height: 300 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects clip with negative x', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      clip: { x: -10, y: 0, width: 800, height: 600 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects clip with negative y', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      clip: { x: 0, y: -5, width: 800, height: 600 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects clip with zero width', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      clip: { x: 0, y: 0, width: 0, height: 600 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects clip with zero height', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      clip: { x: 0, y: 0, width: 800, height: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects clip + selector (mutually exclusive)', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      clip: { x: 0, y: 0, width: 800, height: 600 },
      selector: '#main',
    });
    expect(result.success).toBe(false);
  });
});

describe('pdfOptionsSchema', () => {
  it('accepts valid minimal options', () => {
    const result = pdfOptionsSchema.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://example.com');
      expect(result.data.format).toBe('a4');
      expect(result.data.landscape).toBe(false);
      expect(result.data.printBackground).toBe(true);
      expect(result.data.scale).toBe(1);
    }
  });

  it('accepts all options', () => {
    const result = pdfOptionsSchema.safeParse({
      url: 'https://example.com',
      format: 'letter',
      landscape: true,
      margins: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
      printBackground: false,
      headerTemplate: '<div>Header</div>',
      footerTemplate: '<div>Footer</div>',
      scale: 0.75,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe('letter');
      expect(result.data.landscape).toBe(true);
      expect(result.data.margins.top).toBe('1cm');
      expect(result.data.scale).toBe(0.75);
    }
  });

  it('rejects missing url', () => {
    const result = pdfOptionsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid format', () => {
    const result = pdfOptionsSchema.safeParse({ url: 'https://example.com', format: 'tabloid' });
    expect(result.success).toBe(false);
  });

  it('rejects scale out of range', () => {
    const result = pdfOptionsSchema.safeParse({ url: 'https://example.com', scale: 5 });
    expect(result.success).toBe(false);
  });

  it('rejects file:// URLs (non-http protocol)', () => {
    const result = pdfOptionsSchema.safeParse({ url: 'file:///etc/shadow' });
    expect(result.success).toBe(false);
  });
});

describe('isPrivateUrl', () => {
  it('detects localhost', () => {
    expect(isPrivateUrl('http://localhost:3000')).toBe(true);
  });

  it('detects 127.x.x.x', () => {
    expect(isPrivateUrl('http://127.0.0.1')).toBe(true);
  });

  it('detects 10.x.x.x', () => {
    expect(isPrivateUrl('http://10.0.0.1')).toBe(true);
  });

  it('detects 172.16-31.x.x', () => {
    expect(isPrivateUrl('http://172.16.0.1')).toBe(true);
    expect(isPrivateUrl('http://172.31.255.255')).toBe(true);
  });

  it('detects 192.168.x.x', () => {
    expect(isPrivateUrl('http://192.168.1.1')).toBe(true);
  });

  it('detects 0.0.0.0', () => {
    expect(isPrivateUrl('http://0.0.0.0')).toBe(true);
  });

  it('allows public URLs', () => {
    expect(isPrivateUrl('https://example.com')).toBe(false);
    expect(isPrivateUrl('https://8.8.8.8')).toBe(false);
  });
});
