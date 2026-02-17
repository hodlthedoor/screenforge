import { describe, it, expect } from 'vitest';
import { baseUrl, apiKey } from './setup.js';
import crypto from 'node:crypto';

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${apiKey}`,
};

describe('E2E: Font loading', () => {
  // HTML that renders large text — uses Roboto with monospace fallback
  // When Roboto is loaded via fonts option, the rendering should differ from monospace fallback
  const testHtml = `<!DOCTYPE html>
<html><head><style>
  body { margin: 0; background: white; }
  h1 { font-size: 120px; font-family: 'Roboto', monospace; color: black; padding: 40px; }
</style></head>
<body><h1>Font Test 1234</h1></body></html>`;

  it('renders HTML with custom font differently than without', async () => {
    // Render without custom fonts (uses fallback monospace)
    const resNoFont = await fetch(`${baseUrl}/v1/screenshot`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        html: testHtml,
        viewport: { width: 800, height: 400 },
        format: 'png',
        cache_ttl: 0,
      }),
    });
    expect(resNoFont.status).toBe(200);
    const bufNoFont = Buffer.from(await resNoFont.arrayBuffer());
    const hashNoFont = crypto.createHash('md5').update(bufNoFont).digest('hex');

    // Render with a Google Font (sans-serif) that should differ from monospace fallback
    const resWithFont = await fetch(`${baseUrl}/v1/screenshot`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        html: testHtml,
        viewport: { width: 800, height: 400 },
        format: 'png',
        cache_ttl: 0,
        fonts: [{ family: 'Roboto', weights: [400] }],
      }),
    });
    expect(resWithFont.status).toBe(200);
    const bufWithFont = Buffer.from(await resWithFont.arrayBuffer());
    const hashWithFont = crypto.createHash('md5').update(bufWithFont).digest('hex');

    // The outputs should differ — font loading should change the rendering
    expect(hashWithFont).not.toBe(hashNoFont);
  });

  it('returns 400 VALIDATION_ERROR for disallowed font URL domain', async () => {
    const res = await fetch(`${baseUrl}/v1/screenshot`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        html: '<html><body>test</body></html>',
        fonts: [{ url: 'https://evil.com/font.css' }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/not allowed/i);
  });

  it('returns 400 VALIDATION_ERROR for non-HTTPS font URL', async () => {
    const res = await fetch(`${baseUrl}/v1/screenshot`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        html: '<html><body>test</body></html>',
        fonts: [{ url: 'http://fonts.googleapis.com/css' }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/HTTPS/i);
  });

  it('returns 400 for PDF with invalid font URL', async () => {
    const res = await fetch(`${baseUrl}/v1/pdf`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        html: '<html><body>test</body></html>',
        fonts: [{ url: 'https://evil.com/font.css' }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for OG with invalid font URL', async () => {
    const res = await fetch(`${baseUrl}/v1/og`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Test',
        fonts: [{ url: 'https://evil.com/font.css' }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
