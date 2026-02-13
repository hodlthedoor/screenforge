import { describe, it, expect, beforeAll } from 'vitest';
import {
  initMetrics,
  getMetrics,
  incrementRenderCounter,
  observeRenderDuration,
  incrementApiRequestCounter,
  observeApiRequestDuration,
  incrementWebhookDeliveryCounter,
  updateQueueDepthGauge,
  updateBrowserPoolGauges,
  updateCacheGauges,
} from '../../src/metrics/index.js';

describe('metrics', () => {
  beforeAll(() => {
    initMetrics();
  });

  describe('initMetrics', () => {
    it('initializes without errors', () => {
      // initMetrics() should be idempotent
      expect(() => initMetrics()).not.toThrow();
    });
  });

  describe('getMetrics', () => {
    it('returns prometheus formatted metrics', async () => {
      const result = await getMetrics();

      expect(result).toContain('# TYPE');
      expect(result).toContain('screenforge_renders_total');
      expect(typeof result).toBe('string');
    });
  });

  describe('render metrics', () => {
    it('increments render counter with labels', async () => {
      incrementRenderCounter('screenshot', 'png', 'completed', true);
      incrementRenderCounter('screenshot', 'png', 'completed', false);
      incrementRenderCounter('pdf', 'pdf', 'failed', false);

      const metrics = await getMetrics();
      expect(metrics).toContain('screenforge_renders_total');
    });

    it('observes render duration with labels', async () => {
      observeRenderDuration('screenshot', 'png', 1.5);
      observeRenderDuration('pdf', 'pdf', 3.2);

      const metrics = await getMetrics();
      expect(metrics).toContain('screenforge_render_duration_seconds');
    });
  });

  describe('API request metrics', () => {
    it('increments API request counter with labels', async () => {
      incrementApiRequestCounter('GET', '/v1/screenshot', 200);
      incrementApiRequestCounter('POST', '/v1/async/screenshot', 202);
      incrementApiRequestCounter('GET', '/v1/render/123', 404);

      const metrics = await getMetrics();
      expect(metrics).toContain('screenforge_api_requests_total');
    });

    it('observes API request duration with labels', async () => {
      observeApiRequestDuration('/v1/screenshot', 0.15);
      observeApiRequestDuration('/v1/async/screenshot', 0.05);

      const metrics = await getMetrics();
      expect(metrics).toContain('screenforge_api_request_duration_seconds');
    });
  });

  describe('webhook metrics', () => {
    it('increments webhook delivery counter with status', async () => {
      incrementWebhookDeliveryCounter('success');
      incrementWebhookDeliveryCounter('success');
      incrementWebhookDeliveryCounter('failed');

      const metrics = await getMetrics();
      expect(metrics).toContain('screenforge_webhook_deliveries_total');
    });
  });

  describe('queue depth gauge', () => {
    it('updates queue depth for different statuses', async () => {
      updateQueueDepthGauge('waiting', 10);
      updateQueueDepthGauge('active', 3);
      updateQueueDepthGauge('delayed', 2);
      updateQueueDepthGauge('failed', 1);

      const metrics = await getMetrics();
      expect(metrics).toContain('screenforge_queue_depth');
    });
  });

  describe('browser pool gauges', () => {
    it('updates browser pool active and available counts', async () => {
      updateBrowserPoolGauges(2, 3);

      const metrics = await getMetrics();
      expect(metrics).toContain('screenforge_browser_pool_active');
      expect(metrics).toContain('screenforge_browser_pool_available');
    });
  });

  describe('cache gauges', () => {
    it('updates cache entries and size', async () => {
      updateCacheGauges(150, 1024 * 1024 * 50);

      const metrics = await getMetrics();
      expect(metrics).toContain('screenforge_cache_entries');
      expect(metrics).toContain('screenforge_cache_size_bytes');
    });
  });
});
