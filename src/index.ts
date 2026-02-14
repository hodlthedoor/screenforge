import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import session from '@fastify/session';
import { loadConfig } from './config/index.js';
import { BrowserPool } from './renderer/browser-pool.js';
import { RenderCache } from './cache/index.js';
import { SlidingWindowRateLimiter } from './auth/rate-limiter.js';
import { authMiddleware } from './auth/middleware.js';
import { StorageLifecycleManager } from './storage/lifecycle.js';
import { renderRoutes } from './routes/render.js';
import { adminRoutes } from './routes/admin.js';
import { usageRoutes } from './routes/usage.js';
import { asyncRenderRoutes } from './routes/async-render.js';
import { batchRoutes } from './routes/batch.js';
import { ogRoutes } from './routes/og.js';
import { signedRoutes } from './routes/signed.js';
import { requestIdHook } from './security/request-id.js';
import { requestTimeoutHook, requestTimeoutCleanupHook } from './renderer/timeout.js';
import { getQueueMetrics, createWorker, type RenderJobData, type RenderJobResult } from './queue/render-queue.js';
import { closePool } from './db/index.js';
import { closeQueue } from './queue/render-queue.js';
import { createWebhookWorker, closeWebhookQueue } from './webhooks/delivery.js';
import { createUsageMonitor, closeUsageMonitor } from './email/usage-monitor.js';
import { registerDocs } from './docs/swagger.js';
import { errorCodesRoutes } from './docs/error-codes.js';
import { landingRoutes } from './routes/landing.js';
import { authRoutes } from './routes/auth.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { billingRoutes } from './routes/billing.js';
import { webhooksRoutes } from './routes/webhooks.js';
import { adminPanelRoutes } from './routes/admin-panel.js';
import { legalRoutes } from './routes/legal.js';
import { playgroundRoutes } from './routes/playground.js';
import { docsSiteRoutes } from './routes/docs-site.js';
import { analyticsRoutes } from './routes/analytics.js';
import { registerLoggers, getLogger } from './logging/index.js';
import { buildErrorResponse } from './security/errors.js';
import { takeScreenshot } from './renderer/screenshot.js';
import { renderPdf } from './renderer/pdf.js';
import { screenshotOptionsSchema, pdfOptionsSchema } from './renderer/schemas.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { initMetrics, getMetrics, incrementApiRequestCounter, observeApiRequestDuration } from './metrics/index.js';

export async function buildServer(opts?: { skipBrowserInit?: boolean }) {
  const config = loadConfig();

  // Shutdown state (scoped per server instance)
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;
  let inflightRenders = 0;

  const app = Fastify({
    trustProxy: config.NODE_ENV === 'production',
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

  // CORS configuration: restrict origins in production
  const corsOrigins = config.CORS_ORIGINS.length > 0
    ? config.CORS_ORIGINS
    : (config.NODE_ENV === 'development' ? true : false);

  await app.register(cors, {
    origin: corsOrigins,
    credentials: true,
  });
  await app.register(formbody);
  await app.register(cookie);
  await app.register(session, {
    secret: config.SESSION_SECRET,
    cookie: {
      secure: 'auto',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
    saveUninitialized: false,
  });

  // Initialize metrics if enabled
  if (config.METRICS_ENABLED) {
    initMetrics();
  }

  // Request ID tracking
  app.addHook('onRequest', requestIdHook);

  // Request timeout (all routes)
  app.addHook('onRequest', requestTimeoutHook);
  app.addHook('onResponse', requestTimeoutCleanupHook);
  app.addHook('onError', requestTimeoutCleanupHook);

  // Security headers
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');

    // HSTS only in production when served over HTTPS
    if (config.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  });

  // Request logging and metrics
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

    // Record metrics if enabled
    if (config.METRICS_ENABLED) {
      incrementApiRequestCounter(req.method, req.url, reply.statusCode);
      observeApiRequestDuration(req.url, duration / 1000); // Convert ms to seconds
    }

    done();
  });

  // Register loggers for modules
  registerLoggers(app);

  const pool = new BrowserPool(
    config.BROWSER_POOL_SIZE,
    config.MAX_RENDERS_PER_CONTEXT,
    config.CIRCUIT_BREAKER_THRESHOLD
  );
  if (!opts?.skipBrowserInit) {
    await pool.init();
  }

  const cache = new RenderCache(config.REDIS_URL, config.STORAGE_PATH, config.CACHE_TTL_SECONDS);
  const rateLimiter = new SlidingWindowRateLimiter(config.REDIS_URL);

  const storageLifecycle = new StorageLifecycleManager({
    storagePath: config.STORAGE_PATH,
    retentionDays: config.STORAGE_RETENTION_DAYS,
    logger: app.log.child({ module: 'storage' }),
  });

  const startTime = Date.now();

  // API docs (register before routes so swagger captures all endpoints)
  await registerDocs(app);
  await errorCodesRoutes(app);

  app.get('/v1/health', {
    schema: {
      tags: ['health'],
      summary: 'Detailed health check',
      description: 'Returns detailed health status including browser pool and queue metrics.',
    },
  }, async (req, reply) => {
    if (shuttingDown) {
      reply.status(503);
      return {
        status: 'shutting_down',
        timestamp: new Date().toISOString(),
      };
    }

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

  app.get('/health', {
    schema: {
      tags: ['health'],
      summary: 'Basic health check',
      description: 'Returns basic health status.',
    },
  }, async (req, reply) => {
    if (shuttingDown) {
      reply.status(503);
      return { status: 'shutting_down', timestamp: new Date().toISOString() };
    }
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Prometheus metrics endpoint
  if (config.METRICS_ENABLED) {
    app.get('/metrics', {
      preHandler: config.METRICS_AUTH_REQUIRED ? [authMiddleware] : [],
    }, async (req, reply) => {
      const metrics = await getMetrics();
      reply.type('text/plain; version=0.0.4; charset=utf-8');
      return metrics;
    });
  }

  // Favicon (SVG)
  const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#4f46e5"/><text x="16" y="22" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="700" fill="#fff" text-anchor="middle">SF</text></svg>`;
  app.get('/favicon.ico', async (_req, reply) => {
    reply.type('image/svg+xml').header('Cache-Control', 'public, max-age=86400').send(faviconSvg);
  });

  // Landing page & auth
  await landingRoutes(app);
  await authRoutes(app);
  await dashboardRoutes(app);
  await billingRoutes(app);
  await adminPanelRoutes(app);
  await legalRoutes(app);
  await playgroundRoutes(app);
  await docsSiteRoutes(app);

  // Register API routes
  await renderRoutes(app, pool, cache, rateLimiter);
  await signedRoutes(app, rateLimiter);
  await adminRoutes(app);
  await usageRoutes(app);
  await asyncRenderRoutes(app);
  await batchRoutes(app);
  await ogRoutes(app, pool, cache);
  await webhooksRoutes(app);
  await analyticsRoutes(app);

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

  // Graceful shutdown function
  const gracefulShutdown = async (): Promise<void> => {
    // Idempotency: if shutdown already in progress, return the existing promise
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      shuttingDown = true;
      const logger = app.log.child({ module: 'shutdown' });
      logger.info('Graceful shutdown initiated');

      // Stop accepting new connections (only if server is listening)
      if (app.server && app.server.listening) {
        try {
          await new Promise<void>((resolve, reject) => {
            app.server.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          logger.info('Server stopped accepting new connections');
        } catch (err) {
          logger.error({ err }, 'Error closing server');
        }
      }

      // Wait for in-flight renders with timeout
      const shutdownTimeout = config.GRACEFUL_SHUTDOWN_TIMEOUT_MS;
      const startWait = Date.now();
      while (inflightRenders > 0 && Date.now() - startWait < shutdownTimeout) {
        logger.info({ inflightRenders }, 'Waiting for in-flight renders to complete');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (inflightRenders > 0) {
        logger.warn({ inflightRenders }, 'Shutdown timeout reached with renders still in flight');
      } else {
        logger.info('All in-flight renders completed');
      }

      // Close resources (wrap each in try-catch so one failure doesn't block others)
      const closeResources = [
        { name: 'storage lifecycle', fn: () => storageLifecycle.stop() },
        { name: 'browser pool', fn: () => pool.close() },
        { name: 'render cache', fn: () => cache.close() },
        { name: 'rate limiter', fn: () => rateLimiter.close() },
        { name: 'render queue', fn: () => closeQueue() },
        { name: 'webhook queue', fn: () => closeWebhookQueue() },
        { name: 'usage monitor', fn: () => closeUsageMonitor() },
        { name: 'database pool', fn: () => closePool() },
      ];

      for (const resource of closeResources) {
        try {
          await resource.fn();
          logger.info(`Closed ${resource.name}`);
        } catch (err) {
          logger.error({ err, resource: resource.name }, `Error closing ${resource.name}`);
        }
      }

      logger.info('Graceful shutdown complete');
    })();

    return shutdownPromise;
  };

  // Helper functions for tracking in-flight renders
  const incrementInflightRenders = () => {
    inflightRenders++;
  };

  const decrementInflightRenders = () => {
    inflightRenders--;
  };

  // Delegate onClose to gracefulShutdown (idempotent — safe if already called)
  app.addHook('onClose', async () => {
    await gracefulShutdown();
  });

  app.decorate('browserPool', pool);
  app.decorate('renderCache', cache);
  app.decorate('storageLifecycle', storageLifecycle);
  app.decorate('gracefulShutdown', gracefulShutdown);
  app.decorate('incrementInflightRenders', incrementInflightRenders);
  app.decorate('decrementInflightRenders', decrementInflightRenders);

  return app;
}

export async function start() {
  const config = loadConfig();
  const app = await buildServer();

  // Start queue worker so async/batch jobs are processed
  const browserPool = app.browserPool;
  await mkdir(config.STORAGE_PATH, { recursive: true });
  const queueLogger = getLogger('queue');

  // Start render worker
  const worker = createWorker(config.REDIS_URL, async (job: Job<RenderJobData, RenderJobResult>) => {
    const { type, url, options } = job.data;
    const start = performance.now();

    // Build schema input from options; only inject url if options doesn't already have url or html
    const schemaInput = (options.url || options.html) ? { ...options } : { url, ...options };

    if (type === 'pdf') {
      const parsed = pdfOptionsSchema.parse(schemaInput);
      const result = await renderPdf(browserPool, parsed, config.NAVIGATION_TIMEOUT_MS);
      const filePath = join(config.STORAGE_PATH, `${job.data.jobId}.pdf`);
      await writeFile(filePath, result.buffer);
      return {
        resultPath: filePath,
        contentType: result.contentType,
        durationMs: result.durationMs,
        metadata: result.metadata,
      };
    }

    // Default: screenshot (including og type)
    const parsed = screenshotOptionsSchema.parse(schemaInput);
    const result = await takeScreenshot(browserPool, parsed, config.NAVIGATION_TIMEOUT_MS);
    const ext = parsed.format === 'jpeg' ? 'jpg' : 'png';
    const filePath = join(config.STORAGE_PATH, `${job.data.jobId}.${ext}`);
    await writeFile(filePath, result.buffer);
    return {
      resultPath: filePath,
      contentType: result.contentType,
      durationMs: Math.round(performance.now() - start),
      metadata: result.metadata,
    };
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

  // Start usage monitor (hourly quota check)
  createUsageMonitor(config.REDIS_URL);

  // Start storage lifecycle manager (hourly cleanup)
  const lifecycle = (app as unknown as { storageLifecycle?: StorageLifecycleManager }).storageLifecycle;
  if (lifecycle) {
    lifecycle.start();
  }

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Register graceful shutdown handlers
  const gracefulShutdown = app.gracefulShutdown;
  process.once('SIGTERM', async () => {
    app.log.info('SIGTERM received, initiating graceful shutdown');
    await gracefulShutdown();
    process.exit(0);
  });

  process.once('SIGINT', async () => {
    app.log.info('SIGINT received, initiating graceful shutdown');
    await gracefulShutdown();
    process.exit(0);
  });
}

const isMainModule = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (isMainModule) {
  start();
}
