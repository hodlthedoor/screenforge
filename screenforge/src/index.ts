import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import session from '@fastify/session';
import { loadConfig } from './config/index.js';
import { BrowserPool } from './renderer/browser-pool.js';
import { RenderCache } from './cache/index.js';
import { SlidingWindowRateLimiter } from './auth/rate-limiter.js';
import { renderRoutes } from './routes/render.js';
import { adminRoutes } from './routes/admin.js';
import { usageRoutes } from './routes/usage.js';
import { asyncRenderRoutes } from './routes/async-render.js';
import { batchRoutes } from './routes/batch.js';
import { ogRoutes } from './routes/og.js';
import { requestIdHook } from './security/request-id.js';
import { getQueueMetrics, createWorker, type RenderJobData, type RenderJobResult } from './queue/render-queue.js';
import { closePool } from './db/index.js';
import { closeQueue } from './queue/render-queue.js';
import { createWebhookWorker, closeWebhookQueue } from './webhooks/delivery.js';
import { registerDocs } from './docs/swagger.js';
import { errorCodesRoutes } from './docs/error-codes.js';
import { landingRoutes } from './routes/landing.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { billingRoutes } from './routes/billing.js';
import { webhooksRoutes } from './routes/webhooks.js';
import { registerLoggers, getLogger } from './logging/index.js';
import { buildErrorResponse } from './security/errors.js';
import { takeScreenshot } from './renderer/screenshot.js';
import { renderPdf } from './renderer/pdf.js';
import { screenshotOptionsSchema, pdfOptionsSchema } from './renderer/schemas.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from 'bullmq';

export async function buildServer(opts?: { skipBrowserInit?: boolean }) {
  const config = loadConfig();

  const app = Fastify({
    logger: config.NODE_ENV === 'test'
      ? false
      : {
          level: config.LOG_LEVEL,
          transport:
            config.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { colorize: true } }
              : undefined,
        },
  });

  await app.register(cors, { origin: true });
  await app.register(formbody);
  await app.register(cookie);
  await app.register(session, {
    secret: config.SESSION_SECRET,
    cookie: {
      secure: config.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    saveUninitialized: false,
  });

  // Request ID tracking
  app.addHook('onRequest', requestIdHook);

  // Request logging
  app.addHook('onResponse', (req, reply, done) => {
    if (!req.url.startsWith('/v1/')) {
      done();
      return;
    }

    const duration = reply.elapsedTime;
    const apiKeyPrefix = req.apiKey
      ? req.apiKey.prefix
      : undefined;

    app.log.info({
      method: req.method,
      url: req.url,
      status: reply.statusCode,
      duration_ms: duration,
      api_key_prefix: apiKeyPrefix,
      request_id: req.id,
    });
    done();
  });

  // Register loggers for modules
  registerLoggers(app);

  const pool = new BrowserPool(config.BROWSER_POOL_SIZE, config.MAX_RENDERS_PER_CONTEXT);
  if (!opts?.skipBrowserInit) {
    await pool.init();
  }

  const cache = new RenderCache(config.REDIS_URL, config.STORAGE_PATH, config.CACHE_TTL_SECONDS);
  const rateLimiter = new SlidingWindowRateLimiter(config.REDIS_URL);

  const startTime = Date.now();

  app.get('/v1/health', async () => {
    let queueMetrics = { waiting: 0, active: 0, completed: 0, failed: 0 };
    try {
      queueMetrics = await getQueueMetrics(config.REDIS_URL);
    } catch {
      // Queue may not be initialized in test mode
    }

    return {
      status: 'ok',
      version: '1.0.0',
      uptime: Math.round((Date.now() - startTime) / 1000),
      browserPool: pool.stats(),
      queue: queueMetrics,
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Landing page & auth
  await landingRoutes(app);
  await authRoutes(app);
  await dashboardRoutes(app);
  await billingRoutes(app);

  // API docs
  await registerDocs(app);
  await errorCodesRoutes(app);

  // Register API routes
  await renderRoutes(app, pool, cache, rateLimiter);
  await adminRoutes(app);
  await usageRoutes(app);
  await asyncRenderRoutes(app);
  await batchRoutes(app);
  await ogRoutes(app, pool, cache);
  await webhooksRoutes(app);

  app.setNotFoundHandler((req, reply) => {
    const response = buildErrorResponse('NOT_FOUND', req);
    reply.status(404).send(response);
  });

  app.setErrorHandler((error: { message: string; statusCode?: number; code?: string; validation?: unknown }, req, reply) => {
    const statusCode = error.statusCode ?? 500;

    // Handle Fastify validation errors
    if (statusCode === 400 && error.validation) {
      const response = buildErrorResponse('VALIDATION_ERROR', req, {
        details: error.validation,
      });
      return reply.status(400).send(response);
    }

    // Handle 404 not found
    if (statusCode === 404) {
      const response = buildErrorResponse('NOT_FOUND', req);
      return reply.status(404).send(response);
    }

    // Handle other errors
    const response = buildErrorResponse('INTERNAL_ERROR', req, {
      message: error.message,
    });
    reply.status(statusCode).send(response);
  });

  app.addHook('onClose', async () => {
    await pool.close();
    await cache.close();
    await rateLimiter.close();
    await closeQueue();
    await closeWebhookQueue();
    await closePool();
  });

  app.decorate('browserPool', pool);
  app.decorate('renderCache', cache);

  return app;
}

export async function start() {
  const config = loadConfig();
  const app = await buildServer();

  // Start queue worker so async/batch jobs are processed
  const browserPool = (app as unknown as { browserPool: BrowserPool }).browserPool;
  await mkdir(config.STORAGE_PATH, { recursive: true });
  const queueLogger = getLogger('queue');

  // Start render worker
  const worker = createWorker(config.REDIS_URL, async (job: Job<RenderJobData, RenderJobResult>) => {
    const { type, url, options } = job.data;
    const start = performance.now();

    if (type === 'pdf') {
      const parsed = pdfOptionsSchema.parse({ url, ...options });
      const result = await renderPdf(browserPool, parsed, config.NAVIGATION_TIMEOUT_MS);
      const filePath = join(config.STORAGE_PATH, `${job.data.jobId}.pdf`);
      await writeFile(filePath, result.buffer);
      return { resultPath: filePath, contentType: result.contentType, durationMs: result.durationMs };
    }

    // Default: screenshot (including og type)
    const parsed = screenshotOptionsSchema.parse({ url, ...options });
    const result = await takeScreenshot(browserPool, parsed, config.NAVIGATION_TIMEOUT_MS);
    const ext = parsed.format === 'jpeg' ? 'jpg' : 'png';
    const filePath = join(config.STORAGE_PATH, `${job.data.jobId}.${ext}`);
    await writeFile(filePath, result.buffer);
    return { resultPath: filePath, contentType: result.contentType, durationMs: Math.round(performance.now() - start) };
  });

  // Log render job completions
  worker.on('completed', (job) => {
    const result = job.returnvalue;
    const format = result.contentType.includes('pdf') ? 'pdf' : (result.contentType.includes('jpeg') ? 'jpeg' : 'png');
    queueLogger.info({
      url: job.data.url,
      type: job.data.type,
      duration_ms: result.durationMs,
      cache_hit: false, // Queue jobs are never cache hits
      format,
      job_id: job.data.jobId,
      status: 'completed',
    });
  });

  worker.on('failed', (job, error) => {
    if (!job) return;
    queueLogger.error({
      url: job.data.url,
      type: job.data.type,
      duration_ms: undefined,
      cache_hit: false,
      format: job.data.type === 'pdf' ? 'pdf' : 'png',
      job_id: job.data.jobId,
      status: 'failed',
      error: error.message,
    });
  });

  // Start webhook worker
  createWebhookWorker(config.REDIS_URL);

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const isMainModule = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (isMainModule) {
  start();
}
