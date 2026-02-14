import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('playground page', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    app = await buildServer({ skipBrowserInit: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /playground returns 200 with HTML', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('contains API key input field', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground' });
    expect(res.body).toContain('id="api-key"');
    expect(res.body).toContain('x-api-key');
  });

  it('contains URL input field', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground' });
    expect(res.body).toContain('id="target-url"');
  });

  it('contains format selector with screenshot/pdf/og options', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground' });
    const body = res.body;
    expect(body).toContain('id="format"');
    expect(body).toContain('value="screenshot"');
    expect(body).toContain('value="pdf"');
    expect(body).toContain('value="og"');
  });

  it('contains viewport width and height inputs', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground' });
    expect(res.body).toContain('id="viewport-width"');
    expect(res.body).toContain('id="viewport-height"');
  });

  it('contains dark mode and full page toggles', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground' });
    expect(res.body).toContain('id="dark-mode"');
    expect(res.body).toContain('id="full-page"');
  });

  it('contains custom CSS textarea', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground' });
    expect(res.body).toContain('id="custom-css"');
  });

  it('contains code examples for curl, JavaScript, Python, and Go', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground' });
    const body = res.body;
    expect(body).toContain('id="code-curl"');
    expect(body).toContain('id="code-javascript"');
    expect(body).toContain('id="code-python"');
    expect(body).toContain('id="code-go"');
  });

  it('code examples contain correct endpoint URLs', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground' });
    const body = res.body;
    expect(body).toContain('/v1/screenshot');
    expect(body).toContain('/v1/pdf');
    expect(body).toContain('/v1/og');
  });

  it('contains result display area', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground' });
    expect(res.body).toContain('id="result-area"');
  });

  it('has cache-control header', async () => {
    const res = await app.inject({ method: 'GET', url: '/playground' });
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });
});
