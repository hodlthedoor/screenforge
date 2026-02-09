import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('server', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    app = await buildServer();
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

  it('starts and stops cleanly', async () => {
    const server = await buildServer();
    await server.listen({ port: 0 });
    const address = server.addresses();
    expect(address.length).toBeGreaterThan(0);
    await server.close();
  });
});
