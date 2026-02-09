import { describe, it, expect } from 'vitest';
import { screenshotOptionsSchema, pdfOptionsSchema } from '../../src/renderer/schemas.js';

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
});
