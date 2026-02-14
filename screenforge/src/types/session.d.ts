import 'fastify';
import type { User } from '../db/users.js';
import type { BrowserPool } from '../renderer/browser-pool.js';
import type { RenderCache } from '../cache/index.js';
import type { StorageLifecycleManager } from '../storage/lifecycle.js';

declare module 'fastify' {
  interface Session {
    userId?: string;
    flash?: Record<string, string>;
    csrfToken?: string;
  }
  interface FastifyRequest {
    dashboardUser?: User;
    renderAbortController?: AbortController;
    // eslint-disable-next-line no-undef
    renderAbortSignal?: AbortSignal;
    // eslint-disable-next-line no-undef
    renderTimeoutId?: NodeJS.Timeout;
  }
  interface FastifyInstance {
    browserPool: BrowserPool;
    renderCache: RenderCache;
    storageLifecycle: StorageLifecycleManager;
    gracefulShutdown: () => Promise<void>;
    incrementInflightRenders: () => void;
    decrementInflightRenders: () => void;
  }
}
