import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from 'playwright';
import { updateBrowserPoolGauge, setCircuitBreakerState } from '../metrics/index.js';
import { CircuitBreaker } from './circuit-breaker.js';

interface PoolEntry {
  browser: Browser;
  renderCount: number;
}

export interface BrowserPoolStats {
  poolSize: number;
  activeBrowsers: number;
  totalRenders: number;
  circuitBreakerState: number;
}

export class BrowserPool {
  private pool: PoolEntry[] = [];
  private roundRobin = 0;
  private totalRenders = 0;
  private inUseContexts = 0;
  private readonly maxPoolSize: number;
  private readonly maxRendersPerContext: number;
  private readonly circuitBreaker: CircuitBreaker;
  private initialized = false;

  constructor(
    maxPoolSize = 3,
    maxRendersPerContext = 100,
    circuitBreakerThreshold = 3,
    failureWindowMs = 60_000,
    cooldownMs = 30_000
  ) {
    this.maxPoolSize = maxPoolSize;
    this.maxRendersPerContext = maxRendersPerContext;
    this.circuitBreaker = new CircuitBreaker(
      circuitBreakerThreshold,
      failureWindowMs,
      cooldownMs
    );
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    for (let i = 0; i < this.maxPoolSize; i++) {
      const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      this.pool.push({ browser, renderCount: 0 });
    }
    this.initialized = true;
    this.updateMetrics();
  }

  async acquire(contextOptions?: BrowserContextOptions): Promise<BrowserContext> {
    if (!this.initialized) {
      throw new Error('BrowserPool not initialized. Call init() first.');
    }

    // Check circuit breaker
    if (!this.circuitBreaker.canRequest()) {
      this.updateMetrics();
      throw new Error('Circuit breaker is open');
    }

    // Mark probe attempt if in half-open state
    this.circuitBreaker.recordProbeAttempt();

    try {
      const entry = this.pool[this.roundRobin % this.pool.length];
      this.roundRobin = (this.roundRobin + 1) % this.pool.length;

      if (entry.renderCount >= this.maxRendersPerContext) {
        const newBrowser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        await entry.browser.close();
        entry.browser = newBrowser;
        entry.renderCount = 0;
      }

      entry.renderCount++;
      this.totalRenders++;
      this.inUseContexts++;
      this.updateMetrics();

      const context = await entry.browser.newContext(contextOptions);

      // Decrement in-use when context is closed
      context.on('close', () => {
        this.inUseContexts = Math.max(0, this.inUseContexts - 1);
        this.updateMetrics();
      });

      // Record success on successful context creation
      this.circuitBreaker.recordSuccess();
      this.updateMetrics();

      return context;
    } catch (error) {
      // Record failure if context creation fails
      this.circuitBreaker.recordFailure();
      this.updateMetrics();
      throw error;
    }
  }

  recordAcquireFailure(): void {
    this.circuitBreaker.recordFailure();
    this.updateMetrics();
  }

  stats(): BrowserPoolStats {
    return {
      poolSize: this.maxPoolSize,
      activeBrowsers: this.pool.length,
      totalRenders: this.totalRenders,
      circuitBreakerState: this.circuitBreaker.getState(),
    };
  }

  private updateMetrics(): void {
    updateBrowserPoolGauge(this.pool.length, this.inUseContexts);
    setCircuitBreakerState(this.circuitBreaker.getState() as 0 | 1 | 2);
  }

  async close(): Promise<void> {
    await Promise.all(this.pool.map((e) => e.browser.close()));
    this.pool = [];
    this.initialized = false;
    this.roundRobin = 0;
    this.totalRenders = 0;
    this.inUseContexts = 0;
    this.updateMetrics();
  }
}
