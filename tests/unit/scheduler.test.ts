import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { validateCronExpression, getNextRun } from '../../src/scheduler/cron.js';
import { pollDueSchedules } from '../../src/scheduler/index.js';
import { getPool, closePool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { loadConfig } from '../../src/config/index.js';

describe('cron validation', () => {
  it('accepts valid cron expressions', () => {
    expect(validateCronExpression('0 * * * *').valid).toBe(true);
    expect(validateCronExpression('*/15 * * * *').valid).toBe(true);
    expect(validateCronExpression('0 0 * * 1').valid).toBe(true);
    expect(validateCronExpression('0 12 * * *').valid).toBe(true);
  });

  it('rejects invalid cron expressions', () => {
    expect(validateCronExpression('not-valid').valid).toBe(false);
    expect(validateCronExpression('').valid).toBe(false);
    expect(validateCronExpression('60 * * * *').valid).toBe(false);
  });

  it('rejects intervals < 5 minutes on free tier', () => {
    const result = validateCronExpression('* * * * *', 'free');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('5 minutes');
  });

  it('allows intervals < 5 minutes on pro tier', () => {
    const result = validateCronExpression('*/2 * * * *', 'pro');
    expect(result.valid).toBe(true);
  });

  it('returns nextRun for valid expressions', () => {
    const result = validateCronExpression('0 * * * *');
    expect(result.valid).toBe(true);
    expect(result.nextRun).toBeInstanceOf(Date);
    expect(result.nextRun!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('getNextRun', () => {
  it('returns a future date', () => {
    const next = getNextRun('0 * * * *');
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it('respects from date', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const next = getNextRun('0 12 * * *', from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    expect(next.getUTCHours()).toBe(12);
  });
});

describe('scheduler polling', () => {
  let apiKeyId: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql:///screenforge_test?host=/var/run/postgresql';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.SCHEDULER_ENABLED = 'false';
    loadConfig();

    const result = await createApiKey('scheduler-test', 'free');
    apiKeyId = result.key.id;
  });

  afterEach(async () => {
    await getPool().query('DELETE FROM render_jobs WHERE api_key_id = $1', [apiKeyId]);
    await getPool().query('DELETE FROM schedules WHERE api_key_id = $1', [apiKeyId]);
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query('DELETE FROM render_jobs WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM schedules WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM usage_daily WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM user_api_keys WHERE api_key_id = $1', [apiKeyId]);
    await pool.query('DELETE FROM api_keys WHERE id = $1', [apiKeyId]);
    await closePool();
  });

  it('picks up due schedules and enqueues jobs', async () => {
    const pool = getPool();
    // Insert a schedule that is due (next_run_at in the past)
    await pool.query(
      `INSERT INTO schedules (api_key_id, name, cron_expression, render_type, render_config, enabled, next_run_at)
       VALUES ($1, 'Due schedule', '0 * * * *', 'screenshot', $2, true, NOW() - interval '1 minute')`,
      [apiKeyId, JSON.stringify({ url: 'https://example.com' })],
    );

    const enqueued = await pollDueSchedules();
    expect(enqueued).toBe(1);

    // Verify a render job was created
    const jobs = await pool.query(
      'SELECT * FROM render_jobs WHERE api_key_id = $1 AND schedule_id IS NOT NULL',
      [apiKeyId],
    );
    expect(jobs.rows.length).toBe(1);
    expect(jobs.rows[0].type).toBe('screenshot');
    expect(jobs.rows[0].status).toBe('pending');
  });

  it('skips disabled schedules', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO schedules (api_key_id, name, cron_expression, render_type, render_config, enabled, next_run_at)
       VALUES ($1, 'Disabled schedule', '0 * * * *', 'screenshot', $2, false, NOW() - interval '1 minute')`,
      [apiKeyId, JSON.stringify({ url: 'https://example.com' })],
    );

    const enqueued = await pollDueSchedules();
    expect(enqueued).toBe(0);
  });

  it('skips schedules not yet due', async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO schedules (api_key_id, name, cron_expression, render_type, render_config, enabled, next_run_at)
       VALUES ($1, 'Future schedule', '0 * * * *', 'screenshot', $2, true, NOW() + interval '1 hour')`,
      [apiKeyId, JSON.stringify({ url: 'https://example.com' })],
    );

    const enqueued = await pollDueSchedules();
    expect(enqueued).toBe(0);
  });

  it('updates next_run_at after polling', async () => {
    const pool = getPool();
    const pastTime = new Date(Date.now() - 60_000);
    await pool.query(
      `INSERT INTO schedules (api_key_id, name, cron_expression, render_type, render_config, enabled, next_run_at)
       VALUES ($1, 'Update test', '0 * * * *', 'screenshot', $2, true, $3)`,
      [apiKeyId, JSON.stringify({ url: 'https://example.com' }), pastTime],
    );

    await pollDueSchedules();

    const result = await pool.query(
      'SELECT next_run_at, last_run_at FROM schedules WHERE api_key_id = $1 AND name = $2',
      [apiKeyId, 'Update test'],
    );

    expect(result.rows[0].last_run_at).toBeTruthy();
    const nextRun = new Date(result.rows[0].next_run_at);
    expect(nextRun.getTime()).toBeGreaterThan(Date.now());
  });
});
