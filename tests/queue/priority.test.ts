import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { getPool, closePool, resetPool } from '../../src/db/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { tierToPriority } from '../../src/queue/render-queue.js';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';

const TEST_STORAGE = resolve(import.meta.dirname, '../../storage-priority-test');

describe('tierToPriority', () => {
  it('maps free tier to lowest priority (highest number)', () => {
    expect(tierToPriority('free')).toBe(40);
  });

  it('maps starter tier to normal priority', () => {
    expect(tierToPriority('starter')).toBe(30);
  });

  it('maps pro tier to high priority', () => {
    expect(tierToPriority('pro')).toBe(20);
  });

  it('maps business tier to critical priority (lowest number)', () => {
    expect(tierToPriority('business')).toBe(10);
  });

  it('defaults to lowest priority for unknown tier', () => {
    expect(tierToPriority('unknown' as 'free')).toBe(40);
  });
});

describe('queue priority — async render jobs', { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let freeKey: string;
  let proKey: string;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_PATH = TEST_STORAGE;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.ALLOW_PRIVATE_URLS = 'true';
    process.env.REQUIRE_AUTH = 'true';
    process.env.BASE_URL = 'http://localhost:3000';
    process.env.QUEUE_PRIORITY_ENABLED = 'true';
    process.env.DEDUP_ENABLED = 'false'; // Disable dedup to test priority in isolation

    app = await buildServer({ skipBrowserInit: true });

    const freeCreated = await createApiKey('Priority Test Free', 'free');
    freeKey = freeCreated.rawKey;

    const proCreated = await createApiKey('Priority Test Pro', 'pro');
    proKey = proCreated.rawKey;
  });

  afterAll(async () => {
    await app.close();
    await rm(TEST_STORAGE, { recursive: true, force: true });
    const pool = getPool();
    const keyResult = await pool.query(
      "SELECT id FROM api_keys WHERE name IN ('Priority Test Free', 'Priority Test Pro')",
    );
    const keyIds = keyResult.rows.map((r: { id: string }) => r.id);
    if (keyIds.length > 0) {
      await pool.query('DELETE FROM render_jobs WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM usage_daily WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM api_keys WHERE id = ANY($1)', [keyIds]);
    }
    await closePool();
    resetPool();
    delete process.env.ALLOW_PRIVATE_URLS;
    delete process.env.REQUIRE_AUTH;
    delete process.env.BASE_URL;
    delete process.env.QUEUE_PRIORITY_ENABLED;
    delete process.env.DEDUP_ENABLED;
  });

  it('stores priority in render_jobs when async job is created', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': proKey },
      payload: { url: 'http://127.0.0.1:1234' },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);

    const pool = getPool();
    const result = await pool.query(
      'SELECT priority FROM render_jobs WHERE id = $1',
      [body.id],
    );
    expect(result.rows[0].priority).toBe(20); // pro = 20
  });

  it('free-tier gets lower priority than pro-tier', async () => {
    const freeRes = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': freeKey },
      payload: { url: 'http://127.0.0.1:1234' },
    });
    const proRes = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': proKey },
      payload: { url: 'http://127.0.0.1:1234' },
    });

    expect(freeRes.statusCode).toBe(202);
    expect(proRes.statusCode).toBe(202);

    const pool = getPool();
    const freeJob = await pool.query(
      'SELECT priority FROM render_jobs WHERE id = $1',
      [JSON.parse(freeRes.body).id],
    );
    const proJob = await pool.query(
      'SELECT priority FROM render_jobs WHERE id = $1',
      [JSON.parse(proRes.body).id],
    );

    // In BullMQ, lower number = higher priority
    // Pro (20) should have lower number than free (40)
    expect(proJob.rows[0].priority).toBeLessThan(freeJob.rows[0].priority);
  });

  it('priority is correctly derived from API key tier in DB', async () => {
    const pool = getPool();

    // Create jobs for both tiers
    const freeRes = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': freeKey },
      payload: { url: 'http://127.0.0.1:1234' },
    });
    const proRes = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': proKey },
      payload: { url: 'http://127.0.0.1:1234' },
    });

    const freeJobId = JSON.parse(freeRes.body).id;
    const proJobId = JSON.parse(proRes.body).id;

    // Verify priorities match tier mapping
    const jobs = await pool.query(
      'SELECT id, priority FROM render_jobs WHERE id = ANY($1)',
      [[freeJobId, proJobId]],
    );

    const freeJob = jobs.rows.find((r: { id: string }) => r.id === freeJobId);
    const proJob = jobs.rows.find((r: { id: string }) => r.id === proJobId);

    expect(freeJob.priority).toBe(40);
    expect(proJob.priority).toBe(20);
  });
});

describe('queue priority — QUEUE_PRIORITY_ENABLED=false', { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  let proKey: string;

  const DISABLED_STORAGE = resolve(import.meta.dirname, '../../storage-priority-disabled-test');

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.STORAGE_PATH = DISABLED_STORAGE;
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.ALLOW_PRIVATE_URLS = 'true';
    process.env.REQUIRE_AUTH = 'true';
    process.env.BASE_URL = 'http://localhost:3000';
    process.env.QUEUE_PRIORITY_ENABLED = 'false';
    process.env.DEDUP_ENABLED = 'false'; // Disable dedup to test priority in isolation

    app = await buildServer({ skipBrowserInit: true });

    const proCreated = await createApiKey('Priority Disabled Pro', 'pro');
    proKey = proCreated.rawKey;
  });

  afterAll(async () => {
    await app.close();
    await rm(DISABLED_STORAGE, { recursive: true, force: true });
    const pool = getPool();
    const keyResult = await pool.query(
      "SELECT id FROM api_keys WHERE name = 'Priority Disabled Pro'",
    );
    const keyIds = keyResult.rows.map((r: { id: string }) => r.id);
    if (keyIds.length > 0) {
      await pool.query('DELETE FROM render_jobs WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM usage_daily WHERE api_key_id = ANY($1)', [keyIds]);
      await pool.query('DELETE FROM api_keys WHERE id = ANY($1)', [keyIds]);
    }
    await closePool();
    resetPool();
    delete process.env.ALLOW_PRIVATE_URLS;
    delete process.env.REQUIRE_AUTH;
    delete process.env.BASE_URL;
    delete process.env.QUEUE_PRIORITY_ENABLED;
    delete process.env.DEDUP_ENABLED;
  });

  it('all jobs get default priority 40 when priority is disabled', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/screenshot?async=true',
      headers: { 'x-api-key': proKey },
      payload: { url: 'http://127.0.0.1:1234' },
    });
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);

    const pool = getPool();
    const result = await pool.query(
      'SELECT priority FROM render_jobs WHERE id = $1',
      [body.id],
    );
    // Pro tier would normally get 20, but with priority disabled all jobs get 40
    expect(result.rows[0].priority).toBe(40);
  });
});
