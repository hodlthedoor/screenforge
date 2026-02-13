import type { FastifyInstance } from 'fastify';
import type { FastifyBaseLogger } from 'fastify';

type ModuleName = 'renderer' | 'queue' | 'cache' | 'auth' | 'billing' | 'email';

let appLogger: FastifyBaseLogger | null = null;

export function registerLoggers(app: FastifyInstance): void {
  appLogger = app.log;
}

export function getLogger(module: ModuleName): FastifyBaseLogger {
  if (!appLogger) {
    throw new Error('Loggers not registered. Call registerLoggers(app) first.');
  }
  return appLogger.child({ module });
}
