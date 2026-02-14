import { describe, it, expect } from 'vitest';
import { baseUrl, apiKey, fixtureUrl } from './setup.js';

async function pollBatch(batchId: string, maxWaitMs = 30_000): Promise<{
  id: string;
  total: number;
  completed: number;
  failed: number;
  status: string;
  jobs: Array<{ id: string; status: string; type: string }>;
}> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`${baseUrl}/v1/batch/${batchId}`);
    if (!res.ok) throw new Error(`Batch poll failed: ${res.status}`);
    const data = await res.json();
    if (data.status === 'completed' || data.status === 'failed') {
      return data;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Batch ${batchId} did not complete within ${maxWaitMs}ms`);
}

describe('E2E: Batch rendering', () => {
  it('POST /v1/batch with 3 items completes successfully', async () => {
    const res = await fetch(`${baseUrl}/v1/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        items: [
          { type: 'screenshot', url: fixtureUrl },
          { type: 'screenshot', url: fixtureUrl, options: { format: 'jpeg' } },
          { type: 'pdf', url: fixtureUrl },
        ],
      }),
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.batchId).toBeDefined();
    expect(body.total).toBe(3);
    expect(body.status).toBe('processing');
    expect(body.jobs).toHaveLength(3);
    expect(body.jobs[0].id).toBeDefined();
    expect(body.jobs[0].pollUrl).toContain('/v1/render/');

    // Poll until complete
    const result = await pollBatch(body.batchId);
    expect(result.status).toBe('completed');
    expect(result.completed).toBe(3);
    expect(result.failed).toBe(0);

    // Verify each job completed
    for (const job of result.jobs) {
      expect(job.status).toBe('completed');
    }
  });

  it('each batch job output is retrievable via poll endpoint', async () => {
    const res = await fetch(`${baseUrl}/v1/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        items: [
          { type: 'screenshot', url: fixtureUrl },
        ],
      }),
    });

    const body = await res.json();
    const result = await pollBatch(body.batchId);

    // Poll individual job to get the rendered content
    const jobRes = await fetch(`${baseUrl}/v1/render/${result.jobs[0].id}`, {
      headers: { Accept: 'image/png' },
    });
    expect(jobRes.status).toBe(200);
    expect(jobRes.headers.get('content-type')).toBe('image/png');

    const buffer = Buffer.from(await jobRes.arrayBuffer());
    expect(buffer[0]).toBe(0x89); // PNG magic
  });
});
