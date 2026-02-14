import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserPool } from '../../src/renderer/browser-pool.js';
import { takeScreenshot } from '../../src/renderer/screenshot.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const FIXTURE_URL = pathToFileURL(resolve(__dirname, '../fixtures/test-page.html')).toString();

describe('thumbnail generation', { timeout: 60_000 }, () => {
  let pool: BrowserPool;

  beforeAll(async () => {
    pool = new BrowserPool(1, 100);
    await pool.init();
  });

  afterAll(async () => {
    await pool.close();
  });

  it('generates thumbnail with default settings', async () => {
    const result = await takeScreenshot(pool, {
      url: FIXTURE_URL,
      viewport: { width: 1920, height: 1080 },
      format: 'png',
      fullPage: false,
      darkMode: false,
      deviceScaleFactor: 1,
      extract_metadata: false,
      thumbnail: {
        width: 320,
        height: 240,
        fit: 'cover',
        format: 'webp',
        quality: 80,
      },
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.thumbnailBuffer).toBeInstanceOf(Buffer);
    expect(result.thumbnailBuffer!.length).toBeLessThan(result.buffer.length);

    // Verify thumbnail dimensions
    const metadata = await sharp(result.thumbnailBuffer!).metadata();
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
    expect(metadata.format).toBe('webp');
  });

  it('generates thumbnail with custom dimensions', async () => {
    const result = await takeScreenshot(pool, {
      url: FIXTURE_URL,
      viewport: { width: 1920, height: 1080 },
      format: 'png',
      fullPage: false,
      darkMode: false,
      deviceScaleFactor: 1,
      extract_metadata: false,
      thumbnail: {
        width: 640,
        height: 480,
        fit: 'cover',
        format: 'webp',
        quality: 80,
      },
    });

    const metadata = await sharp(result.thumbnailBuffer!).metadata();
    expect(metadata.width).toBe(640);
    expect(metadata.height).toBe(480);
  });

  it('generates thumbnail with contain fit', async () => {
    const result = await takeScreenshot(pool, {
      url: FIXTURE_URL,
      viewport: { width: 1920, height: 1080 },
      format: 'png',
      fullPage: false,
      darkMode: false,
      deviceScaleFactor: 1,
      extract_metadata: false,
      thumbnail: {
        width: 320,
        height: 240,
        fit: 'contain',
        format: 'webp',
        quality: 80,
      },
    });

    expect(result.thumbnailBuffer).toBeInstanceOf(Buffer);
    const metadata = await sharp(result.thumbnailBuffer!).metadata();
    // Contain fit should preserve aspect ratio and fit within bounds
    expect(metadata.width).toBeLessThanOrEqual(320);
    expect(metadata.height).toBeLessThanOrEqual(240);
  });

  it('generates thumbnail with fill fit', async () => {
    const result = await takeScreenshot(pool, {
      url: FIXTURE_URL,
      viewport: { width: 1920, height: 1080 },
      format: 'png',
      fullPage: false,
      darkMode: false,
      deviceScaleFactor: 1,
      extract_metadata: false,
      thumbnail: {
        width: 320,
        height: 240,
        fit: 'fill',
        format: 'webp',
        quality: 80,
      },
    });

    const metadata = await sharp(result.thumbnailBuffer!).metadata();
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
  });

  it('generates thumbnail in png format', async () => {
    const result = await takeScreenshot(pool, {
      url: FIXTURE_URL,
      viewport: { width: 1920, height: 1080 },
      format: 'png',
      fullPage: false,
      darkMode: false,
      deviceScaleFactor: 1,
      extract_metadata: false,
      thumbnail: {
        width: 320,
        height: 240,
        fit: 'cover',
        format: 'png',
        quality: 80,
      },
    });

    const metadata = await sharp(result.thumbnailBuffer!).metadata();
    expect(metadata.format).toBe('png');
  });

  it('generates thumbnail in jpeg format', async () => {
    const result = await takeScreenshot(pool, {
      url: FIXTURE_URL,
      viewport: { width: 1920, height: 1080 },
      format: 'png',
      fullPage: false,
      darkMode: false,
      deviceScaleFactor: 1,
      extract_metadata: false,
      thumbnail: {
        width: 320,
        height: 240,
        fit: 'cover',
        format: 'jpeg',
        quality: 80,
      },
    });

    const metadata = await sharp(result.thumbnailBuffer!).metadata();
    expect(metadata.format).toBe('jpeg');
  });

  it('generates thumbnail with custom quality', async () => {
    const result = await takeScreenshot(pool, {
      url: FIXTURE_URL,
      viewport: { width: 1920, height: 1080 },
      format: 'png',
      fullPage: false,
      darkMode: false,
      deviceScaleFactor: 1,
      extract_metadata: false,
      thumbnail: {
        width: 320,
        height: 240,
        fit: 'cover',
        format: 'jpeg',
        quality: 50,
      },
    });

    expect(result.thumbnailBuffer).toBeInstanceOf(Buffer);
    // Lower quality should produce smaller file
    expect(result.thumbnailBuffer!.length).toBeLessThan(30000); // Rough estimate for low quality
  });

  it('does not generate thumbnail when not requested', async () => {
    const result = await takeScreenshot(pool, {
      url: FIXTURE_URL,
      viewport: { width: 1920, height: 1080 },
      format: 'png',
      fullPage: false,
      darkMode: false,
      deviceScaleFactor: 1,
      extract_metadata: false,
    });

    expect(result.thumbnailBuffer).toBeUndefined();
  });
});
