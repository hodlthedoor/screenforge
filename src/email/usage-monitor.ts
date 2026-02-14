import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { getPool } from '../db/index.js';
import { sendEmail, getSmtpConfig } from './index.js';
import { renderQuotaWarning, renderQuotaExceeded } from './templates.js';
import { getConfig } from '../config/index.js';

const QUEUE_NAME = 'screenforge-usage-monitor';
const REDIS_WARNING_KEY = 'screenforge:usage-warnings';

export function getWarningThreshold(usage: number, quota: number): number | null {
  if (quota <= 0) return null;
  const percent = (usage / quota) * 100;

  if (percent >= 100) return 100;
  if (percent >= 95) return 95;
  if (percent >= 80) return 80;
  return null;
}

interface UsageRow {
  api_key_id: string;
  user_id: string;
  email: string;
  monthly_usage: string;
  monthly_quota: number;
}

let usageQueue: Queue | undefined;
let usageWorker: Worker | undefined;

export function createUsageMonitor(redisUrl: string): { queue: Queue; worker: Worker } {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  usageQueue = new Queue(QUEUE_NAME, { connection });
  usageWorker = new Worker(
    QUEUE_NAME,
    async () => {
      await checkUsageThresholds(redisUrl);
    },
    { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }), concurrency: 1 },
  );

  // Add repeatable job (hourly)
  void usageQueue.add(
    'check-usage',
    {},
    {
      repeat: { every: 60 * 60 * 1000 },
      removeOnComplete: 10,
      removeOnFail: 10,
    },
  );

  return { queue: usageQueue, worker: usageWorker };
}

async function checkUsageThresholds(redisUrl: string): Promise<void> {
  const pool = getPool();
  const config = getConfig();
  const smtp = getSmtpConfig();
  const redis = new Redis(redisUrl);

  try {
    // Get all API keys with their usage and quotas
    const result = await pool.query<UsageRow>(`
      SELECT
        ak.id as api_key_id,
        uak.user_id,
        u.email,
        COALESCE(SUM(ud.count), 0)::text as monthly_usage,
        ak.monthly_quota
      FROM api_keys ak
      JOIN user_api_keys uak ON uak.api_key_id = ak.id
      JOIN users u ON u.id = uak.user_id
      LEFT JOIN usage_daily ud ON ud.api_key_id = ak.id
        AND ud.date >= date_trunc('month', CURRENT_DATE)
      WHERE ak.active = true
      GROUP BY ak.id, uak.user_id, u.email, ak.monthly_quota
    `);

    const billingCycleKey = new Date().toISOString().slice(0, 7); // YYYY-MM

    for (const row of result.rows) {
      const usage = Number(row.monthly_usage);
      const threshold = getWarningThreshold(usage, row.monthly_quota);

      if (threshold === null) continue;

      // Check dedup: have we already sent this threshold for this key this cycle?
      const dedupField = `${row.api_key_id}:${billingCycleKey}`;
      const lastSent = await redis.hget(REDIS_WARNING_KEY, dedupField);
      const lastThreshold = lastSent ? Number(lastSent) : 0;

      if (threshold <= lastThreshold) continue;

      // Send the appropriate email
      const upgradeUrl = `${config.BASE_URL}/dashboard/billing`;
      const percentage = Math.round((usage / row.monthly_quota) * 100);

      if (threshold === 100) {
        const template = renderQuotaExceeded({
          email: row.email,
          currentUsage: usage,
          monthlyQuota: row.monthly_quota,
          upgradeUrl,
        });
        await sendEmail({ to: row.email, ...template }, smtp);
      } else {
        const template = renderQuotaWarning({
          email: row.email,
          currentUsage: usage,
          monthlyQuota: row.monthly_quota,
          percentage,
          upgradeUrl,
        });
        await sendEmail({ to: row.email, ...template }, smtp);
      }

      // Record that we sent this threshold
      await redis.hset(REDIS_WARNING_KEY, dedupField, String(threshold));
    }
  } finally {
    await redis.quit();
  }
}

export async function closeUsageMonitor(): Promise<void> {
  if (usageWorker) await usageWorker.close();
  if (usageQueue) await usageQueue.close();
}
