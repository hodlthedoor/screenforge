import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { APP_VERSION } from '../../src/utils/version.js';
import type { FastifyInstance } from 'fastify';

describe('server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    app = await buildServer({ skipBrowserInit: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('builds without error', () => {
    expect(app).toBeDefined();
  });

  it('responds to /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });

  it('responds to /v1/health with pool stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.version).toBe(APP_VERSION);
    expect(body.uptime).toBeTypeOf('number');
    expect(body.browserPool).toBeDefined();
    expect(body.browserPool.poolSize).toBe(3);
    expect(body.browserPool.activeBrowsers).toBe(0);
    expect(body.browserPool.totalRenders).toBe(0);
  });

  it('starts and stops cleanly', async () => {
    const server = await buildServer({ skipBrowserInit: true });
    await server.listen({ port: 0 });
    const address = server.addresses();
    expect(address.length).toBeGreaterThan(0);
    await server.close();
  });
});
