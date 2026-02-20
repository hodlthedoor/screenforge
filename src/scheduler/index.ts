import { getPool } from '../db/index.js';
import { getQueue, tierToPriority } from '../queue/render-queue.js';
import { getConfig } from '../config/index.js';
import { getNextRun } from './cron.js';
import { randomUUID } from 'node:crypto';
import { getLogger } from '../logging/index.js';

/** Retention period for completed/failed BullMQ jobs (7 days in ms). */
const QUEUE_CLEANUP_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** Max jobs to clean per batch (avoids long-running Redis commands). */
const QUEUE_CLEANUP_BATCH_SIZE = 5000;

export interface ScheduleRow {
  id: string;
  api_key_id: string;
  name: string;
  cron_expression: string;
  render_type: string;
  render_config: Record<string, unknown>;
  enabled: boolean;
  last_run_at: Date | null;
  next_run_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export async function pollDueSchedules(): Promise<number> {
  const pool = getPool();
  const config = getConfig();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // SELECT + lock due schedules using FOR UPDATE SKIP LOCKED for concurrency safety
    const result = await client.query<ScheduleRow & { api_key_tier?: string }>(
      `SELECT s.*, ak.tier AS api_key_tier FROM schedules s
       LEFT JOIN api_keys ak ON ak.id = s.api_key_id
       WHERE s.enabled = true AND s.next_run_at <= NOW()
       ORDER BY s.next_run_at ASC
       LIMIT 100
       FOR UPDATE OF s SKIP LOCKED`,
    );

    if (result.rows.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    const queue = getQueue(config.REDIS_URL);
    let enqueued = 0;

    for (const schedule of result.rows) {
      const jobId = randomUUID();
      const url = (schedule.render_config as Record<string, unknown>).url as string | undefined;

      // Derive priority from API key tier
      const priority = config.QUEUE_PRIORITY_ENABLED && schedule.api_key_tier
        ? tierToPriority(schedule.api_key_tier) : 40;

      // Insert a render_jobs row
      await client.query(
        `INSERT INTO render_jobs (id, api_key_id, type, url, options, status, schedule_id, priority)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
        [
          jobId,
          schedule.api_key_id,
          schedule.render_type,
          url ?? '',
          JSON.stringify(schedule.render_config),
          schedule.id,
          priority,
        ],
      );

      // Enqueue to BullMQ
      await queue.add('render', {
        jobId,
        apiKeyId: schedule.api_key_id,
        type: schedule.render_type as 'screenshot' | 'pdf' | 'og',
        url,
        options: schedule.render_config,
        callbackUrl: (schedule.render_config as Record<string, unknown>).webhook_url as string | undefined,
      }, { priority });

      // Compute next run and update schedule
      const nextRun = getNextRun(schedule.cron_expression);
      await client.query(
        `UPDATE schedules SET last_run_at = NOW(), next_run_at = $1, updated_at = NOW() WHERE id = $2`,
        [nextRun, schedule.id],
      );

      enqueued++;
    }

    await client.query('COMMIT');
    return enqueued;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

let loggerReady = false;

export function startScheduler(): void {
  const config = getConfig();
  if (!config.SCHEDULER_ENABLED) return;

  loggerReady = true;
  const intervalMs = config.SCHEDULER_POLL_INTERVAL_MS;

  // Run once immediately, then on interval
  pollDueSchedules().catch((err) => {
    if (loggerReady) {
      try { getLogger('scheduler').error({ err }, 'Scheduler poll failed'); } catch { /* logger not registered yet */ }
    }
  });

  pollTimer = setInterval(() => {
    pollDueSchedules().catch((err) => {
      if (loggerReady) {
        try { getLogger('scheduler').error({ err }, 'Scheduler poll failed'); } catch { /* logger not registered yet */ }
      }
    });
  }, intervalMs);
}

export function stopScheduler(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Refresh analytics materialized views. Called daily at midnight. */
export async function refreshAnalyticsViews(): Promise<void> {
  const pool = getPool();
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY daily_render_stats');
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY monthly_user_stats');
}

let analyticsRefreshTimer: ReturnType<typeof setInterval> | null = null;

export function startAnalyticsRefresh(): void {
  const now = new Date();
  // Schedule first refresh at next midnight
  const nextMidnight = new Date(now);
  nextMidnight.setDate(nextMidnight.getDate() + 1);
  nextMidnight.setHours(0, 0, 0, 0);
  const msUntilMidnight = nextMidnight.getTime() - now.getTime();

  setTimeout(() => {
    refreshAnalyticsViews().catch(() => { /* non-critical */ });
    // Then refresh every 24 hours
    analyticsRefreshTimer = setInterval(() => {
      refreshAnalyticsViews().catch(() => { /* non-critical */ });
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

export function stopAnalyticsRefresh(): void {
  if (analyticsRefreshTimer) {
    clearInterval(analyticsRefreshTimer);
    analyticsRefreshTimer = null;
  }
}

/** Remove completed and failed BullMQ jobs older than 7 days. */
export async function cleanupQueueJobs(): Promise<void> {
  const config = getConfig();
  const queue = getQueue(config.REDIS_URL);

  await queue.clean(QUEUE_CLEANUP_GRACE_MS, QUEUE_CLEANUP_BATCH_SIZE, 'completed');
  await queue.clean(QUEUE_CLEANUP_GRACE_MS, QUEUE_CLEANUP_BATCH_SIZE, 'failed');
}

let queueCleanupTimer: ReturnType<typeof setInterval> | null = null;

/** Start daily queue cleanup at 3am. */
export function startQueueCleanup(): void {
  const scheduleNext = (): number => {
    const now = new Date();
    const next3am = new Date(now);
    next3am.setHours(3, 0, 0, 0);
    if (next3am <= now) next3am.setDate(next3am.getDate() + 1);
    return next3am.getTime() - now.getTime();
  };

  const runAndReschedule = (): void => {
    cleanupQueueJobs().catch(() => { /* non-critical */ });
    queueCleanupTimer = setInterval(runAndReschedule, 24 * 60 * 60 * 1000);
  };

  setTimeout(runAndReschedule, scheduleNext());
}

export function stopQueueCleanup(): void {
  if (queueCleanupTimer) {
    clearInterval(queueCleanupTimer);
    queueCleanupTimer = null;
  }
}
