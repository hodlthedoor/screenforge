import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool, closePool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { loadConfig } from '../../src/config/index.js';
import type { FastifyInstance } from 'fastify';

describe('schedule routes', () => {
  let app: FastifyInstance;
  let apiKeyId: string;
  let rawApiKey: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql:///screenforge_test?host=/var/run/postgresql';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.ALLOW_PRIVATE_URLS = 'true';
    process.env.REQUIRE_AUTH = 'true';
    process.env.SCHEDULER_ENABLED = 'false';
    loadConfig();

    app = await buildServer({ skipBrowserInit: true });

    const result = await createApiKey('schedule-test', 'free');
    apiKeyId = result.key.id;
    rawApiKey = result.rawKey;
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
    await app.close();
  });

  describe('POST /v1/schedules', () => {
    it('creates a schedule with valid cron expression', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'Hourly homepage',
          cron_expression: '0 * * * *',
          render_type: 'screenshot',
          render_config: { url: 'https://example.com', format: 'png' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.schedule).toBeDefined();
      expect(body.schedule.name).toBe('Hourly homepage');
      expect(body.schedule.cronExpression).toBe('0 * * * *');
      expect(body.schedule.renderType).toBe('screenshot');
      expect(body.schedule.enabled).toBe(true);
      expect(body.schedule.nextRunAt).toBeTruthy();
      expect(body.schedule.id).toBeTruthy();
    });

    it('rejects invalid cron expression', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'Bad cron',
          cron_expression: 'not-a-cron',
          render_type: 'screenshot',
          render_config: { url: 'https://example.com' },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Invalid cron expression');
    });

    it('rejects intervals < 5 minutes on free tier', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'Every minute',
          cron_expression: '* * * * *',
          render_type: 'screenshot',
          render_config: { url: 'https://example.com' },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('5 minutes');
    });

    it('enforces tier schedule limit', async () => {
      // Free tier allows 3 schedules. Create 3, then a 4th should fail.
      for (let i = 0; i < 3; i++) {
        const r = await app.inject({
          method: 'POST',
          url: '/v1/schedules',
          headers: { 'x-api-key': rawApiKey },
          payload: {
            name: `Schedule ${i}`,
            cron_expression: '0 * * * *',
            render_type: 'screenshot',
            render_config: { url: 'https://example.com' },
          },
        });
        expect(r.statusCode).toBe(201);
      }

      const response = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'Schedule 4',
          cron_expression: '0 * * * *',
          render_type: 'screenshot',
          render_config: { url: 'https://example.com' },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('limit reached');
    });

    it('rejects invalid render_type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'Bad type',
          cron_expression: '0 * * * *',
          render_type: 'video',
          render_config: { url: 'https://example.com' },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        payload: {
          name: 'No auth',
          cron_expression: '0 * * * *',
          render_type: 'screenshot',
          render_config: { url: 'https://example.com' },
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('creates disabled schedule with null next_run_at', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'Disabled schedule',
          cron_expression: '0 * * * *',
          render_type: 'pdf',
          render_config: { url: 'https://example.com' },
          enabled: false,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.schedule.enabled).toBe(false);
      expect(body.schedule.nextRunAt).toBeNull();
    });
  });

  describe('GET /v1/schedules', () => {
    it('lists schedules for authenticated API key', async () => {
      // Create two schedules
      await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'First',
          cron_expression: '0 * * * *',
          render_type: 'screenshot',
          render_config: { url: 'https://example.com' },
        },
      });
      await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'Second',
          cron_expression: '0 12 * * *',
          render_type: 'pdf',
          render_config: { url: 'https://example.com/page' },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.schedules).toHaveLength(2);
      expect(body.schedules[0].name).toBe('Second'); // DESC order
      expect(body.schedules[1].name).toBe('First');
    });

    it('returns empty list when no schedules', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.schedules).toEqual([]);
    });
  });

  describe('GET /v1/schedules/:id', () => {
    it('returns schedule detail with recent jobs', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'Detail test',
          cron_expression: '0 * * * *',
          render_type: 'screenshot',
          render_config: { url: 'https://example.com' },
        },
      });
      const scheduleId = JSON.parse(createRes.body).schedule.id;

      // Insert a render job linked to this schedule
      await getPool().query(
        `INSERT INTO render_jobs (api_key_id, type, url, options, status, schedule_id)
         VALUES ($1, 'screenshot', 'https://example.com', '{}', 'completed', $2)`,
        [apiKeyId, scheduleId],
      );

      const response = await app.inject({
        method: 'GET',
        url: `/v1/schedules/${scheduleId}`,
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.schedule.id).toBe(scheduleId);
      expect(body.recent_jobs).toHaveLength(1);
      expect(body.recent_jobs[0].status).toBe('completed');
    });

    it('returns 404 for non-existent schedule', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/schedules/00000000-0000-0000-0000-000000000000',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /v1/schedules/:id', () => {
    it('updates schedule name and cron expression', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'Original',
          cron_expression: '0 * * * *',
          render_type: 'screenshot',
          render_config: { url: 'https://example.com' },
        },
      });
      const scheduleId = JSON.parse(createRes.body).schedule.id;

      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/schedules/${scheduleId}`,
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'Updated',
          cron_expression: '0 12 * * *',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.schedule.name).toBe('Updated');
      expect(body.schedule.cronExpression).toBe('0 12 * * *');
    });

    it('can disable a schedule', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'To disable',
          cron_expression: '0 * * * *',
          render_type: 'screenshot',
          render_config: { url: 'https://example.com' },
        },
      });
      const scheduleId = JSON.parse(createRes.body).schedule.id;

      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/schedules/${scheduleId}`,
        headers: { 'x-api-key': rawApiKey },
        payload: { enabled: false },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.schedule.enabled).toBe(false);
      expect(body.schedule.nextRunAt).toBeNull();
    });

    it('rejects invalid cron on update', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'To update bad',
          cron_expression: '0 * * * *',
          render_type: 'screenshot',
          render_config: { url: 'https://example.com' },
        },
      });
      const scheduleId = JSON.parse(createRes.body).schedule.id;

      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/schedules/${scheduleId}`,
        headers: { 'x-api-key': rawApiKey },
        payload: { cron_expression: 'bad-cron' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /v1/schedules/:id', () => {
    it('deletes a schedule', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/v1/schedules',
        headers: { 'x-api-key': rawApiKey },
        payload: {
          name: 'To delete',
          cron_expression: '0 * * * *',
          render_type: 'screenshot',
          render_config: { url: 'https://example.com' },
        },
      });
      const scheduleId = JSON.parse(createRes.body).schedule.id;

      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/schedules/${scheduleId}`,
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.deleted).toBe(true);

      // Verify it's gone
      const getRes = await app.inject({
        method: 'GET',
        url: `/v1/schedules/${scheduleId}`,
        headers: { 'x-api-key': rawApiKey },
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('returns 404 for non-existent schedule', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/v1/schedules/00000000-0000-0000-0000-000000000000',
        headers: { 'x-api-key': rawApiKey },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
