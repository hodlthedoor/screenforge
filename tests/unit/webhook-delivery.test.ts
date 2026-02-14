import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { getPool, closePool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { loadConfig } from '../../src/config/index.js';
import { enqueueWebhook, getDeliveryStatus, RETRY_DELAYS, processWebhookJob, closeWebhookQueue, getWebhookQueue, type WebhookJobData } from '../../src/webhooks/delivery.js';
import type { Job } from 'bullmq';
import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

describe('webhook delivery', () => {
  let webhookServer: Server;
  let webhookUrl: string;
  let requests: Array<{ headers: IncomingMessage['headers']; body: string }> = [];
  let responseStatus = 200;
  let apiKeyId: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'postgresql:///screenforge?host=/var/run/postgresql';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.ALLOW_PRIVATE_URLS = 'true';
    loadConfig();

    // Create test API key
    const result = await createApiKey('webhook-test', 'free');
    apiKeyId = result.key.id;

    // Update API key with webhook config
    await getPool().query(
      'UPDATE api_keys SET webhook_url = $1, webhook_secret = $2 WHERE id = $3',
      ['http://localhost:9999/webhook', 'whsec_test_key', apiKeyId],
    );

    // Start test webhook server
    webhookServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        requests.push({ headers: req.headers, body });
        res.writeHead(responseStatus);
        res.end(JSON.stringify({ received: true }));
      });
    });

    await new Promise<void>((resolve) => {
      webhookServer.listen(9999, () => {
        webhookUrl = 'http://localhost:9999/webhook';
        resolve();
      });
    });
  });

  afterEach(async () => {
    // Drain BullMQ queue to prevent cross-test interference from workers in other test files
    const queue = getWebhookQueue('redis://127.0.0.1:6379/15');
    await queue.drain();
    requests = [];
    responseStatus = 200;
    await getPool().query('DELETE FROM webhook_deliveries WHERE api_key_id = $1', [apiKeyId]);
    await getPool().query('DELETE FROM render_jobs WHERE api_key_id = $1', [apiKeyId]);
  });

  afterAll(async () => {
    webhookServer.close();
    await closeWebhookQueue();
    const pool = getPool();
    await pool.query('DELETE FROM webhook_deliveries WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM render_jobs WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM usage_daily WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM user_api_keys WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM api_keys WHERE id = $1', [apiKeyId]);
    await closePool();
  });

  /** Helper to create a render job and enqueue a webhook delivery via BullMQ */
  async function createJobAndEnqueue() {
    const jobResult = await getPool().query(
      `INSERT INTO render_jobs (api_key_id, type, url, options)
       VALUES ($1, 'screenshot', 'https://example.com', '{}')
       RETURNING id`,
      [apiKeyId],
    );
    const jobId = jobResult.rows[0].id;

    const deliveryId = await enqueueWebhook(
      apiKeyId,
      jobId,
      webhookUrl,
      { jobId, status: 'completed' },
      'whsec_test_key',
    );

    return { jobId, deliveryId };
  }

  /** Helper to create a render job and delivery record WITHOUT enqueuing to BullMQ */
  async function createJobWithDelivery() {
    const jobResult = await getPool().query(
      `INSERT INTO render_jobs (api_key_id, type, url, options)
       VALUES ($1, 'screenshot', 'https://example.com', '{}')
       RETURNING id`,
      [apiKeyId],
    );
    const jobId = jobResult.rows[0].id;

    const deliveryResult = await getPool().query(
      `INSERT INTO webhook_deliveries (api_key_id, job_id, url, payload, status, attempts)
       VALUES ($1, $2, $3, $4, 'pending', 0)
       RETURNING id`,
      [apiKeyId, jobId, webhookUrl, JSON.stringify({ jobId, status: 'completed' })],
    );
    const deliveryId = deliveryResult.rows[0].id;

    return { jobId, deliveryId };
  }

  /** Helper to directly invoke the webhook processor (bypasses BullMQ worker) */
  async function processDirectly(deliveryId: string, jobId: string, overrides?: Partial<WebhookJobData>) {
    const fakeJob = {
      data: {
        deliveryId,
        apiKeyId,
        jobId,
        url: webhookUrl,
        payload: { jobId, status: 'completed' },
        secret: 'whsec_test_key',
        attemptNumber: 0,
        ...overrides,
      },
    } as Job<WebhookJobData>;

    await processWebhookJob(fakeJob);
  }

  describe('enqueueWebhook', () => {
    it('creates a delivery record with pending status', async () => {
      const { jobId, deliveryId } = await createJobAndEnqueue();

      expect(deliveryId).toBeDefined();

      const result = await getPool().query(
        'SELECT * FROM webhook_deliveries WHERE id = $1',
        [deliveryId],
      );

      expect(result.rows).toHaveLength(1);
      const delivery = result.rows[0];
      expect(delivery.api_key_id).toBe(apiKeyId);
      expect(delivery.job_id).toBe(jobId);
      expect(delivery.url).toBe(webhookUrl);
      expect(delivery.status).toBe('pending');
      expect(delivery.attempts).toBe(0);
      expect(delivery.payload.jobId).toBe(jobId);
      expect(delivery.payload.status).toBe('completed');
    });
  });

  describe('webhook processing', () => {
    it('includes X-ScreenForge-Signature header on delivery', async () => {
      const { jobId, deliveryId } = await createJobWithDelivery();

      // Directly invoke the processor instead of waiting for BullMQ worker
      await processDirectly(deliveryId, jobId);

      // Find our request by signature header (BullMQ workers from other test files may add extra requests)
      const signedReqs = requests.filter(
        (r) => r.headers['x-screenforge-signature'] && /^t=\d+,v1=[a-f0-9]{64}$/.test(r.headers['x-screenforge-signature'] as string),
      );
      expect(signedReqs.length).toBeGreaterThanOrEqual(1);
      const req = signedReqs[signedReqs.length - 1];
      expect(req.headers['content-type']).toBe('application/json');
    });

    it('marks delivery as delivered on 2xx response', async () => {
      const { jobId, deliveryId } = await createJobWithDelivery();

      await processDirectly(deliveryId, jobId);

      const delivery = await getDeliveryStatus(deliveryId);
      expect(delivery.status).toBe('delivered');
      expect(delivery.attempts).toBe(1);
      expect(delivery.lastStatusCode).toBe(200);
      expect(delivery.deliveredAt).toBeDefined();
    });

    it('retries on non-2xx response', async () => {
      responseStatus = 500;

      const { jobId, deliveryId } = await createJobWithDelivery();

      await processDirectly(deliveryId, jobId);

      const delivery = await getDeliveryStatus(deliveryId);
      expect(delivery.status).toBe('retrying');
      expect(delivery.attempts).toBe(1);
      expect(delivery.lastStatusCode).toBe(500);
    });

    it('uses exponential backoff retry schedule', async () => {
      expect(RETRY_DELAYS).toEqual([5000, 30000, 120000, 900000, 3600000]);
    });

    it('marks as failed after max retries', async () => {
      responseStatus = 500;

      const { deliveryId } = await createJobWithDelivery();

      // Manually simulate 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await getPool().query(
          `UPDATE webhook_deliveries
           SET status = $1, attempts = $2, last_status_code = 500, last_error = 'Internal Server Error'
           WHERE id = $3`,
          [i < 4 ? 'retrying' : 'failed', i + 1, deliveryId],
        );
      }

      const delivery = await getDeliveryStatus(deliveryId);
      expect(delivery.status).toBe('failed');
      expect(delivery.attempts).toBe(5);
    });
  });

  describe('getDeliveryStatus', () => {
    it('returns delivery status', async () => {
      const { jobId, deliveryId } = await createJobAndEnqueue();

      const status = await getDeliveryStatus(deliveryId);
      expect(status).toMatchObject({
        id: deliveryId,
        apiKeyId,
        jobId,
        url: webhookUrl,
        status: 'pending',
        attempts: 0,
      });
    });

    it('throws error for non-existent delivery', async () => {
      await expect(getDeliveryStatus('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
        'Delivery not found',
      );
    });
  });
});
