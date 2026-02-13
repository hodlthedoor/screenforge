import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { getPool } from '../db/index.js';
import { enqueueWebhook } from '../webhooks/delivery.js';
import { getWebhookConfig } from '../db/api-keys.js';

export interface RenderJobData {
  jobId: string;
  apiKeyId: string | null;
  type: 'screenshot' | 'pdf' | 'og';
  url?: string;
  options: Record<string, unknown>;
  callbackUrl?: string;
  batchId?: string;
}

export interface RenderJobResult {
  resultPath: string;
  contentType: string;
  durationMs: number;
}

let queue: Queue<RenderJobData, RenderJobResult> | undefined;
let worker: Worker<RenderJobData, RenderJobResult> | undefined;

export function getQueue(redisUrl: string): Queue<RenderJobData, RenderJobResult> {
  if (!queue) {
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    queue = new Queue('screenforge-renders', { connection });
  }
  return queue;
}

export function createWorker(
  redisUrl: string,
  processor: (job: Job<RenderJobData, RenderJobResult>) => Promise<RenderJobResult>,
): Worker<RenderJobData, RenderJobResult> {
  if (worker) return worker;

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  worker = new Worker('screenforge-renders', processor, {
    connection,
    concurrency: 3,
  });

  worker.on('completed', async (job) => {
    if (!job.data.jobId) return;
    const result = job.returnvalue;
    const pool = getPool();

    await pool.query(
      `UPDATE render_jobs SET status = 'completed', result_path = $1, content_type = $2,
       duration_ms = $3, completed_at = NOW() WHERE id = $4`,
      [result.resultPath, result.contentType, result.durationMs, job.data.jobId],
    );

    // Update batch progress
    if (job.data.batchId) {
      await pool.query(
        `UPDATE batch_jobs SET completed = completed + 1 WHERE id = $1`,
        [job.data.batchId],
      );
      await checkBatchCompletion(job.data.batchId);
    }

    // Fire webhook if configured
    if (job.data.callbackUrl && job.data.apiKeyId) {
      sendWebhook(job.data.apiKeyId, job.data.jobId, job.data.callbackUrl, 'completed', result).catch(() => {});
    }
  });

  worker.on('failed', async (job, error) => {
    if (!job?.data.jobId) return;
    const pool = getPool();

    await pool.query(
      `UPDATE render_jobs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2`,
      [error.message, job.data.jobId],
    );

    if (job.data.batchId) {
      await pool.query(
        `UPDATE batch_jobs SET failed = failed + 1 WHERE id = $1`,
        [job.data.batchId],
      );
      await checkBatchCompletion(job.data.batchId);
    }

    if (job.data.callbackUrl && job.data.apiKeyId) {
      sendWebhook(job.data.apiKeyId, job.data.jobId, job.data.callbackUrl, 'failed', { error: error.message }).catch(() => {});
    }
  });

  return worker;
}

async function checkBatchCompletion(batchId: string): Promise<void> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT total, completed, failed FROM batch_jobs WHERE id = $1`,
    [batchId],
  );
  if (result.rows.length === 0) return;
  const { total, completed, failed } = result.rows[0];
  if (completed + failed >= total) {
    await pool.query(
      `UPDATE batch_jobs SET status = $1, completed_at = NOW() WHERE id = $2`,
      [failed > 0 && completed === 0 ? 'failed' : 'completed', batchId],
    );
  }
}

async function sendWebhook(
  apiKeyId: string,
  jobId: string,
  callbackUrl: string,
  status: string,
  data: unknown,
): Promise<void> {
  // Get webhook config for the API key
  const webhookConfig = await getWebhookConfig(apiKeyId);

  // Use callback URL from job data (takes precedence) or configured webhook URL
  const targetUrl = callbackUrl;

  // Skip if no secret configured (cannot sign webhooks)
  if (!webhookConfig.secret) {
    return;
  }

  const payload = {
    jobId,
    status,
    data,
    timestamp: new Date().toISOString(),
  };

  // Enqueue webhook with signing and retry logic
  await enqueueWebhook(apiKeyId, jobId, targetUrl, payload, webhookConfig.secret);
}

export async function getQueueMetrics(redisUrl: string): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}> {
  const q = getQueue(redisUrl);
  const [waiting, active, completed, failed] = await Promise.all([
    q.getWaitingCount(),
    q.getActiveCount(),
    q.getCompletedCount(),
    q.getFailedCount(),
  ]);
  return { waiting, active, completed, failed };
}

export async function closeQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = undefined;
  }
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}
