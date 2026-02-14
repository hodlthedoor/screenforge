import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { getPool } from '../db/index.js';
import { getConfig } from '../config/index.js';
import { isPrivateUrl } from '../renderer/schemas.js';
import { generateWebhookSignature } from './signer.js';

export const RETRY_DELAYS = [5000, 30000, 120000, 900000, 3600000]; // 5s, 30s, 2min, 15min, 1hr
const MAX_RETRIES = 5;

export interface WebhookJobData {
  deliveryId: string;
  apiKeyId: string;
  jobId: string;
  url: string;
  payload: Record<string, unknown>;
  secret: string;
  attemptNumber: number;
}

export interface DeliveryStatus {
  id: string;
  apiKeyId: string;
  jobId: string;
  url: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'retrying' | 'delivered' | 'failed';
  attempts: number;
  lastStatusCode?: number;
  lastError?: string;
  createdAt: Date;
  deliveredAt?: Date;
}

let queue: Queue<WebhookJobData> | undefined;
let worker: Worker<WebhookJobData> | undefined;

export function getWebhookQueue(redisUrl: string): Queue<WebhookJobData> {
  if (!queue) {
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    queue = new Queue('screenforge-webhooks', { connection });
  }
  return queue;
}

export function createWebhookWorker(redisUrl: string): Worker<WebhookJobData> {
  if (worker) return worker;

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  worker = new Worker('screenforge-webhooks', processWebhookJob, {
    connection,
    concurrency: 3,
  });

  return worker;
}

async function processWebhookJob(job: Job<WebhookJobData>): Promise<void> {
  const { deliveryId, url, payload, secret, attemptNumber } = job.data;
  const config = getConfig();

  // SSRF check
  if (!config.ALLOW_PRIVATE_URLS && isPrivateUrl(url)) {
    await updateDeliveryStatus(deliveryId, 'failed', attemptNumber + 1, 0, 'Blocked: private URL');
    return;
  }

  const payloadString = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateWebhookSignature(payloadString, secret, timestamp);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ScreenForge-Signature': signature,
      },
      body: payloadString,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const isSuccess = response.status >= 200 && response.status < 300;

    if (isSuccess) {
      // Success - mark as delivered
      await updateDeliveryStatus(
        deliveryId,
        'delivered',
        attemptNumber + 1,
        response.status,
        undefined,
        new Date(),
      );
    } else {
      // Non-2xx response - retry or fail
      const errorText = await response.text().catch(() => 'Unknown error');
      const newAttempt = attemptNumber + 1;

      if (newAttempt < MAX_RETRIES) {
        // Schedule retry
        await updateDeliveryStatus(
          deliveryId,
          'retrying',
          newAttempt,
          response.status,
          errorText.slice(0, 500),
        );
        await scheduleRetry(job.data, newAttempt);
      } else {
        // Max retries exhausted
        await updateDeliveryStatus(
          deliveryId,
          'failed',
          newAttempt,
          response.status,
          errorText.slice(0, 500),
        );
      }
    }
  } catch (error) {
    clearTimeout(timeout);

    // Network/timeout error - retry or fail
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const newAttempt = attemptNumber + 1;

    if (newAttempt < MAX_RETRIES) {
      await updateDeliveryStatus(
        deliveryId,
        'retrying',
        newAttempt,
        undefined,
        errorMessage.slice(0, 500),
      );
      await scheduleRetry(job.data, newAttempt);
    } else {
      await updateDeliveryStatus(
        deliveryId,
        'failed',
        newAttempt,
        undefined,
        errorMessage.slice(0, 500),
      );
    }
  }
}

async function scheduleRetry(jobData: WebhookJobData, attemptNumber: number): Promise<void> {
  const config = getConfig();
  const delay = RETRY_DELAYS[attemptNumber - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
  const webhookQueue = getWebhookQueue(config.REDIS_URL);

  await webhookQueue.add(
    'webhook-delivery',
    { ...jobData, attemptNumber },
    { delay },
  );
}

async function updateDeliveryStatus(
  deliveryId: string,
  status: 'pending' | 'retrying' | 'delivered' | 'failed',
  attempts: number,
  lastStatusCode?: number,
  lastError?: string,
  deliveredAt?: Date,
): Promise<void> {
  const pool = getPool();

  if (deliveredAt) {
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = $1, attempts = $2, last_status_code = $3, last_error = $4, delivered_at = $5
       WHERE id = $6`,
      [status, attempts, lastStatusCode, lastError, deliveredAt, deliveryId],
    );
  } else {
    await pool.query(
      `UPDATE webhook_deliveries
       SET status = $1, attempts = $2, last_status_code = $3, last_error = $4
       WHERE id = $5`,
      [status, attempts, lastStatusCode, lastError, deliveryId],
    );
  }
}

export async function enqueueWebhook(
  apiKeyId: string,
  jobId: string,
  url: string,
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const pool = getPool();
  const config = getConfig();

  // Create delivery record
  const result = await pool.query(
    `INSERT INTO webhook_deliveries (api_key_id, job_id, url, payload, status, attempts)
     VALUES ($1, $2, $3, $4, 'pending', 0)
     RETURNING id`,
    [apiKeyId, jobId, url, JSON.stringify(payload)],
  );

  const deliveryId = result.rows[0].id;

  // Enqueue for processing
  const webhookQueue = getWebhookQueue(config.REDIS_URL);
  await webhookQueue.add('webhook-delivery', {
    deliveryId,
    apiKeyId,
    jobId,
    url,
    payload,
    secret,
    attemptNumber: 0,
  });

  return deliveryId;
}

export async function getDeliveryStatus(deliveryId: string): Promise<DeliveryStatus> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, api_key_id, job_id, url, payload, status, attempts,
            last_status_code, last_error, created_at, delivered_at
     FROM webhook_deliveries WHERE id = $1`,
    [deliveryId],
  );

  if (result.rows.length === 0) {
    throw new Error('Delivery not found');
  }

  const row = result.rows[0];
  return {
    id: row.id,
    apiKeyId: row.api_key_id,
    jobId: row.job_id,
    url: row.url,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

export interface ListDeliveriesOptions {
  apiKeyId: string;
  page?: number;
  limit?: number;
}

export interface ListDeliveriesResult {
  deliveries: DeliveryStatus[];
  total: number;
  page: number;
  limit: number;
}

export async function listDeliveries(options: ListDeliveriesOptions): Promise<ListDeliveriesResult> {
  const { apiKeyId, page = 1, limit = 50 } = options;
  const pool = getPool();

  // Validate pagination params
  const validatedPage = Math.max(1, page);
  const validatedLimit = Math.min(Math.max(1, limit), 100);
  const offset = (validatedPage - 1) * validatedLimit;

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM webhook_deliveries WHERE api_key_id = $1`,
    [apiKeyId],
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Get paginated deliveries
  const result = await pool.query(
    `SELECT id, api_key_id, job_id, url, payload, status, attempts,
            last_status_code, last_error, created_at, delivered_at
     FROM webhook_deliveries
     WHERE api_key_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [apiKeyId, validatedLimit, offset],
  );

  const deliveries = result.rows.map((row: {
    id: string;
    api_key_id: string;
    job_id: string;
    url: string;
    payload: Record<string, unknown>;
    status: DeliveryStatus['status'];
    attempts: number;
    last_status_code: number | null;
    last_error: string | null;
    created_at: Date;
    delivered_at: Date | null;
  }) => ({
    id: row.id,
    apiKeyId: row.api_key_id,
    jobId: row.job_id,
    url: row.url,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    lastStatusCode: row.last_status_code ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at ?? undefined,
  }));

  return {
    deliveries,
    total,
    page: validatedPage,
    limit: validatedLimit,
  };
}

export async function getDeliveryById(deliveryId: string, apiKeyId: string): Promise<DeliveryStatus | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, api_key_id, job_id, url, payload, status, attempts,
            last_status_code, last_error, created_at, delivered_at
     FROM webhook_deliveries
     WHERE id = $1 AND api_key_id = $2`,
    [deliveryId, apiKeyId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    apiKeyId: row.api_key_id,
    jobId: row.job_id,
    url: row.url,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

export async function closeWebhookQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
