import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config/index.js';
import { BrowserPool } from './renderer/browser-pool.js';
import { RenderCache } from './cache/index.js';
import { renderRoutes } from './routes/render.js';

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

  const pool = new BrowserPool(config.BROWSER_POOL_SIZE, config.MAX_RENDERS_PER_CONTEXT);
  if (!opts?.skipBrowserInit) {
    await pool.init();
  }

  const cache = new RenderCache(config.REDIS_URL, config.STORAGE_PATH, config.CACHE_TTL_SECONDS);

  const startTime = Date.now();

  app.get('/v1/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    uptime: Math.round((Date.now() - startTime) / 1000),
    browserPool: pool.stats(),
    timestamp: new Date().toISOString(),
  }));

  // Keep legacy health endpoint
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  await renderRoutes(app, pool, cache);

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
  });

  // Expose for testing
  app.decorate('browserPool', pool);
  app.decorate('renderCache', cache);

  return app;
}

export async function start() {
  const config = loadConfig();
  const app = await buildServer();

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
