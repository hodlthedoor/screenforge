import { getPool } from '../db/index.js';
import { getQueue } from '../queue/render-queue.js';
import { getConfig } from '../config/index.js';
import { getNextRun } from './cron.js';
import { randomUUID } from 'node:crypto';

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

  // SELECT + lock due schedules using FOR UPDATE SKIP LOCKED for concurrency safety
  const result = await pool.query<ScheduleRow>(
    `SELECT * FROM schedules
     WHERE enabled = true AND next_run_at <= NOW()
     ORDER BY next_run_at ASC
     LIMIT 100
     FOR UPDATE SKIP LOCKED`,
  );

  if (result.rows.length === 0) return 0;

  const queue = getQueue(config.REDIS_URL);
  let enqueued = 0;

  for (const schedule of result.rows) {
    const jobId = randomUUID();

    // Insert a render_jobs row
    await pool.query(
      `INSERT INTO render_jobs (id, api_key_id, type, url, options, status, schedule_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [
        jobId,
        schedule.api_key_id,
        schedule.render_type,
        (schedule.render_config as Record<string, unknown>).url ?? '',
        JSON.stringify(schedule.render_config),
        schedule.id,
      ],
    );

    // Enqueue to BullMQ
    await queue.add('render', {
      jobId,
      apiKeyId: schedule.api_key_id,
      type: schedule.render_type as 'screenshot' | 'pdf' | 'og',
      url: (schedule.render_config as Record<string, unknown>).url as string | undefined,
      options: schedule.render_config,
      callbackUrl: (schedule.render_config as Record<string, unknown>).webhook_url as string | undefined,
    });

    // Compute next run and update schedule
    const nextRun = getNextRun(schedule.cron_expression);
    await pool.query(
      `UPDATE schedules SET last_run_at = NOW(), next_run_at = $1, updated_at = NOW() WHERE id = $2`,
      [nextRun, schedule.id],
    );

    enqueued++;
  }

  return enqueued;
}

export function startScheduler(): void {
  const config = getConfig();
  if (!config.SCHEDULER_ENABLED) return;

  const intervalMs = config.SCHEDULER_POLL_INTERVAL_MS;

  // Run once immediately, then on interval
  pollDueSchedules().catch(() => {});

  pollTimer = setInterval(() => {
    pollDueSchedules().catch(() => {});
  }, intervalMs);
}

export function stopScheduler(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
