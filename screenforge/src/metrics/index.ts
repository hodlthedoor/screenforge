import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

let metricsInitialized = false;

// Known route patterns for normalization (prevents unbounded cardinality)
const ROUTE_PATTERNS: Array<{ pattern: RegExp; normalized: string }> = [
  { pattern: /^\/v1\/render\/[^/]+$/, normalized: '/v1/render/:id' },
  { pattern: /^\/v1\/batch\/[^/]+$/, normalized: '/v1/batch/:id' },
  { pattern: /^\/v1\/signed\/screenshot/, normalized: '/v1/signed/screenshot' },
  { pattern: /^\/v1\/signed\/pdf/, normalized: '/v1/signed/pdf' },
  { pattern: /^\/v1\/billing\/portal/, normalized: '/v1/billing/portal' },
  { pattern: /^\/v1\/billing\/checkout/, normalized: '/v1/billing/checkout' },
  { pattern: /^\/v1\/billing\/webhook/, normalized: '/v1/billing/webhook' },
];

export function normalizeRoute(url: string): string {
  // Strip query string
  const path = url.split('?')[0];

  // Check known patterns with dynamic segments
  for (const { pattern, normalized } of ROUTE_PATTERNS) {
    if (pattern.test(path)) return normalized;
  }

  // Static /v1/* routes pass through as-is
  if (path.startsWith('/v1/')) return path;

  // Non-API routes are grouped to prevent cardinality explosion
  return 'other';
}

export function initMetrics(): void {
  if (metricsInitialized) {
    return;
  }

  collectDefaultMetrics({ register });

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

  new Gauge({
    name: 'screenforge_queue_depth',
    help: 'Number of jobs in the queue by status',
    labelNames: ['status'],
    registers: [register],
  });

  // Single gauge with state label: "total" (pool size) and "in_use" (contexts currently checked out)
  new Gauge({
    name: 'screenforge_browser_pool_browsers',
    help: 'Browser pool size by state',
    labelNames: ['state'],
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

  new Counter({
    name: 'screenforge_storage_reclaimed_bytes_total',
    help: 'Total bytes reclaimed by storage lifecycle cleanup',
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
  rawUrl: string,
  statusCode: number
): void {
  const counter = register.getSingleMetric('screenforge_api_requests_total') as Counter<string>;
  if (counter) {
    counter.inc({ method, route: normalizeRoute(rawUrl), status_code: statusCode.toString() });
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

export function observeApiRequestDuration(rawUrl: string, durationSeconds: number): void {
  const histogram = register.getSingleMetric('screenforge_api_request_duration_seconds') as Histogram<string>;
  if (histogram) {
    histogram.observe({ route: normalizeRoute(rawUrl) }, durationSeconds);
  }
}

// Gauge helpers
export function updateQueueDepthGauge(status: string, count: number): void {
  const gauge = register.getSingleMetric('screenforge_queue_depth') as Gauge<string>;
  if (gauge) {
    gauge.set({ status }, count);
  }
}

export function updateBrowserPoolGauge(total: number, inUse: number): void {
  const gauge = register.getSingleMetric('screenforge_browser_pool_browsers') as Gauge<string>;
  if (gauge) {
    gauge.set({ state: 'total' }, total);
    gauge.set({ state: 'in_use' }, inUse);
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

export function incrementStorageReclaimedBytes(bytes: number): void {
  const counter = register.getSingleMetric('screenforge_storage_reclaimed_bytes_total') as Counter<string>;
  if (counter) {
    counter.inc(bytes);
  }
}
