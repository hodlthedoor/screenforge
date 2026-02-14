import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

describe('gifOptionsSchema', () => {
  // We import lazily to allow the module to be created first
  let gifOptionsSchema: typeof import('../../src/renderer/schemas.js').gifOptionsSchema;

  beforeAll(async () => {
    const schemas = await import('../../src/renderer/schemas.js');
    gifOptionsSchema = schemas.gifOptionsSchema;
  });

  it('accepts valid minimal GIF options', () => {
    const result = gifOptionsSchema.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://example.com');
      expect(result.data.width).toBe(1280);
      expect(result.data.height).toBe(720);
      expect(result.data.duration).toBe(3);
      expect(result.data.fps).toBe(10);
      expect(result.data.darkMode).toBe(false);
      expect(result.data.deviceScaleFactor).toBe(1);
      expect(result.data.delay).toBe(0);
    }
  });

  it('accepts all GIF options', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      width: 800,
      height: 600,
      duration: 5,
      fps: 15,
      darkMode: true,
      deviceScaleFactor: 2,
      delay: 1000,
      actions: [{ type: 'click', selector: '#btn' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.width).toBe(800);
      expect(result.data.height).toBe(600);
      expect(result.data.duration).toBe(5);
      expect(result.data.fps).toBe(15);
      expect(result.data.darkMode).toBe(true);
      expect(result.data.deviceScaleFactor).toBe(2);
      expect(result.data.delay).toBe(1000);
      expect(result.data.actions).toHaveLength(1);
    }
  });

  it('rejects missing url', () => {
    const result = gifOptionsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid url protocol', () => {
    const result = gifOptionsSchema.safeParse({ url: 'file:///etc/passwd' });
    expect(result.success).toBe(false);
  });

  // Dimension limits
  it('rejects width above max (1280)', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      width: 1281,
    });
    expect(result.success).toBe(false);
  });

  it('rejects height above max (720)', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      height: 721,
    });
    expect(result.success).toBe(false);
  });

  it('rejects width below min (1)', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      width: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects height below min (1)', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      height: 0,
    });
    expect(result.success).toBe(false);
  });

  // Duration limits
  it('rejects duration above max (10)', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      duration: 11,
    });
    expect(result.success).toBe(false);
  });

  it('rejects duration below min (0.1)', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      duration: 0,
    });
    expect(result.success).toBe(false);
  });

  it('accepts fractional duration', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      duration: 1.5,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration).toBe(1.5);
    }
  });

  // FPS limits
  it('rejects fps above max (30)', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      fps: 31,
    });
    expect(result.success).toBe(false);
  });

  it('rejects fps below min (1)', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      fps: 0,
    });
    expect(result.success).toBe(false);
  });

  // Delay limits
  it('rejects negative delay', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      delay: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects delay above max (30000)', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      delay: 30001,
    });
    expect(result.success).toBe(false);
  });

  // Actions
  it('accepts actions', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      actions: [
        { type: 'click', selector: '#start' },
        { type: 'wait', value: '1000' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.actions).toHaveLength(2);
    }
  });

  it('rejects more than 10 actions', () => {
    const actions = Array.from({ length: 11 }, () => ({ type: 'wait' as const, value: '100' }));
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      actions,
    });
    expect(result.success).toBe(false);
  });

  // Content filter options
  it('accepts content filter options', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      block_ads: true,
      hide_cookies: true,
      hide_selectors: ['.banner'],
      custom_css: 'body { background: red; }',
    });
    expect(result.success).toBe(true);
  });

  // Emulation options
  it('accepts emulation options', () => {
    const result = gifOptionsSchema.safeParse({
      url: 'https://example.com',
      geolocation: { latitude: 51.5, longitude: -0.1 },
      timezone: 'Europe/London',
      locale: 'en-GB',
    });
    expect(result.success).toBe(true);
  });
});

describe('POST /v1/gif route', () => {
  let app: import('fastify').FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.ALLOW_PRIVATE_URLS = 'true';
    process.env.NODE_ENV = 'test';

    const { buildServer } = await import('../../src/index.js');
    app = await buildServer({ skipBrowserInit: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 400 for missing url', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gif',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for duration above max', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gif',
      payload: { url: 'https://example.com', duration: 11 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for fps above max', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gif',
      payload: { url: 'https://example.com', fps: 31 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for width above 1280', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gif',
      payload: { url: 'https://example.com', width: 1920 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for height above 720', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gif',
      payload: { url: 'https://example.com', height: 1080 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('blocks SSRF to private URLs', async () => {
    // Build a fresh app with SSRF blocking enabled
    process.env.ALLOW_PRIVATE_URLS = 'false';
    const { loadConfig } = await import('../../src/config/index.js');
    loadConfig();
    const { buildServer } = await import('../../src/index.js');
    const ssrfApp = await buildServer({ skipBrowserInit: true });

    try {
      const res = await ssrfApp.inject({
        method: 'POST',
        url: '/v1/gif',
        payload: { url: 'http://127.0.0.1:3000/secret' },
      });
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('SSRF_BLOCKED');
    } finally {
      await ssrfApp.close();
      // Restore config
      process.env.ALLOW_PRIVATE_URLS = 'true';
      loadConfig();
    }
  });
});

describe('captureGif renderer', () => {
  it('exports captureGif function', async () => {
    const { captureGif } = await import('../../src/renderer/gif.js');
    expect(typeof captureGif).toBe('function');
  });
});
