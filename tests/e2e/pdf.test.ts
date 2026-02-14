import { describe, it, expect } from 'vitest';
import { baseUrl, apiKey, fixtureUrl } from './setup.js';
import { PDFParse } from 'pdf-parse';

async function parsePdf(buffer: Buffer): Promise<{ numpages: number; text: string }> {
  const parser = new PDFParse({ data: buffer });
  await parser.load();
  const info = await parser.getInfo();
  const textResult = await parser.getText();
  await parser.destroy();
  return {
    numpages: info?.total ?? 0,
    text: textResult?.text ?? '',
  };
}

describe('E2E: PDF rendering', () => {
  it('POST /v1/pdf returns valid PDF with correct magic bytes', async () => {
    const res = await fetch(`${baseUrl}/v1/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: fixtureUrl }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-cache')).toBe('MISS');

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(100);

    // PDF magic bytes: %PDF-
    const header = buffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('verifies page count with pdf-parse', async () => {
    const res = await fetch(`${baseUrl}/v1/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: fixtureUrl }),
    });

    expect(res.status).toBe(200);

    const buffer = Buffer.from(await res.arrayBuffer());
    const parsed = await parsePdf(buffer);
    expect(parsed.numpages).toBeGreaterThanOrEqual(1);
    expect(parsed.text).toContain('ScreenForge Test');
  });

  it('renders PDF from HTML content', async () => {
    const res = await fetch(`${baseUrl}/v1/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        html: '<html><body><h1>PDF E2E Test</h1><p>Page content</p></body></html>',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');

    const buffer = Buffer.from(await res.arrayBuffer());
    const header = buffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');

    const parsed = await parsePdf(buffer);
    expect(parsed.text).toContain('PDF E2E Test');
  });

  it('returns cache HIT on duplicate PDF request', async () => {
    const payload = { url: fixtureUrl, format: 'letter', landscape: true };
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };

    // First request
    const res1 = await fetch(`${baseUrl}/v1/pdf`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(200);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    await res1.arrayBuffer();

    // Second request (cached)
    const res2 = await fetch(`${baseUrl}/v1/pdf`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-cache')).toBe('HIT');
  });
});
