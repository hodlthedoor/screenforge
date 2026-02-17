import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';

describe('diffOptionsSchema', () => {
  let diffOptionsSchema: typeof import('../../src/renderer/schemas.js').diffOptionsSchema;

  beforeAll(async () => {
    const schemas = await import('../../src/renderer/schemas.js');
    diffOptionsSchema = schemas.diffOptionsSchema;
  });

  it('accepts valid urls mode', () => {
    const result = diffOptionsSchema.safeParse({
      url_a: 'https://example.com/a',
      url_b: 'https://example.com/b',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threshold).toBe(0.1);
      expect(result.data.include_diff_image).toBe(true);
      expect(result.data.anti_aliasing_detection).toBe(false);
      expect(result.data.output_format).toBe('png');
    }
  });

  it('accepts valid jobs mode', () => {
    const result = diffOptionsSchema.safeParse({
      job_id_a: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      job_id_b: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    });
    expect(result.success).toBe(true);
  });

  it('rejects mixed modes (url_a + job_id_b)', () => {
    const result = diffOptionsSchema.safeParse({
      url_a: 'https://example.com',
      job_id_b: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    });
    expect(result.success).toBe(false);
  });

  it('rejects both modes at once', () => {
    const result = diffOptionsSchema.safeParse({
      url_a: 'https://example.com/a',
      url_b: 'https://example.com/b',
      job_id_a: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      job_id_b: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    });
    expect(result.success).toBe(false);
  });

  it('rejects no input mode', () => {
    const result = diffOptionsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts custom threshold', () => {
    const result = diffOptionsSchema.safeParse({
      url_a: 'https://example.com/a',
      url_b: 'https://example.com/b',
      threshold: 0.05,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threshold).toBe(0.05);
    }
  });

  it('rejects threshold above 1', () => {
    const result = diffOptionsSchema.safeParse({
      url_a: 'https://example.com/a',
      url_b: 'https://example.com/b',
      threshold: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects threshold below 0', () => {
    const result = diffOptionsSchema.safeParse({
      url_a: 'https://example.com/a',
      url_b: 'https://example.com/b',
      threshold: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts screenshot_options for urls mode', () => {
    const result = diffOptionsSchema.safeParse({
      url_a: 'https://example.com/a',
      url_b: 'https://example.com/b',
      screenshot_options: { width: 1280, height: 720, fullPage: true },
    });
    expect(result.success).toBe(true);
  });

  it('accepts all output formats', () => {
    for (const fmt of ['png', 'jpeg', 'webp', 'avif']) {
      const result = diffOptionsSchema.safeParse({
        url_a: 'https://a.com',
        url_b: 'https://b.com',
        output_format: fmt,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid uuid for job_id_a', () => {
    const result = diffOptionsSchema.safeParse({
      job_id_a: 'not-a-uuid',
      job_id_b: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    });
    expect(result.success).toBe(false);
  });
});

describe('compareImages', () => {
  let compareImages: typeof import('../../src/renderer/diff.js').compareImages;

  beforeAll(async () => {
    const mod = await import('../../src/renderer/diff.js');
    compareImages = mod.compareImages;
  });

  async function createSolidPng(color: { r: number; g: number; b: number }, w = 100, h = 100): Promise<Buffer> {
    return sharp({
      create: { width: w, height: h, channels: 4, background: { ...color, alpha: 255 } },
    }).png().toBuffer();
  }

  it('returns 0% mismatch for identical images', async () => {
    const img = await createSolidPng({ r: 255, g: 0, b: 0 });
    const result = await compareImages(img, img, { threshold: 0.1 });
    expect(result.mismatch_percentage).toBe(0);
    expect(result.diff_pixels).toBe(0);
    expect(result.total_pixels).toBe(10_000);
  });

  it('returns >0% mismatch for different images', async () => {
    const red = await createSolidPng({ r: 255, g: 0, b: 0 });
    const blue = await createSolidPng({ r: 0, g: 0, b: 255 });
    const result = await compareImages(red, blue, { threshold: 0.1 });
    expect(result.mismatch_percentage).toBeGreaterThan(0);
    expect(result.diff_pixels).toBeGreaterThan(0);
  });

  it('returns 100% mismatch for completely different images', async () => {
    const black = await createSolidPng({ r: 0, g: 0, b: 0 });
    const white = await createSolidPng({ r: 255, g: 255, b: 255 });
    const result = await compareImages(black, white, { threshold: 0.1 });
    expect(result.mismatch_percentage).toBe(100);
  });

  it('includes diff image buffer when requested', async () => {
    const red = await createSolidPng({ r: 255, g: 0, b: 0 });
    const blue = await createSolidPng({ r: 0, g: 0, b: 255 });
    const result = await compareImages(red, blue, {
      threshold: 0.1,
      include_diff_image: true,
      output_format: 'png',
    });
    expect(result.diff_image_buffer).toBeDefined();
    expect(result.diff_image_buffer!.length).toBeGreaterThan(0);
    // Verify it's a valid PNG
    const meta = await sharp(result.diff_image_buffer!).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });

  it('omits diff image when include_diff_image is false', async () => {
    const img = await createSolidPng({ r: 255, g: 0, b: 0 });
    const result = await compareImages(img, img, {
      threshold: 0.1,
      include_diff_image: false,
    });
    expect(result.diff_image_buffer).toBeUndefined();
  });

  it('handles dimension mismatch by resizing to larger', async () => {
    const small = await createSolidPng({ r: 255, g: 0, b: 0 }, 50, 50);
    const large = await createSolidPng({ r: 255, g: 0, b: 0 }, 100, 100);
    const result = await compareImages(small, large, { threshold: 0.1 });
    // After resize, identical solid colors should match
    expect(result.mismatch_percentage).toBe(0);
    expect(result.total_pixels).toBe(10_000); // 100x100
  });

  it('respects threshold sensitivity — lower threshold catches more', async () => {
    // Create two very slightly different images
    const imgA = await createSolidPng({ r: 128, g: 128, b: 128 });
    const imgB = await createSolidPng({ r: 130, g: 128, b: 128 }); // slight red shift

    const strictResult = await compareImages(imgA, imgB, { threshold: 0.0 });
    const relaxedResult = await compareImages(imgA, imgB, { threshold: 0.5 });

    // Strict should catch more differences than relaxed
    expect(strictResult.diff_pixels).toBeGreaterThanOrEqual(relaxedResult.diff_pixels);
  });

  it('supports anti-aliasing detection', async () => {
    const imgA = await createSolidPng({ r: 128, g: 128, b: 128 });
    const imgB = await createSolidPng({ r: 130, g: 128, b: 128 });
    const result = await compareImages(imgA, imgB, {
      threshold: 0.1,
      anti_aliasing_detection: true,
    });
    // Should not throw, result should be valid
    expect(result.total_pixels).toBe(10_000);
  });

  it('supports jpeg output format', async () => {
    const red = await createSolidPng({ r: 255, g: 0, b: 0 });
    const blue = await createSolidPng({ r: 0, g: 0, b: 255 });
    const result = await compareImages(red, blue, {
      threshold: 0.1,
      include_diff_image: true,
      output_format: 'jpeg',
    });
    const meta = await sharp(result.diff_image_buffer!).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('supports webp output format', async () => {
    const red = await createSolidPng({ r: 255, g: 0, b: 0 });
    const blue = await createSolidPng({ r: 0, g: 0, b: 255 });
    const result = await compareImages(red, blue, {
      threshold: 0.1,
      include_diff_image: true,
      output_format: 'webp',
    });
    const meta = await sharp(result.diff_image_buffer!).metadata();
    expect(meta.format).toBe('webp');
  });

  it('supports avif output format', async () => {
    const red = await createSolidPng({ r: 255, g: 0, b: 0 });
    const blue = await createSolidPng({ r: 0, g: 0, b: 255 });
    const result = await compareImages(red, blue, {
      threshold: 0.1,
      include_diff_image: true,
      output_format: 'avif',
    });
    const meta = await sharp(result.diff_image_buffer!).metadata();
    expect(meta.format).toBe('heif');
  });

  it('throws for images with missing dimensions', async () => {
    // A 0-byte buffer is not a valid image
    const invalid = Buffer.from('not-an-image');
    const valid = await createSolidPng({ r: 255, g: 0, b: 0 });
    await expect(compareImages(invalid, valid)).rejects.toThrow();
  });
});

describe('POST /v1/diff route', () => {
  let app: import('fastify').FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.ALLOW_PRIVATE_URLS = 'true';
    process.env.NODE_ENV = 'test';

    const { buildServer } = await import('../../src/index.js');
    app = await buildServer({ skipBrowserInit: true });
  });

  it('returns 400 for missing input mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/diff',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for mixed input modes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/diff',
      payload: {
        url_a: 'https://example.com',
        job_id_b: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for threshold out of range', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/diff',
      payload: {
        url_a: 'https://a.com',
        url_b: 'https://b.com',
        threshold: 2.0,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid urls mode payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/diff',
      payload: {
        url_a: 'https://example.com/a',
        url_b: 'https://example.com/b',
        threshold: 0.1,
      },
    });
    // Will fail on browser pool (no browser in test) but NOT 400
    expect(res.statusCode).not.toBe(400);
  });

  it('returns 404 for non-existent job IDs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/diff',
      payload: {
        job_id_a: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        job_id_b: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
      },
    });
    // Should return job-not-found error (not 400)
    expect(res.statusCode).not.toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('JOB_NOT_FOUND');
  });
});
