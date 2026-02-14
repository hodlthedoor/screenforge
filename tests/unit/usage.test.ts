import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import type { FastifyInstance } from 'fastify';

describe('usage routes', () => {
  let app: FastifyInstance;
  let rawApiKey: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.REQUIRE_AUTH = 'true';
    app = await buildServer({ skipBrowserInit: true });

    const result = await createApiKey('usage-test', 'free');
    rawApiKey = result.rawKey;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns usage stats for authenticated key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/usage',
      headers: { 'x-api-key': rawApiKey },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('apiKeyId');
    expect(body).toHaveProperty('tier', 'free');
    expect(body.usage).toHaveProperty('today');
    expect(body.usage).toHaveProperty('thisMonth');
    expect(body.usage).toHaveProperty('monthlyQuota');
    expect(body.usage).toHaveProperty('remaining');
    expect(body.rateLimit).toHaveProperty('requestsPerMinute');
  });

  it('returns error when auth is required but no key provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/usage',
    });
    // Without API key, authMiddleware returns 401
    expect(res.statusCode).toBe(401);
  });
});
