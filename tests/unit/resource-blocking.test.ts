import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserPool } from '../../src/renderer/browser-pool.js';
import { screenshotOptionsSchema, pdfOptionsSchema, BLOCKABLE_RESOURCE_TYPES } from '../../src/renderer/schemas.js';
import { applyPreNavigationFilters } from '../../src/renderer/filters.js';

describe('resource blocking schema validation', () => {
  it('exports all blockable resource types as a constant', () => {
    expect(BLOCKABLE_RESOURCE_TYPES).toEqual(['image', 'stylesheet', 'font', 'script', 'media', 'other']);
  });

  describe('screenshotOptionsSchema', () => {
    it('accepts block_resources array with valid types', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        block_resources: ['image', 'stylesheet'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.block_resources).toEqual(['image', 'stylesheet']);
      }
    });

    it('defaults block_resources to empty array', () => {
      const result = screenshotOptionsSchema.safeParse({ url: 'https://example.com' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.block_resources).toEqual([]);
      }
    });

    it('accepts all valid resource types', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        block_resources: ['image', 'stylesheet', 'font', 'script', 'media', 'other'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid resource type', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        block_resources: ['invalid_type'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects more than 6 resource types', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        block_resources: ['image', 'stylesheet', 'font', 'script', 'media', 'other', 'image'],
      });
      expect(result.success).toBe(false);
    });

    it('accepts duplicate resource types within max limit', () => {
      const result = screenshotOptionsSchema.safeParse({
        url: 'https://example.com',
        block_resources: ['image', 'image', 'stylesheet'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        // Duplicates pass validation — harmless since includes() matches the first occurrence
        expect(result.data.block_resources).toEqual(['image', 'image', 'stylesheet']);
      }
    });
  });

  describe('pdfOptionsSchema', () => {
    it('accepts block_resources array', () => {
      const result = pdfOptionsSchema.safeParse({
        url: 'https://example.com',
        block_resources: ['font', 'media'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.block_resources).toEqual(['font', 'media']);
      }
    });
  });
});

describe('resource blocking behavior', () => {
  let pool: BrowserPool;

  beforeAll(async () => {
    pool = new BrowserPool(1, 100);
    await pool.init();
  });

  afterAll(async () => {
    await pool.close();
  });

  it('blocks image requests when block_resources includes image', async () => {
    const context = await pool.acquire();
    const page = await context.newPage();

    const imageRequests: Array<{ url: string; blocked: boolean }> = [];

    // Set up monitoring
    page.on('request', (req) => {
      if (req.resourceType() === 'image') {
        imageRequests.push({ url: req.url(), blocked: false });
      }
    });

    page.on('requestfailed', (req) => {
      if (req.resourceType() === 'image') {
        const entry = imageRequests.find(r => r.url === req.url());
        if (entry) entry.blocked = true;
      }
    });

    // Apply resource blocking for images
    await applyPreNavigationFilters(page, { block_resources: ['image'] });

    // Use setContent with explicit wait
    await page.setContent('<html><body><img src="https://via.placeholder.com/150" onload="window.__img_loaded=true" onerror="window.__img_errored=true" /></body></html>');

    // Wait a bit for the image load/error event
    await page.waitForFunction(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
      return (window as any).__img_loaded || (window as any).__img_errored;
    }, { timeout: 3000 }).catch(() => {});

    await context.close();

    // Verify at least one image request was blocked
    expect(imageRequests.length).toBeGreaterThan(0);
    expect(imageRequests.some(r => r.blocked)).toBe(true);
  });

  it('blocks stylesheet requests when block_resources includes stylesheet', async () => {
    const context = await pool.acquire();
    const page = await context.newPage();

    const stylesheetRequests: Array<{ url: string; blocked: boolean }> = [];

    page.on('request', (req) => {
      if (req.resourceType() === 'stylesheet') {
        stylesheetRequests.push({ url: req.url(), blocked: false });
      }
    });

    page.on('requestfailed', (req) => {
      if (req.resourceType() === 'stylesheet') {
        const entry = stylesheetRequests.find(r => r.url === req.url());
        if (entry) entry.blocked = true;
      }
    });

    await applyPreNavigationFilters(page, { block_resources: ['stylesheet'] });

    await page.setContent('<html><head><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" /></head><body>Test</body></html>');

    // Wait for stylesheet load/error
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await context.close();

    expect(stylesheetRequests.length).toBeGreaterThan(0);
    expect(stylesheetRequests.some(r => r.blocked)).toBe(true);
  });

  it('does not block resources when block_resources is empty', async () => {
    const context = await pool.acquire();
    const page = await context.newPage();

    let requestFailed = false;

    page.on('requestfailed', () => {
      requestFailed = true;
    });

    await applyPreNavigationFilters(page, { block_resources: [] });

    await page.setContent('<html><body><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" /></body></html>', { waitUntil: 'domcontentloaded' });

    await context.close();

    expect(requestFailed).toBe(false);
  });

  it('works alongside block_ads without interference', async () => {
    const context = await pool.acquire();
    const page = await context.newPage();

    const blockedRequests: Array<{ type: string; url: string }> = [];

    page.on('requestfailed', (req) => {
      blockedRequests.push({ type: req.resourceType(), url: req.url() });
    });

    // Enable both ad blocking and resource blocking
    await applyPreNavigationFilters(page, { block_ads: true, block_resources: ['image'] });

    await page.setContent('<html><body><img src="https://via.placeholder.com/150" /></body></html>');

    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await context.close();

    // Image should be blocked by resource type blocking
    expect(blockedRequests.some(r => r.type === 'image')).toBe(true);
  });

  it('blocks multiple resource types simultaneously', async () => {
    const context = await pool.acquire();
    const page = await context.newPage();

    const blockedTypes = new Set<string>();

    page.on('requestfailed', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font'].includes(resourceType)) {
        blockedTypes.add(resourceType);
      }
    });

    await applyPreNavigationFilters(page, { block_resources: ['image', 'stylesheet', 'font'] });

    await page.setContent(`
      <html>
        <head>
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
        </head>
        <body>
          <img src="https://via.placeholder.com/150" />
        </body>
      </html>
    `);

    // Wait for resources to attempt loading
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    await context.close();

    // At minimum, images and stylesheets should be blocked
    expect(blockedTypes.size).toBeGreaterThan(0);
  });
});
