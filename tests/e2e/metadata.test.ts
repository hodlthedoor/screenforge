import { describe, it, expect } from 'vitest';
import { baseUrl, apiKey, fixtureUrl } from './setup.js';
import imageSize from 'image-size';

describe('E2E: Response metadata', () => {
  describe('Screenshot metadata', () => {
    it('metadata=false returns raw binary (default behavior)', async () => {
      const res = await fetch(`${baseUrl}/v1/screenshot?metadata=false`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ url: fixtureUrl }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');

      const buffer = Buffer.from(await res.arrayBuffer());
      expect(buffer[0]).toBe(0x89); // PNG magic bytes
      expect(buffer[1]).toBe(0x50);
    });

    it('metadata=true returns JSON envelope with base64 data and metadata', async () => {
      const res = await fetch(`${baseUrl}/v1/screenshot?metadata=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ url: fixtureUrl }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const data = await res.json();

      // Validate envelope structure
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('contentType');
      expect(data).toHaveProperty('metadata');

      // Validate base64 encoded data
      expect(typeof data.data).toBe('string');
      const buffer = Buffer.from(data.data, 'base64');
      expect(buffer[0]).toBe(0x89); // PNG magic bytes

      // Validate content type
      expect(data.contentType).toBe('image/png');

      // Validate metadata fields
      expect(data.metadata).toHaveProperty('title');
      expect(data.metadata).toHaveProperty('finalUrl');
      expect(data.metadata).toHaveProperty('statusCode');
      expect(data.metadata).toHaveProperty('durationMs');
      expect(data.metadata).toHaveProperty('width');
      expect(data.metadata).toHaveProperty('height');

      expect(typeof data.metadata.title).toBe('string');
      expect(typeof data.metadata.finalUrl).toBe('string');
      expect(typeof data.metadata.statusCode).toBe('number');
      expect(typeof data.metadata.durationMs).toBe('number');
      expect(typeof data.metadata.width).toBe('number');
      expect(typeof data.metadata.height).toBe('number');

      expect(data.metadata.statusCode).toBe(200);
      expect(data.metadata.finalUrl).toBe(fixtureUrl);
      expect(data.metadata.durationMs).toBeGreaterThan(0);

      // Verify dimensions match actual image
      const dimensions = imageSize(buffer);
      expect(data.metadata.width).toBe(dimensions.width);
      expect(data.metadata.height).toBe(dimensions.height);
    });

    it('metadata=true with redirected URL captures final URL', async () => {
      // Use httpbin.org for redirect testing
      const redirectUrl = 'https://httpbin.org/redirect-to?url=https://httpbin.org/html';

      const res = await fetch(`${baseUrl}/v1/screenshot?metadata=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ url: redirectUrl }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // Final URL should be different from original
      expect(data.metadata.finalUrl).toBe('https://httpbin.org/html');
      expect(data.metadata.finalUrl).not.toBe(redirectUrl);
    });

    it('metadata=true captures custom viewport dimensions', async () => {
      const res = await fetch(`${baseUrl}/v1/screenshot?metadata=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url: fixtureUrl,
          viewport: { width: 800, height: 600 },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.metadata.width).toBe(800);
      expect(data.metadata.height).toBe(600);
    });

    it('metadata=true with fullPage captures full page height', async () => {
      const res = await fetch(`${baseUrl}/v1/screenshot?metadata=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url: fixtureUrl,
          fullPage: true,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // Full page screenshot should have height >= viewport height
      expect(data.metadata.height).toBeGreaterThanOrEqual(1080);
    });
  });

  describe('PDF metadata', () => {
    it('metadata=false returns raw PDF binary (default behavior)', async () => {
      const res = await fetch(`${baseUrl}/v1/pdf?metadata=false`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ url: fixtureUrl }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');

      const buffer = Buffer.from(await res.arrayBuffer());
      expect(buffer.toString('utf-8', 0, 4)).toBe('%PDF');
    });

    it('metadata=true returns JSON envelope with base64 PDF and metadata', async () => {
      const res = await fetch(`${baseUrl}/v1/pdf?metadata=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ url: fixtureUrl }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');

      const data = await res.json();

      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('contentType');
      expect(data).toHaveProperty('metadata');

      expect(data.contentType).toBe('application/pdf');

      // Validate PDF is base64 encoded
      const buffer = Buffer.from(data.data, 'base64');
      expect(buffer.toString('utf-8', 0, 4)).toBe('%PDF');

      // Validate metadata
      expect(data.metadata.title).toBeTruthy();
      expect(data.metadata.finalUrl).toBe(fixtureUrl);
      expect(data.metadata.statusCode).toBe(200);
      expect(data.metadata.durationMs).toBeGreaterThan(0);

      // PDF metadata should not have width/height
      expect(data.metadata).not.toHaveProperty('width');
      expect(data.metadata).not.toHaveProperty('height');
    });
  });

  describe('Async render metadata', () => {
    it('async job returns metadata in poll response when completed', async () => {
      // Queue async job
      const createRes = await fetch(`${baseUrl}/v1/screenshot?async=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ url: fixtureUrl }),
      });

      expect(createRes.status).toBe(202);
      const createData = await createRes.json();
      const jobId = createData.id;

      // Poll until completed
      let completed = false;
      let pollData: Record<string, unknown>;
      for (let i = 0; i < 30 && !completed; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const pollRes = await fetch(`${baseUrl}/v1/render/${jobId}`);
        pollData = await pollRes.json();
        completed = pollData.status === 'completed';
      }

      expect(pollData.status).toBe('completed');
      expect(pollData).toHaveProperty('metadata');
      expect(pollData.metadata).toHaveProperty('title');
      expect(pollData.metadata).toHaveProperty('finalUrl');
      expect(pollData.metadata).toHaveProperty('statusCode');
      expect(pollData.metadata).toHaveProperty('durationMs');
      expect(pollData.metadata).toHaveProperty('width');
      expect(pollData.metadata).toHaveProperty('height');
    });
  });
});
