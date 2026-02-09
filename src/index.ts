import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config/index.js';

export async function buildServer() {
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

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

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
