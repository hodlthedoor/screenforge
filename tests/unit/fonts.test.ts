import { describe, it, expect } from 'vitest';
import { screenshotOptionsSchema, pdfOptionsSchema } from '../../src/renderer/schemas.js';
import { validateFontUrl, buildGoogleFontUrl, validateFonts, FontValidationError } from '../../src/renderer/fonts.js';

describe('font schema validation', () => {
  describe('screenshotOptionsSchema with fonts', () => {
    it('accepts valid Google Fonts shorthand', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        fonts: [
          { family: 'Roboto', weights: [400, 700] },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fonts).toHaveLength(1);
        expect(result.data.fonts![0]).toEqual({ type: 'google', family: 'Roboto', weights: [400, 700] });
      }
    });

    it('accepts valid direct CSS URLs', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        fonts: [
          { url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700' },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fonts).toHaveLength(1);
        expect(result.data.fonts![0]).toEqual({ type: 'url', url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700' });
      }
    });

    it('accepts multiple fonts up to max limit', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        fonts: [
          { family: 'Roboto' },
          { family: 'Open Sans', weights: [300, 400] },
          { url: 'https://fonts.googleapis.com/css2?family=Lato' },
          { family: 'Montserrat' },
          { family: 'Poppins' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('rejects more than 5 fonts', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        fonts: [
          { family: 'Font1' },
          { family: 'Font2' },
          { family: 'Font3' },
          { family: 'Font4' },
          { family: 'Font5' },
          { family: 'Font6' },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects font with both url and family', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        fonts: [
          { url: 'https://fonts.googleapis.com/css2?family=Roboto', family: 'Roboto' },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects font with neither url nor family', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        fonts: [{}],
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid weight values', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        fonts: [
          { family: 'Roboto', weights: [0] },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('rejects weight values over 1000', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        fonts: [
          { family: 'Roboto', weights: [1001] },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('accepts fonts without weights (defaults)', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        fonts: [
          { family: 'Roboto' },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('pdfOptionsSchema with fonts', () => {
    it('accepts valid fonts for PDF', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        fonts: [
          { family: 'Roboto', weights: [400, 700] },
        ],
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('validateFontUrl', () => {
  it('accepts fonts.googleapis.com', () => {
    expect(() => validateFontUrl('https://fonts.googleapis.com/css2?family=Roboto')).not.toThrow();
  });

  it('accepts fonts.gstatic.com', () => {
    expect(() => validateFontUrl('https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2')).not.toThrow();
  });

  it('accepts cdn.jsdelivr.net', () => {
    expect(() => validateFontUrl('https://cdn.jsdelivr.net/npm/@fontsource/roboto@4.5.8/index.css')).not.toThrow();
  });

  it('accepts unpkg.com', () => {
    expect(() => validateFontUrl('https://unpkg.com/@fontsource/inter@4.5.12/index.css')).not.toThrow();
  });

  it('rejects arbitrary domains', () => {
    expect(() => validateFontUrl('https://evil.com/font.css')).toThrow(FontValidationError);
  });

  it('rejects localhost URLs', () => {
    expect(() => validateFontUrl('https://localhost/font.css')).toThrow(FontValidationError);
  });

  it('rejects private IP addresses', () => {
    expect(() => validateFontUrl('https://192.168.1.1/font.css')).toThrow(FontValidationError);
  });

  it('rejects non-HTTPS URLs', () => {
    expect(() => validateFontUrl('http://fonts.googleapis.com/css')).toThrow(FontValidationError);
  });

  it('rejects malformed URLs', () => {
    expect(() => validateFontUrl('not-a-url')).toThrow(FontValidationError);
  });
});

describe('validateFonts', () => {
  it('passes with no fonts', () => {
    expect(() => validateFonts()).not.toThrow();
    expect(() => validateFonts([])).not.toThrow();
  });

  it('passes with valid google fonts', () => {
    expect(() => validateFonts([
      { type: 'google', family: 'Roboto', weights: [400] },
    ])).not.toThrow();
  });

  it('passes with valid URL fonts', () => {
    expect(() => validateFonts([
      { type: 'url', url: 'https://fonts.googleapis.com/css2?family=Inter' },
    ])).not.toThrow();
  });

  it('throws FontValidationError for disallowed URL domain', () => {
    expect(() => validateFonts([
      { type: 'url', url: 'https://evil.com/font.css' },
    ])).toThrow(FontValidationError);
  });

  it('throws FontValidationError for non-HTTPS URL', () => {
    expect(() => validateFonts([
      { type: 'url', url: 'http://fonts.googleapis.com/css' },
    ])).toThrow(FontValidationError);
  });

  it('skips validation for google font type (no URL to validate)', () => {
    expect(() => validateFonts([
      { type: 'google', family: 'Roboto' },
      { type: 'url', url: 'https://fonts.googleapis.com/css2?family=Inter' },
    ])).not.toThrow();
  });
});

describe('buildGoogleFontUrl', () => {
  it('builds URL for single weight', () => {
    const url = buildGoogleFontUrl('Roboto', [400]);
    expect(url).toBe('https://fonts.googleapis.com/css2?family=Roboto:wght@400&display=swap');
  });

  it('builds URL for multiple weights', () => {
    const url = buildGoogleFontUrl('Roboto', [300, 400, 700]);
    expect(url).toBe('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;700&display=swap');
  });

  it('builds URL without weights (defaults)', () => {
    const url = buildGoogleFontUrl('Roboto');
    expect(url).toBe('https://fonts.googleapis.com/css2?family=Roboto&display=swap');
  });

  it('encodes spaces in font family name', () => {
    const url = buildGoogleFontUrl('Open Sans', [400]);
    expect(url).toContain('Open+Sans');
  });

  it('handles complex font family names', () => {
    const url = buildGoogleFontUrl('Libre Baskerville', [400, 700]);
    expect(url).toContain('Libre+Baskerville');
  });
});
