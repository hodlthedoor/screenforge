import { chromium, type Browser, type BrowserContext, type BrowserContextOptions } from 'playwright';
import { updateBrowserPoolGauge } from '../metrics/index.js';

interface PoolEntry {
  browser: Browser;
  renderCount: number;
}

export interface BrowserPoolStats {
  poolSize: number;
  activeBrowsers: number;
  totalRenders: number;
}

export class BrowserPool {
  private pool: PoolEntry[] = [];
  private roundRobin = 0;
  private totalRenders = 0;
  private inUseContexts = 0;
  private readonly maxPoolSize: number;
  private readonly maxRendersPerContext: number;
  private initialized = false;

  constructor(maxPoolSize = 3, maxRendersPerContext = 100) {
    this.maxPoolSize = maxPoolSize;
    this.maxRendersPerContext = maxRendersPerContext;
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

    return context;
  }

  stats(): BrowserPoolStats {
    return {
      poolSize: this.maxPoolSize,
      activeBrowsers: this.pool.length,
      totalRenders: this.totalRenders,
    };
  }

  private updateMetrics(): void {
    updateBrowserPoolGauge(this.pool.length, this.inUseContexts);
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
