import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { getPool } from '../db/index.js';
import { enqueueWebhook } from '../webhooks/delivery.js';
import { getWebhookConfig } from '../db/api-keys.js';
import { incrementRenderCounter, observeRenderDuration } from '../metrics/index.js';
import { getConfig } from '../config/index.js';
import { getFormatFromContentType } from '../utils/format.js';

export interface RenderJobData {
  jobId: string;
  apiKeyId: string | null;
  type: 'screenshot' | 'pdf' | 'og' | 'gif';
  url?: string;
  options: Record<string, unknown>;
  callbackUrl?: string;
  batchId?: string;
}

export interface RenderJobResult {
  resultPath: string;
  contentType: string;
  durationMs: number;
  thumbnailPath?: string;
  metadata?: {
    title: string;
    finalUrl: string;
    statusCode: number;
    width?: number;
    height?: number;
    // Enhanced metadata fields (only populated when extract_metadata: true)
    description?: string;
    canonical?: string | null;
    language?: string | null;
    locale?: string | null;
    favicon?: string | null;
    og?: {
      title?: string;
      description?: string;
      image?: string;
      type?: string;
      url?: string;
    };
    twitter?: {
      card?: string;
      title?: string;
      description?: string;
      image?: string;
      site?: string;
    };
  };
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

  const config = getConfig();
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  worker = new Worker('screenforge-renders', processor, {
    connection,
    concurrency: config.WORKER_CONCURRENCY,
  });

  worker.on('completed', async (job) => {
    if (!job.data.jobId) return;
    const result = job.returnvalue;
    const pool = getPool();

    // Store enhanced metadata as JSON if present
    const hasEnhancedMetadata = result.metadata && (
      result.metadata.description || result.metadata.og || result.metadata.twitter ||
      result.metadata.canonical || result.metadata.language || result.metadata.locale || result.metadata.favicon
    );

    await pool.query(
      `UPDATE render_jobs SET status = 'completed', result_path = $1, content_type = $2,
       duration_ms = $3, metadata_title = $4, metadata_final_url = $5, metadata_status_code = $6,
       metadata_width = $7, metadata_height = $8, metadata_enhanced = $9, thumbnail_path = $10,
       completed_at = NOW() WHERE id = $11`,
      [
        result.resultPath,
        result.contentType,
        result.durationMs,
        result.metadata?.title ?? null,
        result.metadata?.finalUrl ?? null,
        result.metadata?.statusCode ?? null,
        result.metadata?.width ?? null,
        result.metadata?.height ?? null,
        hasEnhancedMetadata ? JSON.stringify(result.metadata) : null,
        result.thumbnailPath ?? null,
        job.data.jobId,
      ],
    );

    // Record metrics (always record, even if cache hit, since this was a job completion)
    const format = getFormatFromContentType(result.contentType);
    incrementRenderCounter(job.data.type, format, 'completed', false);
    observeRenderDuration(job.data.type, format, result.durationMs / 1000);

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

    // Record metrics for failed jobs
    // For failed jobs we don't have result.contentType, so best effort based on type only
    const format = job.data.type === 'pdf' ? 'pdf' : 'png';
    incrementRenderCounter(job.data.type, format, 'failed', false);

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
