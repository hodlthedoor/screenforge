import { beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import { createApiKey } from '../../src/db/api-keys.js';
import { getPool } from '../../src/db/index.js';
import { closeQueue, createWorker, type RenderJobData, type RenderJobResult } from '../../src/queue/render-queue.js';
import { createServer, type Server } from 'node:http';
import { readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { getConfig } from '../../src/config/index.js';
import { takeScreenshot } from '../../src/renderer/screenshot.js';
import { renderPdf } from '../../src/renderer/pdf.js';
import { screenshotOptionsSchema, pdfOptionsSchema } from '../../src/renderer/schemas.js';
import type { Job } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';

export const TEST_STORAGE = resolve(__dirname, '../../storage-e2e-test');

export let app: FastifyInstance;
export let baseUrl: string;
export let apiKey: string;
export let apiKeyId: string;
export let fixtureServer: Server;
export let fixtureUrl: string;

beforeAll(async () => {
  process.env.STORAGE_PATH = TEST_STORAGE;

  await mkdir(TEST_STORAGE, { recursive: true });

  // Clean stale BullMQ jobs from test Redis to prevent worker backlog
  const cleanupRedis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/15');
  const staleKeys = await cleanupRedis.keys('bull:*');
  if (staleKeys.length > 0) {
    await cleanupRedis.del(...staleKeys);
  }
  await cleanupRedis.quit();

  // Start fixture HTTP server
  const html = await readFile(resolve(__dirname, '../fixtures/test-page.html'), 'utf-8');
  fixtureServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise<void>((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
  const fixtureAddr = fixtureServer.address();
  if (fixtureAddr && typeof fixtureAddr === 'object') {
    fixtureUrl = `http://127.0.0.1:${fixtureAddr.port}`;
  }

  // Build server WITH real browser pool
  app = await buildServer();

  // Start queue worker so async/batch jobs are processed
  const config = getConfig();
  const browserPool = app.browserPool;
  const worker = createWorker(config.REDIS_URL, async (job: Job<RenderJobData, RenderJobResult>) => {
    const { type, url, options } = job.data;
    const schemaInput = (options.url || options.html) ? { ...options } : { url, ...options };

    if (type === 'pdf') {
      const parsed = pdfOptionsSchema.parse(schemaInput);
      const result = await renderPdf(browserPool, parsed, config.NAVIGATION_TIMEOUT_MS);
      const filePath = join(config.STORAGE_PATH, `${job.data.jobId}.pdf`);
      await writeFile(filePath, result.buffer);
      return { resultPath: filePath, contentType: result.contentType, durationMs: result.durationMs, metadata: result.metadata };
    }

    const parsed = screenshotOptionsSchema.parse(schemaInput);
    const result = await takeScreenshot(browserPool, parsed, config.NAVIGATION_TIMEOUT_MS);
    const ext = parsed.format === 'jpeg' ? 'jpg' : 'png';
    const filePath = join(config.STORAGE_PATH, `${job.data.jobId}.${ext}`);
    await writeFile(filePath, result.buffer);
    return { resultPath: filePath, contentType: result.contentType, durationMs: result.durationMs, metadata: result.metadata };
  });

  // Wait for worker to be ready before accepting requests
  await worker.waitUntilReady();

  // Listen on random port
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.addresses()[0];
  baseUrl = `http://${addr.address}:${addr.port}`;

  // Create a test API key directly in DB
  const result = await createApiKey('e2e-test-key', 'pro');
  apiKey = result.rawKey;
  apiKeyId = result.key.id;
}, 30_000);

afterAll(async () => {
  const pool = getPool();
  try {
    await pool.query(`DELETE FROM usage_daily WHERE api_key_id = $1`, [apiKeyId]);
    await pool.query(`DELETE FROM render_jobs WHERE api_key_id = $1`, [apiKeyId]);
    await pool.query(`DELETE FROM batch_jobs WHERE api_key_id = $1`, [apiKeyId]);
    await pool.query(`DELETE FROM api_keys WHERE id = $1`, [apiKeyId]);
  } catch {
    // Ignore cleanup errors
  }

  await closeQueue();
  await app.close();
  await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  await rm(TEST_STORAGE, { recursive: true, force: true });
}, 30_000);
