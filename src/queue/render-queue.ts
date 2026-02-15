import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { getPool } from '../db/index.js';
import { enqueueWebhook } from '../webhooks/delivery.js';
import { getWebhookConfig } from '../db/api-keys.js';
import { incrementRenderCounter, observeRenderDuration, incrementRetryCounter, incrementPermanentFailure } from '../metrics/index.js';
import { getConfig } from '../config/index.js';
import { getFormatFromContentType } from '../utils/format.js';
import { clearDedup } from './dedup.js';
import { classifyError, shouldRetry, classifyPermanentReason, type RetryDecision, ErrorCategory } from './retry-policy.js';

const TIER_PRIORITY: Record<string, number> = {
  business: 10,
  pro: 20,
  starter: 30,
  free: 40,
};

export function tierToPriority(tier: string): number {
  return TIER_PRIORITY[tier] ?? 40;
}

export interface RenderJobData {
  jobId: string;
  apiKeyId: string | null;
  type: 'screenshot' | 'pdf' | 'og' | 'gif' | 'diff';
  url?: string;
  options: Record<string, unknown>;
  callbackUrl?: string;
  batchId?: string;
  dedupFingerprint?: string;
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
let dedupRedis: Redis | undefined;

/** Shared Redis connection for dedup operations (avoids creating new connections per request). */
export function getDedupRedis(redisUrl: string): Redis {
  if (!dedupRedis) {
    dedupRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }
  return dedupRedis;
}

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

    // Dedup key is NOT cleared on success — it expires naturally via TTL.
    // This ensures concurrent requests within the dedup window still resolve
    // to the same job ID instead of creating duplicates.

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

    // Classify the error and decide whether to retry
    const category = classifyError(error);

    // Look up tier for retry limit determination
    let tier = 'free';
    if (job.data.apiKeyId) {
      try {
        const tierResult = await pool.query(
          'SELECT tier FROM api_keys WHERE id = $1',
          [job.data.apiKeyId],
        );
        if (tierResult.rows.length > 0) {
          tier = tierResult.rows[0].tier;
        }
      } catch {
        // If tier lookup fails, use free tier defaults
      }
    }

    // Get current retry count from the DB
    const retryRow = await pool.query(
      'SELECT retry_count FROM render_jobs WHERE id = $1',
      [job.data.jobId],
    );
    const currentRetryCount = retryRow.rows[0]?.retry_count ?? 0;

    const decision: RetryDecision = shouldRetry(category, currentRetryCount, tier);

    // Build retry history entry
    const historyEntry = {
      attempt: currentRetryCount + 1,
      category,
      error: error.message,
      timestamp: new Date().toISOString(),
      retried: decision.retry,
    };

    if (decision.retry) {
      // Update retry tracking in DB (keep status as 'pending' for retry)
      await pool.query(
        `UPDATE render_jobs SET
          retry_count = retry_count + 1,
          last_error_category = $1,
          retry_history = retry_history || $2::jsonb,
          status = 'pending',
          error = $3
        WHERE id = $4`,
        [category, JSON.stringify(historyEntry), error.message, job.data.jobId],
      );

      // Re-enqueue with delay
      const q = getQueue(config.REDIS_URL);
      await q.add(`render-${job.data.jobId}`, job.data, {
        delay: decision.delayMs,
        priority: job.opts.priority,
      });

      incrementRetryCounter(category, tier);
    } else {
      // Final failure — no more retries
      await pool.query(
        `UPDATE render_jobs SET
          status = 'failed',
          error = $1,
          last_error_category = $2,
          retry_history = retry_history || $3::jsonb,
          completed_at = NOW()
        WHERE id = $4`,
        [error.message, category, JSON.stringify(historyEntry), job.data.jobId],
      );

      // Record metrics for failed jobs
      const format = job.data.type === 'pdf' ? 'pdf' : 'png';
      incrementRenderCounter(job.data.type, format, 'failed', false);

      if (category === ErrorCategory.PERMANENT) {
        incrementPermanentFailure(classifyPermanentReason(error));
      }

      // Clear dedup key if deduplication is enabled and fingerprint was stored
      if (config.DEDUP_ENABLED && job.data.dedupFingerprint) {
        try {
          await clearDedup(getDedupRedis(config.REDIS_URL), job.data.dedupFingerprint);
        } catch {
          // Non-critical
        }
      }

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
  if (dedupRedis) {
    await dedupRedis.quit();
    dedupRedis = undefined;
  }
}
