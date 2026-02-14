import { describe, it, expect } from 'vitest';
import { baseUrl, apiKey } from './setup.js';

describe('E2E: Enhanced metadata extraction', () => {
  describe('Screenshot with extract_metadata', () => {
    it('extract_metadata: false behaves like normal (no enhanced metadata)', async () => {
      const res = await fetch(`${baseUrl}/v1/screenshot?metadata=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url: 'https://example.com',
          extract_metadata: false,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // Should have basic metadata only (title, finalUrl, statusCode, width, height)
      expect(data.metadata).toHaveProperty('title');
      expect(data.metadata).toHaveProperty('finalUrl');
      expect(data.metadata).toHaveProperty('statusCode');

      // Should NOT have enhanced metadata
      expect(data.metadata).not.toHaveProperty('og');
      expect(data.metadata).not.toHaveProperty('twitter');
      expect(data.metadata).not.toHaveProperty('favicon');
    });

    it('extract_metadata: true returns enhanced metadata with OG tags', async () => {
      const res = await fetch(`${baseUrl}/v1/screenshot?metadata=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url: 'https://example.com',
          extract_metadata: true,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // Should have enhanced metadata
      expect(data.metadata).toHaveProperty('title');
      expect(data.metadata).toHaveProperty('description');
      expect(data.metadata).toHaveProperty('canonical');
      expect(data.metadata).toHaveProperty('language');
      expect(data.metadata).toHaveProperty('locale');
      expect(data.metadata).toHaveProperty('favicon');
      expect(data.metadata).toHaveProperty('og');
      expect(data.metadata).toHaveProperty('twitter');

      // Validate OG structure
      expect(typeof data.metadata.og).toBe('object');
      expect(typeof data.metadata.twitter).toBe('object');
    });

    it('extract_metadata works with HTML input', async () => {
      const html = `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <title>Test HTML</title>
            <meta name="description" content="HTML Test Description" />
            <meta property="og:title" content="OG Test Title" />
            <meta property="og:image" content="https://example.com/test.jpg" />
            <meta name="twitter:card" content="summary" />
            <link rel="canonical" href="https://example.com/canonical" />
            <link rel="icon" href="https://example.com/favicon.ico" />
          </head>
          <body><h1>Test</h1></body>
        </html>
      `;

      const res = await fetch(`${baseUrl}/v1/screenshot?metadata=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          html,
          extract_metadata: true,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.metadata.title).toBe('Test HTML');
      expect(data.metadata.description).toBe('HTML Test Description');
      expect(data.metadata.canonical).toBe('https://example.com/canonical');
      expect(data.metadata.language).toBe('en');
      expect(data.metadata.favicon).toBe('https://example.com/favicon.ico');
      expect(data.metadata.og.title).toBe('OG Test Title');
      expect(data.metadata.og.image).toBe('https://example.com/test.jpg');
      expect(data.metadata.twitter.card).toBe('summary');
    });
  });

  describe('PDF with extract_metadata', () => {
    it('extract_metadata: true returns enhanced metadata for PDFs', async () => {
      const res = await fetch(`${baseUrl}/v1/pdf?metadata=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url: 'https://example.com',
          extract_metadata: true,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // PDFs should have enhanced metadata (no width/height)
      expect(data.metadata).toHaveProperty('title');
      expect(data.metadata).toHaveProperty('description');
      expect(data.metadata).toHaveProperty('og');
      expect(data.metadata).toHaveProperty('twitter');

      // PDFs should NOT have width/height
      expect(data.metadata).not.toHaveProperty('width');
      expect(data.metadata).not.toHaveProperty('height');
    });
  });

  describe('Async render with extract_metadata', () => {
    it('async job stores enhanced metadata when extract_metadata: true', async () => {
      const createRes = await fetch(`${baseUrl}/v1/screenshot?async=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url: 'https://example.com',
          extract_metadata: true,
        }),
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
      expect(pollData.metadata).toHaveProperty('og');
      expect(pollData.metadata).toHaveProperty('twitter');
      expect(pollData.metadata).toHaveProperty('description');
    });
  });

  describe('Batch render with extract_metadata', () => {
    it('batch items with extract_metadata return enhanced metadata', async () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Batch Test</title>
            <meta property="og:title" content="Batch OG Title" />
          </head>
          <body><p>Batch content</p></body>
        </html>
      `;

      const createRes = await fetch(`${baseUrl}/v1/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          items: [
            {
              type: 'screenshot',
              html,
              options: { extract_metadata: true },
            },
          ],
        }),
      });

      expect(createRes.status).toBe(202);
      const createData = await createRes.json();
      const batchId = createData.id;

      // Poll until completed
      let completed = false;
      let pollData: Record<string, unknown> | undefined;
      for (let i = 0; i < 30 && !completed; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const pollRes = await fetch(`${baseUrl}/v1/batch/${batchId}`);
        pollData = await pollRes.json();
        completed = pollData.status === 'completed';
      }

      expect(pollData).toBeDefined();
      expect(pollData!.status).toBe('completed');
      const data = pollData as Record<string, unknown>;
      const jobs = data.jobs as Array<Record<string, unknown>>;
      expect(jobs).toHaveLength(1);
      const metadata = jobs[0].metadata as Record<string, Record<string, string>>;
      expect(metadata).toHaveProperty('og');
      expect(metadata.og.title).toBe('Batch OG Title');
    });
  });
});
