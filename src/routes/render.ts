import type { FastifyInstance } from 'fastify';
import { screenshotOptionsSchema, pdfOptionsSchema } from '../renderer/schemas.js';
import { takeScreenshot } from '../renderer/screenshot.js';
import { renderPdf } from '../renderer/pdf.js';
import type { BrowserPool } from '../renderer/browser-pool.js';
import type { RenderCache } from '../cache/index.js';
import { RenderCache as RenderCacheClass } from '../cache/index.js';

const FORMAT_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export async function renderRoutes(app: FastifyInstance, pool: BrowserPool, cache: RenderCache) {
  app.post('/v1/screenshot', async (req, reply) => {
    const parsed = screenshotOptionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        details: parsed.error.issues,
      });
    }

    const options = parsed.data;
    const optionsHash = RenderCacheClass.hashOptions(options as unknown as Record<string, unknown>);

    const cached = await cache.get(optionsHash);
    if (cached) {
      const buffer = await cache.readFile(cached.filePath);
      return reply
        .header('Content-Type', cached.contentType)
        .header('X-Cache', 'HIT')
        .header('X-Render-Duration-Ms', '0')
        .send(buffer);
    }

    const result = await takeScreenshot(pool, options);
    const ext = FORMAT_EXT[result.contentType] ?? 'bin';
    await cache.set(optionsHash, result.buffer, result.contentType, ext);

    return reply
      .header('Content-Type', result.contentType)
      .header('X-Cache', 'MISS')
      .header('X-Render-Duration-Ms', String(result.durationMs))
      .send(result.buffer);
  });

  app.post('/v1/pdf', async (req, reply) => {
    const parsed = pdfOptionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        details: parsed.error.issues,
      });
    }

    const options = parsed.data;
    const optionsHash = RenderCacheClass.hashOptions(options as unknown as Record<string, unknown>);

    const cached = await cache.get(optionsHash);
    if (cached) {
      const buffer = await cache.readFile(cached.filePath);
      return reply
        .header('Content-Type', cached.contentType)
        .header('X-Cache', 'HIT')
        .header('X-Render-Duration-Ms', '0')
        .send(buffer);
    }

    const result = await renderPdf(pool, options);
    await cache.set(optionsHash, result.buffer, result.contentType, 'pdf');

    return reply
      .header('Content-Type', result.contentType)
      .header('X-Cache', 'MISS')
      .header('X-Render-Duration-Ms', String(result.durationMs))
      .send(result.buffer);
  });
}
