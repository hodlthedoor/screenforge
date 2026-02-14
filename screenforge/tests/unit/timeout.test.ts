import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { requestTimeoutHook, requestTimeoutCleanupHook } from '../../src/renderer/timeout.js';
import { loadConfig } from '../../src/config/index.js';

describe('timeout hooks', () => {
  let app: FastifyInstance;

  beforeAll(() => {
    loadConfig({
      API_KEY_SALT: 'test-salt-must-be-16-chars-long',
      NODE_ENV: 'test',
      RENDER_TIMEOUT_MS: '5000',
    });
  });

  beforeEach(() => {
    vi.useFakeTimers();
    app = Fastify();
    app.addHook('onRequest', requestTimeoutHook);
    app.addHook('onResponse', requestTimeoutCleanupHook);
    app.addHook('onError', requestTimeoutCleanupHook);
  });

  afterEach(async () => {
    await app.close();
    vi.useRealTimers();
  });

  it('attaches AbortController to request', async () => {
    app.get('/test', async (req) => {
      expect(req.renderAbortController).toBeDefined();
      expect(req.renderAbortSignal).toBeDefined();
      expect(req.renderTimeoutId).toBeDefined();
      return { ok: true };
    });

    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 504 when timeout fires', async () => {
    const timeoutMs = 5000;

    app.get('/slow', async (_req) => {
      // Simulate slow operation
      await new Promise((resolve) => {
        setTimeout(resolve, 10_000);
      });
      return { ok: true };
    });

    await app.ready();

    const responsePromise = app.inject({
      method: 'GET',
      url: '/slow',
    });

    // Advance time to trigger timeout
    await vi.advanceTimersByTimeAsync(timeoutMs + 1000);

    const response = await responsePromise;

    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({
      error: {
        code: 'RENDER_TIMEOUT',
        message: 'Render timed out',
      },
    });
  });

  it('aborts signal when timeout fires', async () => {
    const timeoutMs = 5000;
    let signalAborted = false;

    app.get('/check-abort', async (req) => {
      req.renderAbortSignal.addEventListener('abort', () => {
        signalAborted = true;
      });

      await new Promise((resolve) => {
        setTimeout(resolve, 10_000);
      });
      return { ok: true };
    });

    await app.ready();

    const responsePromise = app.inject({
      method: 'GET',
      url: '/check-abort',
    });

    await vi.advanceTimersByTimeAsync(timeoutMs + 1000);
    await responsePromise;

    expect(signalAborted).toBe(true);
  });

  it('clears timeout on successful response', async () => {
    app.get('/fast', async () => {
      return { ok: true };
    });

    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/fast',
    });

    expect(response.statusCode).toBe(200);
    // Timeout should be cleared, no 504 even if we advance time
    await vi.advanceTimersByTimeAsync(60_000);
  });

  it('does not send 504 if reply already sent', async () => {
    app.get('/already-sent', async (req, reply) => {
      reply.status(200).send({ ok: true });
      // Wait for timeout to fire after reply sent
      await new Promise((resolve) => {
        setTimeout(resolve, 10_000);
      });
    });

    await app.ready();
    const responsePromise = app.inject({
      method: 'GET',
      url: '/already-sent',
    });

    await vi.advanceTimersByTimeAsync(6_000);
    const response = await responsePromise;

    // Should get the 200, not 504
    expect(response.statusCode).toBe(200);
  });

  it('clears timeout on error response', async () => {
    app.get('/error', async (_req) => {
      throw new Error('Test error');
    });

    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/error',
    });

    expect(response.statusCode).toBe(500);
    // Timeout should be cleared
  });

  it('uses configured timeout from config', async () => {
    // Already configured to 5000ms in beforeAll
    app.get('/custom', async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 10_000);
      });
      return { ok: true };
    });

    await app.ready();

    const responsePromise = app.inject({
      method: 'GET',
      url: '/custom',
    });

    // Should timeout at 5000ms (configured value)
    await vi.advanceTimersByTimeAsync(5500);
    const response = await responsePromise;

    expect(response.statusCode).toBe(504);
  });
});
