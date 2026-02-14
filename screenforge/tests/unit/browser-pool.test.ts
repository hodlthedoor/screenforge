import { describe, it, expect, afterEach } from 'vitest';
import { BrowserPool } from '../../src/renderer/browser-pool.js';

describe('BrowserPool', { timeout: 60_000 }, () => {
  let pool: BrowserPool;

  afterEach(async () => {
    if (pool) {
      await pool.close();
    }
  });

  it('initializes with correct pool size', async () => {
    pool = new BrowserPool(2, 100);
    await pool.init();
    const stats = pool.stats();
    expect(stats.poolSize).toBe(2);
    expect(stats.activeBrowsers).toBe(2);
    expect(stats.totalRenders).toBe(0);
  });

  it('throws if acquire called before init', async () => {
    pool = new BrowserPool(1, 100);
    await expect(pool.acquire()).rejects.toThrow('BrowserPool not initialized');
  });

  it('acquires a browser context', async () => {
    pool = new BrowserPool(1, 100);
    await pool.init();
    const ctx = await pool.acquire();
    expect(ctx).toBeDefined();
    await ctx.close();
    expect(pool.stats().totalRenders).toBe(1);
  });

  it('round-robins across browsers', async () => {
    pool = new BrowserPool(2, 100);
    await pool.init();
    const ctx1 = await pool.acquire();
    const ctx2 = await pool.acquire();
    const ctx3 = await pool.acquire();
    expect(pool.stats().totalRenders).toBe(3);
    await ctx1.close();
    await ctx2.close();
    await ctx3.close();
  });

  it('recycles browser after max renders', async () => {
    pool = new BrowserPool(1, 2);
    await pool.init();

    const ctx1 = await pool.acquire();
    await ctx1.close();
    const ctx2 = await pool.acquire();
    await ctx2.close();

    // Third acquire should trigger recycle (renderCount was 2 >= maxRendersPerContext 2)
    const ctx3 = await pool.acquire();
    await ctx3.close();
    expect(pool.stats().totalRenders).toBe(3);
  });

  it('closes all browsers', async () => {
    pool = new BrowserPool(2, 100);
    await pool.init();
    expect(pool.stats().activeBrowsers).toBe(2);
    await pool.close();
    expect(pool.stats().activeBrowsers).toBe(0);
  });

  it('init is idempotent', async () => {
    pool = new BrowserPool(1, 100);
    await pool.init();
    await pool.init(); // Should not add more browsers
    expect(pool.stats().activeBrowsers).toBe(1);
  });

  it('rejects acquire when circuit breaker is open', async () => {
    pool = new BrowserPool(1, 100, 2); // threshold = 2
    await pool.init();

    // Simulate 2 failures to open circuit
    pool.recordAcquireFailure();
    pool.recordAcquireFailure();

    await expect(pool.acquire()).rejects.toThrow('Circuit breaker is open');
  });

  it('records success on successful acquire', async () => {
    pool = new BrowserPool(1, 100, 3);
    await pool.init();

    // Record a failure
    pool.recordAcquireFailure();

    // Successful acquire should record success
    const ctx = await pool.acquire();
    await ctx.close();

    // Another failure should not open circuit (count reset)
    pool.recordAcquireFailure();
    pool.recordAcquireFailure();
    const ctx2 = await pool.acquire();
    await ctx2.close();
  });

  it('includes circuit breaker state in stats', async () => {
    pool = new BrowserPool(1, 100, 2);
    await pool.init();

    let stats = pool.stats();
    expect(stats.circuitBreakerState).toBe(0); // Closed

    pool.recordAcquireFailure();
    pool.recordAcquireFailure();

    stats = pool.stats();
    expect(stats.circuitBreakerState).toBe(2); // Open
  });
});
