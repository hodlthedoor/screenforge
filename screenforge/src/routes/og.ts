import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware.js';
import type { BrowserPool } from '../renderer/browser-pool.js';
import { RenderCache } from '../cache/index.js';
import { getConfig } from '../config/index.js';
import { isPrivateUrl } from '../renderer/schemas.js';
import { sendError } from '../security/errors.js';

const ogRequestSchema = z.object({
  url: z.string().url().optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  siteName: z.string().max(100).optional(),
  image: z.string().url().optional(),
  theme: z.enum(['light', 'dark']).default('light'),
  template: z.enum(['default', 'article', 'product']).default('default'),
});

export type OgRequest = z.infer<typeof ogRequestSchema>;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateOgHtml(data: OgRequest & { fetchedMeta?: { title?: string; description?: string; siteName?: string; image?: string } }): string {
  const title = escapeHtml(data.title ?? data.fetchedMeta?.title ?? 'Untitled');
  const description = escapeHtml(data.description ?? data.fetchedMeta?.description ?? '');
  const siteName = escapeHtml(data.siteName ?? data.fetchedMeta?.siteName ?? '');
  const bgImage = data.image ?? data.fetchedMeta?.image ?? '';
  const isDark = data.theme === 'dark';

  const bgColor = isDark ? '#1a1a2e' : '#ffffff';
  const textColor = isDark ? '#e8e8e8' : '#1a1a1a';
  const subtitleColor = isDark ? '#a0a0b0' : '#666666';
  const accentColor = isDark ? '#6c63ff' : '#4f46e5';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; align-items: center;
    justify-content: center; background: ${bgColor}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    overflow: hidden;
  }
  .card {
    width: 1120px; height: 560px; display: flex; border-radius: 16px;
    overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.1);
    background: ${bgColor};
  }
  .content { flex: 1; padding: 60px; display: flex; flex-direction: column; justify-content: center; }
  .site-name { font-size: 20px; color: ${accentColor}; font-weight: 600; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 1px; }
  .title { font-size: 48px; font-weight: 800; color: ${textColor}; line-height: 1.2; margin-bottom: 20px; }
  .description { font-size: 22px; color: ${subtitleColor}; line-height: 1.5; }
  .image-section { width: 400px; background-size: cover; background-position: center; }
  .accent-bar { width: 6px; background: ${accentColor}; }
</style></head>
<body><div class="card">
  <div class="accent-bar"></div>
  <div class="content">
    ${siteName ? `<div class="site-name">${siteName}</div>` : ''}
    <div class="title">${title}</div>
    ${description ? `<div class="description">${description}</div>` : ''}
  </div>
  ${bgImage ? `<div class="image-section" style="background-image: url('${escapeHtml(bgImage)}')"></div>` : ''}
</div></body></html>`;
}

async function fetchOgMeta(url: string, pool: BrowserPool, timeoutMs: number): Promise<{ title?: string; description?: string; siteName?: string; image?: string }> {
  const context = await pool.acquire({ viewport: { width: 1200, height: 630 } });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    const meta: { title?: string; description?: string; siteName?: string; image?: string } = await page.evaluate(`
      (() => {
        const getMeta = (name) => {
          const el = document.querySelector('meta[property="og:' + name + '"]') ||
                     document.querySelector('meta[name="og:' + name + '"]');
          return el ? el.getAttribute('content') : undefined;
        };
        return {
          title: getMeta('title') || document.title || undefined,
          description: getMeta('description') || (document.querySelector('meta[name="description"]') || {}).getAttribute?.('content') || undefined,
          siteName: getMeta('site_name') || undefined,
          image: getMeta('image') || undefined,
        };
      })()
    `);

    return meta;
  } finally {
    await context.close();
  }
}

export async function ogRoutes(app: FastifyInstance, pool: BrowserPool, cache: RenderCache) {
  app.post('/v1/og', {
    schema: {
      tags: ['og'],
      summary: 'Generate OG card',
      description: 'Generate an Open Graph preview image from a URL or custom data.',
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch OG metadata from' },
          title: { type: 'string', maxLength: 200 },
          description: { type: 'string', maxLength: 500 },
          siteName: { type: 'string', maxLength: 100 },
          image: { type: 'string' },
          theme: { type: 'string', enum: ['light', 'dark'], default: 'light' },
          template: { type: 'string', enum: ['default', 'article', 'product'], default: 'default' },
        },
      },
    },
    preHandler: [authMiddleware],
  }, async (req, reply) => {
    const parsed = ogRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(reply, req, 'VALIDATION_ERROR', { details: parsed.error.issues });
      return;
    }

    const data = parsed.data;
    const config = getConfig();

    // Fetch OG metadata from URL if provided
    let fetchedMeta: { title?: string; description?: string; siteName?: string; image?: string } | undefined;
    if (data.url) {
      if (!config.ALLOW_PRIVATE_URLS && isPrivateUrl(data.url)) {
        sendError(reply, req, 'SSRF_BLOCKED');
        return;
      }
      fetchedMeta = await fetchOgMeta(data.url, pool, config.NAVIGATION_TIMEOUT_MS);
    }

    if (!data.title && !data.url) {
      sendError(reply, req, 'VALIDATION_ERROR', { message: 'Either url or title must be provided' });
      return;
    }

    // Generate OG card HTML
    const html = generateOgHtml({ ...data, fetchedMeta });

    // Check cache
    const cacheKey = RenderCache.hashOptions({ type: 'og', ...data, fetchedMeta } as unknown as Record<string, unknown>);
    const cached = await cache.get(cacheKey);
    if (cached) {
      const buffer = await cache.readFile(cached.filePath);
      return reply
        .header('Content-Type', 'image/png')
        .header('X-Cache', 'HIT')
        .send(buffer);
    }

    // Render the OG card
    const start = performance.now();
    app.incrementInflightRenders();
    const context = await pool.acquire({ viewport: { width: 1200, height: 630 } });
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      const buffer = Buffer.from(await page.screenshot({ type: 'png' }));
      const durationMs = Math.round(performance.now() - start);

      await cache.set(cacheKey, buffer, 'image/png', 'png');

      return reply
        .header('Content-Type', 'image/png')
        .header('X-Cache', 'MISS')
        .header('X-Render-Duration-Ms', String(durationMs))
        .send(buffer);
    } finally {
      await context.close();
      app.decrementInflightRenders();
    }
  });
}

export { generateOgHtml, ogRequestSchema };
