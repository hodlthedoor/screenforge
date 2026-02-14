import { describe, it, expect } from 'vitest';
import { baseUrl, apiKey, fixtureUrl } from './setup.js';
import sharp from 'sharp';

describe('thumbnail E2E', { timeout: 120_000 }, () => {
  it('returns thumbnail in sync screenshot with metadata envelope', async () => {
    const res = await fetch(`${baseUrl}/v1/screenshot?metadata=true`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        url: fixtureUrl,
        thumbnail: {
          width: 320,
          height: 240,
          fit: 'cover',
          format: 'webp',
          quality: 80,
        },
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();

    expect(data).toHaveProperty('data');
    expect(data).toHaveProperty('thumbnail');
    expect(data).toHaveProperty('metadata');
    expect(data).toHaveProperty('contentType');

    // Decode and verify thumbnail
    const thumbnailBuffer = Buffer.from(data.thumbnail, 'base64');
    const metadata = await sharp(thumbnailBuffer).metadata();
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
    expect(metadata.format).toBe('webp');
  });

  it('does not return thumbnail when not requested in sync mode', async () => {
    const res = await fetch(`${baseUrl}/v1/screenshot?metadata=true`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        url: fixtureUrl,
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();

    expect(data).toHaveProperty('data');
    expect(data).not.toHaveProperty('thumbnail');
  });

  it('returns thumbnailUrl in async screenshot job', async () => {
    // Create async job
    const createRes = await fetch(`${baseUrl}/v1/screenshot?async=true`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        url: fixtureUrl,
        thumbnail: {
          width: 320,
          height: 240,
          fit: 'cover',
          format: 'webp',
          quality: 80,
        },
      }),
    });

    expect(createRes.status).toBe(202);
    const createData = await createRes.json();
    expect(createData).toHaveProperty('id');
    expect(createData).toHaveProperty('pollUrl');

    // Poll until complete
    const jobId = createData.id;
    let jobStatus;
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      const pollRes = await fetch(`${baseUrl}/v1/render/${jobId}`, {
        headers: { 'x-api-key': apiKey },
      });
      expect(pollRes.ok).toBe(true);
      jobStatus = await pollRes.json();

      if (jobStatus.status === 'completed') break;
      if (jobStatus.status === 'failed') throw new Error(`Job failed: ${jobStatus.error}`);

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    expect(jobStatus?.status).toBe('completed');
    expect(jobStatus).toHaveProperty('downloadUrl');
    expect(jobStatus).toHaveProperty('thumbnailUrl');

    // Verify thumbnail URL returns valid image
    const thumbRes = await fetch(jobStatus!.thumbnailUrl, {
      headers: { 'x-api-key': apiKey },
    });
    expect(thumbRes.ok).toBe(true);
    const thumbBuffer = Buffer.from(await thumbRes.arrayBuffer());
    const metadata = await sharp(thumbBuffer).metadata();
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(240);
  });

  it('returns thumbnailUrl in batch job items', async () => {
    const batchRes = await fetch(`${baseUrl}/v1/batch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        items: [
          {
            type: 'screenshot',
            url: fixtureUrl,
            options: {
              thumbnail: {
                width: 320,
                height: 240,
                fit: 'cover',
                format: 'webp',
                quality: 80,
              },
            },
          },
        ],
      }),
    });

    expect(batchRes.status).toBe(202);
    const batchData = await batchRes.json();
    const batchId = batchData.batchId;

    // Poll until complete
    let batchStatus;
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      const pollRes = await fetch(`${baseUrl}/v1/batch/${batchId}`, {
        headers: { 'x-api-key': apiKey },
      });
      expect(pollRes.ok).toBe(true);
      batchStatus = await pollRes.json();

      if (batchStatus.status === 'completed') break;
      if (batchStatus.status === 'failed') throw new Error('Batch failed');

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    expect(batchStatus?.status).toBe('completed');
    expect(batchStatus?.jobs).toHaveLength(1);
    expect(batchStatus?.jobs[0]).toHaveProperty('downloadUrl');
    expect(batchStatus?.jobs[0]).toHaveProperty('thumbnailUrl');
  });

  it('validates thumbnail dimensions', async () => {
    const res = await fetch(`${baseUrl}/v1/screenshot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        url: fixtureUrl,
        thumbnail: {
          width: 10000, // Invalid: too large
          height: 240,
          fit: 'cover',
          format: 'webp',
          quality: 80,
        },
      }),
    });

    expect(res.status).toBe(400);
  });

  it('validates thumbnail format', async () => {
    const res = await fetch(`${baseUrl}/v1/screenshot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        url: fixtureUrl,
        thumbnail: {
          width: 320,
          height: 240,
          fit: 'cover',
          format: 'invalid', // Invalid format
          quality: 80,
        },
      }),
    });

    expect(res.status).toBe(400);
  });
});
