import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';

describe('graceful shutdown', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS = '5000'; // Short timeout for tests
    app = await buildServer({ skipBrowserInit: true });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('health returns 503 during shutdown', async () => {
    // Start listening
    await app.listen({ port: 0, host: '127.0.0.1' });

    // Health should be ok initially
    const healthBefore = await app.inject({ method: 'GET', url: '/health' });
    expect(healthBefore.statusCode).toBe(200);
    expect(healthBefore.json()).toMatchObject({ status: 'ok' });

    // Trigger shutdown (this will be exported from index.ts)
    const shutdownFn = app.gracefulShutdown;
    expect(shutdownFn).toBeDefined();

    // Start shutdown (but don't await it)
    const shutdownPromise = shutdownFn();

    // Health should return 503 during shutdown
    const healthDuring = await app.inject({ method: 'GET', url: '/health' });
    expect(healthDuring.statusCode).toBe(503);
    expect(healthDuring.json()).toMatchObject({ status: 'shutting_down' });

    // Wait for shutdown to complete
    await shutdownPromise;
  });

  it('v1 health returns 503 during shutdown', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });

    const healthBefore = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(healthBefore.statusCode).toBe(200);
    expect(healthBefore.json()).toMatchObject({ status: 'ok' });

    const shutdownPromise = app.gracefulShutdown();

    const healthDuring = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(healthDuring.statusCode).toBe(503);
    expect(healthDuring.json()).toMatchObject({ status: 'shutting_down' });

    await shutdownPromise;
  });

  it('in-flight renders complete before shutdown finishes', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });

    // Simulate an in-flight render by incrementing the counter
    const incrementInflight = app.incrementInflightRenders;
    const decrementInflight = app.decrementInflightRenders;
    expect(incrementInflight).toBeDefined();
    expect(decrementInflight).toBeDefined();

    incrementInflight();

    const shutdownPromise = app.gracefulShutdown();

    // Give shutdown a moment to start
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Shutdown should still be waiting
    let shutdownCompleted = false;
    shutdownPromise.then(() => {
      shutdownCompleted = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(shutdownCompleted).toBe(false);

    // Complete the render
    decrementInflight();

    // Now shutdown should complete
    await shutdownPromise;
    expect(shutdownCompleted).toBe(true);
  });

  it('shutdown proceeds after timeout even with in-flight renders', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });

    app.incrementInflightRenders();

    const startTime = Date.now();

    // Shutdown should timeout after GRACEFUL_SHUTDOWN_TIMEOUT_MS (5000ms in test)
    await app.gracefulShutdown();

    const elapsed = Date.now() - startTime;
    // Should have waited close to the timeout (allow some variance)
    expect(elapsed).toBeGreaterThanOrEqual(4900);
    expect(elapsed).toBeLessThan(6000);
  });

  it('connections and resources are closed', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });

    // Spy on close methods
    const poolCloseSpy = vi.spyOn(app.browserPool, 'close');
    const cacheCloseSpy = vi.spyOn(app.renderCache, 'close');

    await app.gracefulShutdown();

    // All close methods should have been called
    expect(poolCloseSpy).toHaveBeenCalledOnce();
    expect(cacheCloseSpy).toHaveBeenCalledOnce();
  });

  it('multiple shutdown calls are idempotent', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });

    const poolCloseSpy = vi.spyOn(app.browserPool, 'close');

    // Call shutdown multiple times
    await Promise.all([app.gracefulShutdown(), app.gracefulShutdown(), app.gracefulShutdown()]);

    // Close should only be called once
    expect(poolCloseSpy).toHaveBeenCalledOnce();
  });

  it('shutdown handles errors during resource cleanup', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });

    // Make pool.close throw an error, but cache.close succeeds
    const poolCloseSpy = vi.spyOn(app.browserPool, 'close').mockRejectedValue(new Error('Pool close failed'));
    const cacheCloseSpy = vi.spyOn(app.renderCache, 'close').mockResolvedValue(undefined);

    // Shutdown should not throw, should log the error and continue
    await expect(app.gracefulShutdown()).resolves.toBeUndefined();

    // Both close methods should have been called despite the error
    expect(poolCloseSpy).toHaveBeenCalledOnce();
    expect(cacheCloseSpy).toHaveBeenCalledOnce();

    // Clear mocks to prevent issues in afterEach
    poolCloseSpy.mockRestore();
    cacheCloseSpy.mockRestore();
  });
});
