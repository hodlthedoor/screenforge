import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RenderCache } from '../../src/cache/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('RenderCache', () => {
  let cache: RenderCache;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'screenforge-test-'));
    cache = new RenderCache('redis://127.0.0.1:6379/15', tempDir, 60);
  });

  afterAll(async () => {
    await cache.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('hashOptions produces consistent hashes', () => {
    const hash1 = RenderCache.hashOptions({ url: 'https://example.com', format: 'png' });
    const hash2 = RenderCache.hashOptions({ format: 'png', url: 'https://example.com' });
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16);
  });

  it('hashOptions produces different hashes for different inputs', () => {
    const hash1 = RenderCache.hashOptions({ url: 'https://example.com' });
    const hash2 = RenderCache.hashOptions({ url: 'https://other.com' });
    expect(hash1).not.toBe(hash2);
  });

  it('hashOptions deep-sorts nested objects', () => {
    const hash1 = RenderCache.hashOptions({
      url: 'https://example.com',
      viewport: { width: 1920, height: 1080 },
    });
    const hash2 = RenderCache.hashOptions({
      viewport: { height: 1080, width: 1920 },
      url: 'https://example.com',
    });
    expect(hash1).toBe(hash2);
  });

  it('returns null for cache miss', async () => {
    const result = await cache.get('nonexistent-hash-val');
    expect(result).toBeNull();
  });

  it('stores and retrieves a cached entry', async () => {
    const buffer = Buffer.from('test image data');
    const hash = 'test-store-hash1';

    await cache.set(hash, buffer, 'image/png', 'png');
    const entry = await cache.get(hash);

    expect(entry).not.toBeNull();
    expect(entry!.contentType).toBe('image/png');

    const data = await cache.readFile(entry!.filePath);
    expect(data.toString()).toBe('test image data');
  });

  it('returns null when file is deleted but Redis entry exists', async () => {
    const buffer = Buffer.from('will be deleted');
    const hash = 'test-deleted-fil';

    await cache.set(hash, buffer, 'image/png', 'png');
    const entry = await cache.get(hash);
    expect(entry).not.toBeNull();

    // Delete the file manually
    await rm(entry!.filePath);
    const result = await cache.get(hash);
    expect(result).toBeNull();
  });
});
