import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RenderCache } from '../../src/cache/index.js';
import { loadConfig } from '../../src/config/index.js';
import { resetStorageBackend } from '../../src/storage/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('RenderCache', () => {
  let cache: RenderCache;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'screenforge-test-'));
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_PATH = tempDir;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    loadConfig();
    resetStorageBackend();
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

  it('hashOptions produces different hashes for different formats', () => {
    const hashPng = RenderCache.hashOptions({ url: 'https://example.com', format: 'png' });
    const hashJpeg = RenderCache.hashOptions({ url: 'https://example.com', format: 'jpeg' });
    const hashWebp = RenderCache.hashOptions({ url: 'https://example.com', format: 'webp' });
    expect(hashPng).not.toBe(hashJpeg);
    expect(hashPng).not.toBe(hashWebp);
    expect(hashJpeg).not.toBe(hashWebp);
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

  it('hashOptions excludes cache_ttl from hash computation', () => {
    const withTtl = RenderCache.hashOptions({ url: 'https://example.com', cache_ttl: 3600 });
    const withoutTtl = RenderCache.hashOptions({ url: 'https://example.com' });
    const differentTtl = RenderCache.hashOptions({ url: 'https://example.com', cache_ttl: 7200 });
    expect(withTtl).toBe(withoutTtl);
    expect(withTtl).toBe(differentTtl);
  });

  it('hashOptions includes cache_key in hash computation', () => {
    const withKey = RenderCache.hashOptions({ url: 'https://example.com', cache_key: 'key1' });
    const withoutKey = RenderCache.hashOptions({ url: 'https://example.com' });
    const differentKey = RenderCache.hashOptions({ url: 'https://example.com', cache_key: 'key2' });
    expect(withKey).not.toBe(withoutKey);
    expect(withKey).not.toBe(differentKey);
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

    // Delete the file manually (filePath is a storage key, resolve to actual path)
    await rm(join(tempDir, entry!.filePath));
    const result = await cache.get(hash);
    expect(result).toBeNull();
  });

  it('uses default TTL when ttlSecondsOverride is not provided', async () => {
    const buffer = Buffer.from('default TTL test');
    const hash = 'test-default-ttl';

    await cache.set(hash, buffer, 'image/png', 'png');
    // Since default constructor TTL is 60s, this test just verifies set() succeeds
    const entry = await cache.get(hash);
    expect(entry).not.toBeNull();
  });

  it('uses custom TTL when ttlSecondsOverride is provided', async () => {
    const buffer = Buffer.from('custom TTL test');
    const hash = 'test-custom-ttl';

    // Set with 5 second TTL
    await cache.set(hash, buffer, 'image/png', 'png', undefined, 5);
    const entry = await cache.get(hash);
    expect(entry).not.toBeNull();

    // Wait 6 seconds and verify expired
    await new Promise(resolve => setTimeout(resolve, 6000));
    const expired = await cache.get(hash);
    expect(expired).toBeNull();
  });

  it('accepts ttlSecondsOverride=0 for no expiration', async () => {
    const buffer = Buffer.from('no TTL test');
    const hash = 'test-no-ttl';

    // ttlSecondsOverride=0 should not set expiration
    await cache.set(hash, buffer, 'image/png', 'png', undefined, 0);
    const entry = await cache.get(hash);
    expect(entry).not.toBeNull();
  });
});
