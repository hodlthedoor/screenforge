import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('smoke tests', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    app = await buildServer({ skipBrowserInit: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.addresses()[0];
    baseUrl = `http://${addr.address}:${addr.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok with timestamp', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });

  it('GET /v1/health returns detailed status', async () => {
    const res = await fetch(`${baseUrl}/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('1.0.0');
    expect(body.uptime).toBeTypeOf('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.browserPool).toMatchObject({
      poolSize: expect.any(Number),
      activeBrowsers: expect.any(Number),
      totalRenders: expect.any(Number),
    });
    expect(body.queue).toMatchObject({
      waiting: expect.any(Number),
      active: expect.any(Number),
    });
    expect(body.timestamp).toBeDefined();
  });

  it('GET /docs returns swagger UI', async () => {
    const res = await fetch(`${baseUrl}/docs`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('GET /nonexistent returns 404', async () => {
    const res = await fetch(`${baseUrl}/v1/nonexistent-endpoint`);
    expect(res.status).toBe(404);
  });

  it('GET /metrics returns prometheus format', async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('screenforge_');
  });
});
