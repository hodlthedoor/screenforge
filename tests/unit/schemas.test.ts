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

  describe('device presets', () => {
    it('applies device preset to override viewport and deviceScaleFactor', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        device: 'iphone-15-pro',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.viewport.width).toBe(393);
        expect(result.data.viewport.height).toBe(659);
        expect(result.data.deviceScaleFactor).toBe(3);
        expect(result.data.userAgent).toBeDefined();
        expect(result.data.userAgent).toContain('iPhone');
      }
    });

    it('device preset overrides manual viewport', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        device: 'desktop-4k',
        viewport: { width: 1920, height: 1080 }, // Should be overridden
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.viewport.width).toBe(3840);
        expect(result.data.viewport.height).toBe(2160);
      }
    });

    it('device preset overrides manual deviceScaleFactor', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        device: 'iphone-14-pro',
        deviceScaleFactor: 1, // Should be overridden to 3
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deviceScaleFactor).toBe(3);
      }
    });

    it('rejects unknown device preset', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        device: 'unknown-device',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Unknown device');
      }
    });

    it('allows explicit userAgent without device', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        userAgent: 'Custom/1.0',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userAgent).toBe('Custom/1.0');
      }
    });
  });

  it('rejects file:// URLs (non-http protocol)', () => {
    const result = screenshotOptionsSchema.safeParse({ url: 'file:///etc/passwd' });
    expect(result.success).toBe(false);
  });

  it('rejects ftp:// URLs (non-http protocol)', () => {
    const result = screenshotOptionsSchema.safeParse({ url: 'ftp://example.com/file' });
    expect(result.success).toBe(false);
  });

  it('accepts webp format', () => {
    const result = screenshotOptionsSchema.safeParse({ url: 'https://example.com', format: 'webp' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe('webp');
    }
  });

  it('accepts webp format with quality', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      format: 'webp',
      quality: 85,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.format).toBe('webp');
      expect(result.data.quality).toBe(85);
    }
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

  it('accepts valid geolocation', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      geolocation: { latitude: 51.5074, longitude: -0.1278, accuracy: 100 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.geolocation).toEqual({ latitude: 51.5074, longitude: -0.1278, accuracy: 100 });
    }
  });

  it('accepts geolocation without accuracy', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      geolocation: { latitude: 37.7749, longitude: -122.4194 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects geolocation with latitude out of range', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      geolocation: { latitude: 91, longitude: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects geolocation with longitude out of range', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      geolocation: { latitude: 0, longitude: 181 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects geolocation with negative accuracy', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      geolocation: { latitude: 0, longitude: 0, accuracy: -10 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid timezone', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      timezone: 'America/New_York',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.timezone).toBe('America/New_York');
    }
  });

  it('accepts various valid timezones', () => {
    const timezones = ['Europe/London', 'Asia/Tokyo', 'America/Los_Angeles', 'America/Chicago'];
    for (const tz of timezones) {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        timezone: tz,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid timezone', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      timezone: 'Invalid/Timezone',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid locale', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      locale: 'en-US',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locale).toBe('en-US');
    }
  });

  it('accepts various valid locales', () => {
    const locales = ['en-GB', 'fr-FR', 'de-DE', 'ja-JP', 'zh-CN'];
    for (const locale of locales) {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        locale,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts all emulation options together', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      geolocation: { latitude: 48.8566, longitude: 2.3522 },
      timezone: 'Europe/Paris',
      locale: 'fr-FR',
    });
    expect(result.success).toBe(true);
  });

  it('accepts custom headers', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      headers: { 'Authorization': 'Bearer token123', 'X-Custom': 'value' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headers).toEqual({ 'Authorization': 'Bearer token123', 'X-Custom': 'value' });
    }
  });

  it('accepts custom cookies', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      cookies: [
        { name: 'session', value: 'abc123', domain: '.example.com', path: '/' },
        { name: 'pref', value: 'dark', domain: 'example.com' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cookies).toHaveLength(2);
      expect(result.data.cookies![0].name).toBe('session');
    }
  });

  it('accepts cookies with optional domain and path', () => {
    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      cookies: [{ name: 'test', value: 'value1' }],
    });
    expect(result.success).toBe(true);
  });

  describe('proxy support', () => {
    it('accepts valid HTTP proxy', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        proxy: { server: 'http://proxy.example.com:8080' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.proxy).toEqual({ server: 'http://proxy.example.com:8080' });
      }
    });

    it('accepts valid HTTPS proxy', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        proxy: { server: 'https://proxy.example.com:443' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid SOCKS4 proxy', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        proxy: { server: 'socks4://proxy.example.com:1080' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid SOCKS5 proxy', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        proxy: { server: 'socks5://proxy.example.com:1080' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts proxy with username and password', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        proxy: {
          server: 'http://proxy.example.com:8080',
          username: 'user',
          password: 'pass',
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.proxy?.username).toBe('user');
        expect(result.data.proxy?.password).toBe('pass');
      }
    });

    it('accepts no proxy (optional)', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.proxy).toBeUndefined();
      }
    });

    it('rejects invalid proxy protocol', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        proxy: { server: 'ftp://proxy.example.com:21' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('http://, https://, socks4://, or socks5://');
      }
    });

    it('rejects proxy without protocol', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        proxy: { server: 'proxy.example.com:8080' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('cache control options', () => {
    it('accepts cache_ttl=0 (bypass cache)', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_ttl: 0,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cache_ttl).toBe(0);
      }
    });

    it('accepts cache_ttl=3600 (1 hour)', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_ttl: 3600,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cache_ttl).toBe(3600);
      }
    });

    it('accepts cache_ttl=2592000 (30 days max)', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_ttl: 2592000,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cache_ttl).toBe(2592000);
      }
    });

    it('rejects cache_ttl above max (2592001)', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_ttl: 2592001,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative cache_ttl', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_ttl: -1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer cache_ttl', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_ttl: 3600.5,
      });
      expect(result.success).toBe(false);
    });

    it('accepts cache_key with short string', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_key: 'user-session-abc123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cache_key).toBe('user-session-abc123');
      }
    });

    it('accepts cache_key at max length (128 chars)', () => {
      const longKey = 'a'.repeat(128);
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_key: longKey,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cache_key).toBe(longKey);
      }
    });

    it('rejects cache_key over max length (129 chars)', () => {
      const tooLongKey = 'a'.repeat(129);
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_key: tooLongKey,
      });
      expect(result.success).toBe(false);
    });

    it('cache_ttl is optional', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cache_ttl).toBeUndefined();
      }
    });

    it('cache_key is optional', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cache_key).toBeUndefined();
      }
    });
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

  describe('device presets', () => {
    it('applies device preset with userAgent for PDFs', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        device: 'desktop-1080p',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userAgent).toBeDefined();
        expect(result.data.userAgent).toContain('Chrome');
      }
    });

    it('rejects unknown device preset', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        device: 'invalid-device',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Unknown device');
      }
    });
  });

  it('rejects file:// URLs (non-http protocol)', () => {
    const result = pdfOptionsSchema.safeParse({ url: 'file:///etc/shadow' });
    expect(result.success).toBe(false);
  });

  it('accepts custom headers', () => {
    const result = pdfOptionsSchema.safeParse({
      url: 'https://example.com',
      headers: { 'Authorization': 'Bearer token123', 'X-Custom': 'value' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headers).toEqual({ 'Authorization': 'Bearer token123', 'X-Custom': 'value' });
    }
  });

  it('accepts custom cookies', () => {
    const result = pdfOptionsSchema.safeParse({
      url: 'https://example.com',
      cookies: [
        { name: 'session', value: 'abc123', domain: '.example.com', path: '/' },
        { name: 'pref', value: 'dark', domain: 'example.com' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cookies).toHaveLength(2);
      expect(result.data.cookies![0].name).toBe('session');
    }
  });

  it('accepts valid geolocation', () => {
    const result = pdfOptionsSchema.safeParse({
      url: 'https://example.com',
      geolocation: { latitude: 40.7128, longitude: -74.0060 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid timezone', () => {
    const result = pdfOptionsSchema.safeParse({
      url: 'https://example.com',
      timezone: 'America/New_York',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid locale', () => {
    const result = pdfOptionsSchema.safeParse({
      url: 'https://example.com',
      locale: 'en-US',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all emulation options together', () => {
    const result = pdfOptionsSchema.safeParse({
      url: 'https://example.com',
      geolocation: { latitude: 35.6762, longitude: 139.6503 },
      timezone: 'Asia/Tokyo',
      locale: 'ja-JP',
    });
    expect(result.success).toBe(true);
  });

  describe('proxy support', () => {
    it('accepts valid proxy', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        proxy: { server: 'http://proxy.example.com:8080' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.proxy).toEqual({ server: 'http://proxy.example.com:8080' });
      }
    });

    it('accepts proxy with credentials', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        proxy: {
          server: 'socks5://proxy.example.com:1080',
          username: 'proxyuser',
          password: 'proxypass',
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid proxy protocol', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        proxy: { server: 'invalid://proxy.example.com' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('cache control options', () => {
    it('accepts cache_ttl=0 (bypass cache)', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_ttl: 0,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cache_ttl).toBe(0);
      }
    });

    it('accepts cache_ttl=2592000 (30 days max)', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_ttl: 2592000,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cache_ttl).toBe(2592000);
      }
    });

    it('rejects cache_ttl above max', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_ttl: 2592001,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative cache_ttl', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_ttl: -1,
      });
      expect(result.success).toBe(false);
    });

    it('accepts cache_key', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_key: 'report-state-v2',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cache_key).toBe('report-state-v2');
      }
    });

    it('rejects cache_key over 128 chars', () => {
      const tooLongKey = 'a'.repeat(129);
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        cache_key: tooLongKey,
      });
      expect(result.success).toBe(false);
    });
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
