import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

type ModuleName = 'renderer' | 'queue' | 'cache' | 'auth' | 'billing';

let appLogger: Logger | null = null;

export function registerLoggers(app: FastifyInstance): void {
  appLogger = app.log;
}

export function getLogger(module: ModuleName): Logger {
  if (!appLogger) {
    throw new Error('Loggers not registered. Call registerLoggers(app) first.');
  }
  return appLogger.child({ module });
}
