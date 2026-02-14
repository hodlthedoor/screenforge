import { describe, it, expect } from 'vitest';
import { baseUrl, apiKey, fixtureUrl } from './setup.js';
import imageSize from 'image-size';
import { readdir } from 'node:fs/promises';
import { TEST_STORAGE } from './setup.js';

describe('E2E: Screenshot rendering', () => {
  it('POST /v1/screenshot returns valid PNG with correct magic bytes', async () => {
    const res = await fetch(`${baseUrl}/v1/screenshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: fixtureUrl }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(res.headers.get('x-render-duration-ms')).toBeDefined();

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(100);

    // PNG magic bytes: 0x89504E47
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(buffer[2]).toBe(0x4e);
    expect(buffer[3]).toBe(0x47);

    // Verify dimensions with image-size
    const dimensions = imageSize(buffer);
    expect(dimensions.width).toBeGreaterThan(0);
    expect(dimensions.height).toBeGreaterThan(0);
    expect(dimensions.type).toBe('png');
  });

  it('stores rendered file in storage directory', async () => {
    // The previous test should have stored a file
    const dirs = await readdir(TEST_STORAGE, { withFileTypes: true });
    const hasFiles = dirs.some((d) => d.isDirectory() || d.name.endsWith('.png'));
    expect(hasFiles).toBe(true);
  });

  it('returns cache HIT on duplicate request (faster)', async () => {
    const payload = { url: fixtureUrl, format: 'jpeg', quality: 80 };
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    // First request (cold)
    const t1 = performance.now();
    const res1 = await fetch(`${baseUrl}/v1/screenshot`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const duration1 = performance.now() - t1;
    expect(res1.status).toBe(200);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    await res1.arrayBuffer(); // consume body

    // Second request (should be cached)
    const t2 = performance.now();
    const res2 = await fetch(`${baseUrl}/v1/screenshot`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const duration2 = performance.now() - t2;
    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-cache')).toBe('HIT');
    expect(res2.headers.get('x-render-duration-ms')).toBe('0');

    // Cache hit should be faster
    expect(duration2).toBeLessThan(duration1);
  });

  it('renders HTML content directly', async () => {
    const res = await fetch(`${baseUrl}/v1/screenshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        html: '<html><body><h1>Hello E2E</h1></body></html>',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
  });
});
