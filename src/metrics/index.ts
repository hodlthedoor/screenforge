import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

// Initialize default metrics (CPU, memory, event loop lag)
let metricsInitialized = false;

export function initMetrics(): void {
  if (metricsInitialized) {
    return;
  }

  // Default metrics (process CPU, memory, event loop lag)
  collectDefaultMetrics({ register });

  // Custom counters
  new Counter({
    name: 'screenforge_renders_total',
    help: 'Total number of render jobs processed',
    labelNames: ['type', 'format', 'status', 'cache_hit'],
    registers: [register],
  });

  new Counter({
    name: 'screenforge_api_requests_total',
    help: 'Total number of API requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  new Counter({
    name: 'screenforge_webhook_deliveries_total',
    help: 'Total number of webhook deliveries',
    labelNames: ['status'],
    registers: [register],
  });

  // Histograms
  new Histogram({
    name: 'screenforge_render_duration_seconds',
    help: 'Render job duration in seconds',
    labelNames: ['type', 'format'],
    buckets: [0.5, 1, 2, 5, 10, 30, 60],
    registers: [register],
  });

  new Histogram({
    name: 'screenforge_api_request_duration_seconds',
    help: 'API request duration in seconds',
    labelNames: ['route'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [register],
  });

  // Gauges
  new Gauge({
    name: 'screenforge_queue_depth',
    help: 'Number of jobs in the queue by status',
    labelNames: ['status'],
    registers: [register],
  });

  new Gauge({
    name: 'screenforge_browser_pool_active',
    help: 'Number of active browsers in the pool',
    registers: [register],
  });

  new Gauge({
    name: 'screenforge_browser_pool_available',
    help: 'Number of available browsers in the pool',
    registers: [register],
  });

  new Gauge({
    name: 'screenforge_cache_entries',
    help: 'Number of entries in the cache',
    registers: [register],
  });

  new Gauge({
    name: 'screenforge_cache_size_bytes',
    help: 'Total size of cached files in bytes',
    registers: [register],
  });

  metricsInitialized = true;
}

export async function getMetrics(): Promise<string> {
  return register.metrics();
}

// Counter helpers
export function incrementRenderCounter(
  type: string,
  format: string,
  status: string,
  cacheHit: boolean
): void {
  const counter = register.getSingleMetric('screenforge_renders_total') as Counter<string>;
  if (counter) {
    counter.inc({ type, format, status, cache_hit: cacheHit.toString() });
  }
}

export function incrementApiRequestCounter(
  method: string,
  route: string,
  statusCode: number
): void {
  const counter = register.getSingleMetric('screenforge_api_requests_total') as Counter<string>;
  if (counter) {
    counter.inc({ method, route, status_code: statusCode.toString() });
  }
}

export function incrementWebhookDeliveryCounter(status: string): void {
  const counter = register.getSingleMetric('screenforge_webhook_deliveries_total') as Counter<string>;
  if (counter) {
    counter.inc({ status });
  }
}

// Histogram helpers
export function observeRenderDuration(type: string, format: string, durationSeconds: number): void {
  const histogram = register.getSingleMetric('screenforge_render_duration_seconds') as Histogram<string>;
  if (histogram) {
    histogram.observe({ type, format }, durationSeconds);
  }
}

export function observeApiRequestDuration(route: string, durationSeconds: number): void {
  const histogram = register.getSingleMetric('screenforge_api_request_duration_seconds') as Histogram<string>;
  if (histogram) {
    histogram.observe({ route }, durationSeconds);
  }
}

// Gauge helpers
export function updateQueueDepthGauge(status: string, count: number): void {
  const gauge = register.getSingleMetric('screenforge_queue_depth') as Gauge<string>;
  if (gauge) {
    gauge.set({ status }, count);
  }
}

export function updateBrowserPoolGauges(active: number, available: number): void {
  const activeGauge = register.getSingleMetric('screenforge_browser_pool_active') as Gauge<string>;
  const availableGauge = register.getSingleMetric('screenforge_browser_pool_available') as Gauge<string>;

  if (activeGauge) {
    activeGauge.set(active);
  }
  if (availableGauge) {
    availableGauge.set(available);
  }
}

export function updateCacheGauges(entries: number, sizeBytes: number): void {
  const entriesGauge = register.getSingleMetric('screenforge_cache_entries') as Gauge<string>;
  const sizeGauge = register.getSingleMetric('screenforge_cache_size_bytes') as Gauge<string>;

  if (entriesGauge) {
    entriesGauge.set(entries);
  }
  if (sizeGauge) {
    sizeGauge.set(sizeBytes);
  }
}
