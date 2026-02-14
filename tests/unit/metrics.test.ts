import { describe, it, expect, beforeAll } from 'vitest';
import {
  initMetrics,
  getMetrics,
  normalizeRoute,
  incrementRenderCounter,
  observeRenderDuration,
  incrementApiRequestCounter,
  observeApiRequestDuration,
  incrementWebhookDeliveryCounter,
  updateQueueDepthGauge,
  updateBrowserPoolGauge,
  updateCacheGauges,
  incrementStorageReclaimedBytes,
  incrementRenderTimeouts,
  setCircuitBreakerState,
} from '../../src/metrics/index.js';

describe('metrics', () => {
  beforeAll(() => {
    initMetrics();
  });

  describe('normalizeRoute', () => {
    it('normalizes dynamic render ID routes', () => {
      expect(normalizeRoute('/v1/render/abc-123-def')).toBe('/v1/render/:id');
      expect(normalizeRoute('/v1/render/550e8400-e29b-41d4-a716-446655440000')).toBe('/v1/render/:id');
    });

    it('normalizes dynamic batch ID routes', () => {
      expect(normalizeRoute('/v1/batch/abc-123')).toBe('/v1/batch/:id');
    });

    it('strips query strings before matching', () => {
      expect(normalizeRoute('/v1/render/abc?format=json')).toBe('/v1/render/:id');
      expect(normalizeRoute('/v1/screenshot?async=true')).toBe('/v1/screenshot');
    });

    it('passes through static /v1 routes as-is', () => {
      expect(normalizeRoute('/v1/screenshot')).toBe('/v1/screenshot');
      expect(normalizeRoute('/v1/pdf')).toBe('/v1/pdf');
      expect(normalizeRoute('/v1/og')).toBe('/v1/og');
      expect(normalizeRoute('/v1/usage')).toBe('/v1/usage');
      expect(normalizeRoute('/v1/keys')).toBe('/v1/keys');
      expect(normalizeRoute('/v1/health')).toBe('/v1/health');
    });

    it('groups non-API routes as "other"', () => {
      expect(normalizeRoute('/dashboard')).toBe('other');
      expect(normalizeRoute('/login')).toBe('other');
      expect(normalizeRoute('/admin/users/123')).toBe('other');
      expect(normalizeRoute('/')).toBe('other');
    });

    it('normalizes signed routes', () => {
      expect(normalizeRoute('/v1/signed/screenshot?token=abc&url=http://example.com')).toBe('/v1/signed/screenshot');
      expect(normalizeRoute('/v1/signed/pdf?token=xyz')).toBe('/v1/signed/pdf');
    });
  });

  describe('initMetrics', () => {
    it('initializes without errors and is idempotent', () => {
      expect(() => initMetrics()).not.toThrow();
    });
  });

  describe('getMetrics', () => {
    it('returns prometheus formatted metrics with correct types', async () => {
      const result = await getMetrics();

      expect(result).toContain('# TYPE screenforge_renders_total counter');
      expect(result).toContain('# TYPE screenforge_api_requests_total counter');
      expect(result).toContain('# TYPE screenforge_render_duration_seconds histogram');
      expect(result).toContain('# TYPE screenforge_browser_pool_browsers gauge');
      expect(result).toContain('# TYPE screenforge_cache_entries gauge');
      expect(result).toContain('# TYPE screenforge_cache_size_bytes gauge');
      expect(result).toContain('# TYPE screenforge_storage_reclaimed_bytes_total counter');
      expect(result).toContain('# TYPE screenforge_render_timeouts_total counter');
      expect(result).toContain('# TYPE screenforge_circuit_breaker_state gauge');
    });
  });

  describe('render metrics', () => {
    it('increments render counter with correct label values', async () => {
      incrementRenderCounter('screenshot', 'png', 'completed', true);
      incrementRenderCounter('screenshot', 'png', 'completed', true);
      incrementRenderCounter('pdf', 'pdf', 'failed', false);

      const metrics = await getMetrics();
      expect(metrics).toMatch(
        /screenforge_renders_total\{type="screenshot",format="png",status="completed",cache_hit="true"\}\s+\d+/
      );
      expect(metrics).toMatch(
        /screenforge_renders_total\{type="pdf",format="pdf",status="failed",cache_hit="false"\}\s+\d+/
      );
    });

    it('observes render duration and records sum/count', async () => {
      observeRenderDuration('screenshot', 'png', 1.5);
      observeRenderDuration('screenshot', 'png', 0.3);

      const metrics = await getMetrics();
      expect(metrics).toMatch(
        /screenforge_render_duration_seconds_sum\{type="screenshot",format="png"\}\s+[\d.]+/
      );
      expect(metrics).toMatch(
        /screenforge_render_duration_seconds_count\{type="screenshot",format="png"\}\s+\d+/
      );
    });
  });

  describe('API request metrics', () => {
    it('normalizes routes in counter labels', async () => {
      incrementApiRequestCounter('GET', '/v1/render/abc-123', 200);
      incrementApiRequestCounter('GET', '/v1/render/def-456', 200);
      incrementApiRequestCounter('POST', '/v1/screenshot', 200);

      const metrics = await getMetrics();
      // Both render/:id calls should be collapsed into normalized route
      expect(metrics).toMatch(
        /screenforge_api_requests_total\{method="GET",route="\/v1\/render\/:id",status_code="200"\}\s+\d+/
      );
      expect(metrics).toMatch(
        /screenforge_api_requests_total\{method="POST",route="\/v1\/screenshot",status_code="200"\}\s+\d+/
      );
    });

    it('normalizes routes in duration histogram', async () => {
      observeApiRequestDuration('/v1/render/abc-123', 0.15);
      observeApiRequestDuration('/v1/render/def-456', 0.25);

      const metrics = await getMetrics();
      expect(metrics).toMatch(
        /screenforge_api_request_duration_seconds_sum\{route="\/v1\/render\/:id"\}\s+[\d.]+/
      );
      expect(metrics).toMatch(
        /screenforge_api_request_duration_seconds_count\{route="\/v1\/render\/:id"\}\s+\d+/
      );
    });
  });

  describe('webhook metrics', () => {
    it('increments webhook counter with correct labels', async () => {
      incrementWebhookDeliveryCounter('success');
      incrementWebhookDeliveryCounter('success');
      incrementWebhookDeliveryCounter('failed');

      const metrics = await getMetrics();
      expect(metrics).toMatch(
        /screenforge_webhook_deliveries_total\{status="success"\}\s+\d+/
      );
      expect(metrics).toMatch(
        /screenforge_webhook_deliveries_total\{status="failed"\}\s+\d+/
      );
    });
  });

  describe('queue depth gauge', () => {
    it('sets queue depth to exact values per status', async () => {
      updateQueueDepthGauge('waiting', 10);
      updateQueueDepthGauge('active', 3);
      updateQueueDepthGauge('failed', 1);

      const metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_queue_depth\{status="waiting"\}\s+10/);
      expect(metrics).toMatch(/screenforge_queue_depth\{status="active"\}\s+3/);
      expect(metrics).toMatch(/screenforge_queue_depth\{status="failed"\}\s+1/);
    });

    it('overwrites previous values on update', async () => {
      updateQueueDepthGauge('waiting', 10);
      updateQueueDepthGauge('waiting', 5);

      const metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_queue_depth\{status="waiting"\}\s+5/);
      expect(metrics).not.toMatch(/screenforge_queue_depth\{status="waiting"\}\s+10/);
    });
  });

  describe('browser pool gauge', () => {
    it('reports total and in_use via single gauge with state label', async () => {
      updateBrowserPoolGauge(3, 1);

      const metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_browser_pool_browsers\{state="total"\}\s+3/);
      expect(metrics).toMatch(/screenforge_browser_pool_browsers\{state="in_use"\}\s+1/);
    });

    it('updates in_use independently', async () => {
      updateBrowserPoolGauge(3, 0);
      let metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_browser_pool_browsers\{state="in_use"\}\s+0/);

      updateBrowserPoolGauge(3, 2);
      metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_browser_pool_browsers\{state="in_use"\}\s+2/);
    });
  });

  describe('cache gauges', () => {
    it('sets cache entries and size to exact values', async () => {
      updateCacheGauges(150, 52428800); // 50MB

      const metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_cache_entries\s+150/);
      expect(metrics).toMatch(/screenforge_cache_size_bytes\s+52428800/);
    });

    it('allows cache size to decrease (gauge, not counter)', async () => {
      updateCacheGauges(100, 1000000);
      updateCacheGauges(80, 800000);

      const metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_cache_entries\s+80/);
      expect(metrics).toMatch(/screenforge_cache_size_bytes\s+800000/);
    });
  });

  describe('storage lifecycle metrics', () => {
    it('increments storage reclaimed bytes counter', async () => {
      incrementStorageReclaimedBytes(1024);
      incrementStorageReclaimedBytes(2048);

      const metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_storage_reclaimed_bytes_total\s+\d+/);
    });

    it('allows zero bytes to be tracked', async () => {
      incrementStorageReclaimedBytes(0);

      const metrics = await getMetrics();
      // Should still emit the counter even with 0
      expect(metrics).toContain('screenforge_storage_reclaimed_bytes_total');
    });
  });

  describe('timeout metrics', () => {
    it('increments render timeout counter', async () => {
      incrementRenderTimeouts();
      incrementRenderTimeouts();

      const metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_render_timeouts_total\s+\d+/);
    });
  });

  describe('circuit breaker metrics', () => {
    it('is serialized at init with default value 0', async () => {
      const metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_circuit_breaker_state\s+0/);
    });

    it('sets circuit breaker state gauge', async () => {
      setCircuitBreakerState(0); // Closed
      let metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_circuit_breaker_state\s+0/);

      setCircuitBreakerState(1); // Half-open
      metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_circuit_breaker_state\s+1/);

      setCircuitBreakerState(2); // Open
      metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_circuit_breaker_state\s+2/);
    });

    it('overwrites previous state value', async () => {
      setCircuitBreakerState(2);
      setCircuitBreakerState(0);

      const metrics = await getMetrics();
      expect(metrics).toMatch(/screenforge_circuit_breaker_state\s+0/);
      expect(metrics).not.toMatch(/screenforge_circuit_breaker_state\s+2/);
    });
  });
});
