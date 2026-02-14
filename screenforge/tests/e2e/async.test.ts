import { describe, it, expect } from 'vitest';
import { baseUrl, apiKey, fixtureUrl } from './setup.js';

async function pollJob(jobId: string, maxWaitMs = 30_000): Promise<{
  id: string;
  status: string;
  type: string;
  contentType?: string;
  durationMs?: number;
  error?: string;
}> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${baseUrl}/v1/render/${jobId}`);
    if (!res.ok) throw new Error(`Job poll failed: ${res.status}`);
    const data = await res.json();
    if (data.status === 'completed' || data.status === 'failed') {
      return data;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Job ${jobId} did not complete within ${maxWaitMs}ms`);
}

describe('E2E: Async rendering', () => {
  it('POST /v1/screenshot?async=true returns 202 with job ID', async () => {
    const res = await fetch(`${baseUrl}/v1/screenshot?async=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: fixtureUrl }),
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe('pending');
    expect(body.pollUrl).toContain('/v1/render/');
  });

  it('async screenshot job completes and returns valid content', async () => {
    const res = await fetch(`${baseUrl}/v1/screenshot?async=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: fixtureUrl }),
    });

    const { id: jobId } = await res.json();

    // Poll until complete
    const jobStatus = await pollJob(jobId);
    expect(jobStatus.status).toBe('completed');
    expect(jobStatus.contentType).toBe('image/png');
    expect(jobStatus.durationMs).toBeGreaterThan(0);

    // Fetch the actual rendered content
    const contentRes = await fetch(`${baseUrl}/v1/render/${jobId}`, {
      headers: { Accept: 'image/png' },
    });
    expect(contentRes.status).toBe(200);
    expect(contentRes.headers.get('content-type')).toBe('image/png');

    const buffer = Buffer.from(await contentRes.arrayBuffer());
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(buffer[2]).toBe(0x4e);
    expect(buffer[3]).toBe(0x47);
  });

  it('async PDF job completes and returns valid content', async () => {
    const res = await fetch(`${baseUrl}/v1/pdf?async=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: fixtureUrl }),
    });

    expect(res.status).toBe(202);
    const { id: jobId } = await res.json();

    const jobStatus = await pollJob(jobId);
    expect(jobStatus.status).toBe('completed');
    expect(jobStatus.contentType).toBe('application/pdf');

    // Fetch rendered PDF
    const contentRes = await fetch(`${baseUrl}/v1/render/${jobId}`, {
      headers: { Accept: 'application/pdf' },
    });
    expect(contentRes.status).toBe(200);
    expect(contentRes.headers.get('content-type')).toBe('application/pdf');

    const buffer = Buffer.from(await contentRes.arrayBuffer());
    const header = buffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('polling a non-existent job returns 404', async () => {
    const res = await fetch(`${baseUrl}/v1/render/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('JOB_NOT_FOUND');
  });
});
