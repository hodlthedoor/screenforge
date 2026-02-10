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
import { registerDocs } from './docs/swagger.js';
import { landingRoutes } from './routes/landing.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
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
          level: 'info',
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

  // API docs
  await registerDocs(app);

  // Register API routes
  await renderRoutes(app, pool, cache, rateLimiter);
  await adminRoutes(app);
  await usageRoutes(app);
  await asyncRenderRoutes(app);
  await batchRoutes(app);
  await ogRoutes(app, pool, cache);

  app.setErrorHandler((error: { message: string; statusCode?: number; code?: string }, _req, reply) => {
    const statusCode = error.statusCode ?? 500;
    reply.status(statusCode).send({
      error: error.message,
      code: error.code ?? 'INTERNAL_ERROR',
      statusCode,
    });
  });

  app.addHook('onClose', async () => {
    await pool.close();
    await cache.close();
    await rateLimiter.close();
    await closeQueue();
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

  createWorker(config.REDIS_URL, async (job: Job<RenderJobData, RenderJobResult>) => {
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
