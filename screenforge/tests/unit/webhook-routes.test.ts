import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool, closePool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { enqueueWebhook, createWebhookWorker, closeWebhookQueue } from '../../src/webhooks/delivery.js';
import { loadConfig } from '../../src/config/index.js';
import type { FastifyInstance } from 'fastify';

describe('webhook routes', () => {
  let app: FastifyInstance;
  let apiKeyId: string;
  let rawApiKey: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql:///screenforge?host=/var/run/postgresql';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.ALLOW_PRIVATE_URLS = 'true';
    loadConfig();

    app = await buildServer({ skipBrowserInit: true });

    // Start webhook worker
    createWebhookWorker('redis://127.0.0.1:6379/15');

    // Create test API key with webhook config
    const result = await createApiKey('webhook-routes-test', 'free');
    apiKeyId = result.key.id;
    rawApiKey = result.rawKey;

    await getPool().query(
      'UPDATE api_keys SET webhook_url = $1, webhook_secret = $2 WHERE id = $3',
      ['http://localhost:9999/webhook', 'whsec_test_secret', apiKeyId],
    );
  });

  afterEach(async () => {
    await getPool().query('DELETE FROM webhook_deliveries');
    await getPool().query('DELETE FROM render_jobs');
  });

  afterAll(async () => {
    await closeWebhookQueue();
    const pool = getPool();
    await pool.query('DELETE FROM webhook_deliveries');
    await pool.query('DELETE FROM render_jobs');
    await pool.query('DELETE FROM usage_daily');
    await pool.query('DELETE FROM user_api_keys');
    await pool.query('DELETE FROM api_keys');
    await closePool();
    await app.close();
  });

  describe('GET /v1/webhooks/deliveries', () => {
    it('returns empty list when no deliveries exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/webhooks/deliveries',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.deliveries).toEqual([]);
      expect(body.pagination).toMatchObject({
        page: 1,
        limit: 50,
        total: 0,
      });
    });

    it('returns deliveries for authenticated API key only', async () => {
      // Create a render job
      const jobResult = await getPool().query(
        `INSERT INTO render_jobs (api_key_id, type, url, options)
         VALUES ($1, 'screenshot', 'https://example.com', '{}')
         RETURNING id`,
        [apiKeyId],
      );
      const jobId = jobResult.rows[0].id;

      // Create a delivery
      await enqueueWebhook(
        apiKeyId,
        jobId,
        'http://localhost:9999/test',
        { jobId, status: 'completed' },
        'whsec_test_secret',
      );

      const response = await app.inject({
        method: 'GET',
        url: '/v1/webhooks/deliveries',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.deliveries).toHaveLength(1);
      expect(body.deliveries[0]).toMatchObject({
        jobId,
        url: 'http://localhost:9999/test',
        status: 'pending',
        attempts: 0,
      });
      expect(body.pagination.total).toBe(1);
    });

    it('supports pagination', async () => {
      // Create multiple deliveries
      for (let i = 0; i < 3; i++) {
        const jobResult = await getPool().query(
          `INSERT INTO render_jobs (api_key_id, type, url, options)
           VALUES ($1, 'screenshot', 'https://example.com', '{}')
           RETURNING id`,
          [apiKeyId],
        );
        const jobId = jobResult.rows[0].id;

        await enqueueWebhook(
          apiKeyId,
          jobId,
          'http://localhost:9999/test',
          { jobId, status: 'completed' },
          'whsec_test_secret',
        );
      }

      // Page 1, limit 2
      const response = await app.inject({
        method: 'GET',
        url: '/v1/webhooks/deliveries?page=1&limit=2',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.deliveries).toHaveLength(2);
      expect(body.pagination).toMatchObject({
        page: 1,
        limit: 2,
        total: 3,
      });
    });

    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/webhooks/deliveries',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /v1/webhooks/deliveries/:id', () => {
    it('returns delivery details including payload', async () => {
      const jobResult = await getPool().query(
        `INSERT INTO render_jobs (api_key_id, type, url, options)
         VALUES ($1, 'screenshot', 'https://example.com', '{}')
         RETURNING id`,
        [apiKeyId],
      );
      const jobId = jobResult.rows[0].id;

      const payload = { jobId, status: 'completed', result: { url: 'https://example.com/result.png' } };
      const deliveryId = await enqueueWebhook(
        apiKeyId,
        jobId,
        'http://localhost:9999/test',
        payload,
        'whsec_test_secret',
      );

      const response = await app.inject({
        method: 'GET',
        url: `/v1/webhooks/deliveries/${deliveryId}`,
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        id: deliveryId,
        jobId,
        url: 'http://localhost:9999/test',
        status: 'pending',
        attempts: 0,
        payload,
      });
    });

    it('returns 404 for non-existent delivery', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/webhooks/deliveries/00000000-0000-0000-0000-000000000000',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 for delivery owned by different API key', async () => {
      // Create another API key
      const otherKey = await createApiKey('other-key', 'free');

      // Create delivery for the other key
      const jobResult = await getPool().query(
        `INSERT INTO render_jobs (api_key_id, type, url, options)
         VALUES ($1, 'screenshot', 'https://example.com', '{}')
         RETURNING id`,
        [otherKey.key.id],
      );
      const jobId = jobResult.rows[0].id;

      await getPool().query(
        'UPDATE api_keys SET webhook_url = $1, webhook_secret = $2 WHERE id = $3',
        ['http://localhost:9999/webhook', 'whsec_other_secret', otherKey.key.id],
      );

      const deliveryId = await enqueueWebhook(
        otherKey.key.id,
        jobId,
        'http://localhost:9999/test',
        { jobId, status: 'completed' },
        'whsec_other_secret',
      );

      // Try to access with the first API key
      const response = await app.inject({
        method: 'GET',
        url: `/v1/webhooks/deliveries/${deliveryId}`,
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(404);

      // Cleanup
      await getPool().query('DELETE FROM api_keys WHERE id = $1', [otherKey.key.id]);
    });

    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/webhooks/deliveries/00000000-0000-0000-0000-000000000000',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /v1/webhooks/test', () => {
    it('enqueues a test webhook to configured URL', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/test',
        headers: { 'x-api-key': rawApiKey },
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toMatchObject({
        message: 'Test webhook enqueued',
        url: 'http://localhost:9999/webhook',
      });
      expect(body.deliveryId).toBeDefined();

      // Verify delivery was created
      const deliveries = await getPool().query(
        'SELECT * FROM webhook_deliveries WHERE id = $1',
        [body.deliveryId],
      );
      expect(deliveries.rows).toHaveLength(1);
      expect(deliveries.rows[0].api_key_id).toBe(apiKeyId);
    });

    it('accepts custom test payload', async () => {
      const customPayload = { custom: 'data', test: true };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/test',
        headers: { 'x-api-key': rawApiKey },
        payload: { payload: customPayload },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);

      // Verify payload was stored
      const deliveries = await getPool().query(
        'SELECT payload FROM webhook_deliveries WHERE id = $1',
        [body.deliveryId],
      );
      expect(deliveries.rows[0].payload).toMatchObject(customPayload);
    });

    it('returns 400 when webhook URL not configured', async () => {
      // Create a key without webhook config
      const noWebhookKey = await createApiKey('no-webhook', 'free');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/test',
        headers: { 'x-api-key': noWebhookKey.rawKey },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Webhook URL and secret must be configured');

      // Cleanup
      await getPool().query('DELETE FROM api_keys WHERE id = $1', [noWebhookKey.key.id]);
    });

    it('returns 400 when webhook secret not configured', async () => {
      // Create a key with URL but no secret
      const noSecretKey = await createApiKey('no-secret', 'free');
      await getPool().query(
        'UPDATE api_keys SET webhook_url = $1 WHERE id = $2',
        ['http://localhost:9999/webhook', noSecretKey.key.id],
      );

      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/test',
        headers: { 'x-api-key': noSecretKey.rawKey },
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      // Cleanup
      await getPool().query('DELETE FROM api_keys WHERE id = $1', [noSecretKey.key.id]);
    });

    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/test',
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
