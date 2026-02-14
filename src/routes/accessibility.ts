import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Result as AxeViolation, NodeResult as AxeNodeResult } from 'axe-core';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware.js';
import { getPool } from '../db/index.js';
import { incrementUsage } from '../db/api-keys.js';
import { PLANS } from '../billing/plans.js';
import { sendError } from '../security/errors.js';
import { getStorageBackend } from '../storage/index.js';
import { isPrivateUrl } from '../renderer/schemas.js';
import { getConfig } from '../config/index.js';
import sharp from 'sharp';

const accessibilityRequestSchema = z.object({
  url: z.string().url(),
  standard: z.enum(['WCAG2A', 'WCAG2AA', 'WCAG2AAA']).default('WCAG2AA'),
  screenshot_options: z
    .object({
      viewport_width: z.number().int().min(1).max(7680).optional(),
      viewport_height: z.number().int().min(1).max(4320).optional(),
      delay_ms: z.number().int().min(0).max(30000).optional(),
    })
    .optional(),
  include_screenshot: z.boolean().default(false),
});

const STANDARD_TO_AXE_TAGS: Record<string, string[]> = {
  WCAG2A: ['wcag2a', 'best-practice'],
  WCAG2AA: ['wcag2a', 'wcag2aa', 'best-practice'],
  WCAG2AAA: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'best-practice'],
};

interface FormattedViolation {
  id: string;
  impact: string | null;
  description: string;
  helpUrl: string;
  nodes: { html: string; target: string[]; failureSummary: string }[];
}

function formatViolation(v: AxeViolation): FormattedViolation {
  return {
    id: v.id,
    impact: v.impact ?? null,
    description: v.description,
    helpUrl: v.helpUrl,
    nodes: (v.nodes ?? []).map((n: AxeNodeResult) => ({
      html: n.html,
      target: Array.isArray(n.target) ? n.target.map(String) : [],
      failureSummary: n.failureSummary ?? '',
    })),
  };
}

async function annotateScreenshot(
  imageBuffer: Buffer,
  violations: FormattedViolation[],
): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 1280;
  const height = meta.height ?? 800;

  // Build SVG overlay with red boxes for each violation node
  const rects: string[] = [];
  const nodeCount = violations.reduce((sum, v) => sum + v.nodes.length, 0);

  if (nodeCount === 0) {
    return imageBuffer;
  }

  // Distribute boxes evenly across the page as a visual indicator
  // (We can't get exact element positions from axe-core results alone,
  //  so we place indicators in a grid pattern)
  const cols = Math.ceil(Math.sqrt(nodeCount));
  const rows = Math.ceil(nodeCount / cols);
  const boxW = Math.floor(width / cols);
  const boxH = Math.floor(height / rows);
  let idx = 0;

  for (const v of violations) {
    for (let i = 0; i < v.nodes.length; i++) {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = col * boxW;
      const y = row * boxH;
      rects.push(
        `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" fill="none" stroke="red" stroke-width="3" opacity="0.7"/>`,
      );
      idx++;
    }
  }

  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects.join('')}</svg>`,
  );

  return sharp(imageBuffer)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

interface AccessibilityJobRow {
  id: string;
  api_key_id: string;
  url: string;
  standard: string;
  status: string;
  violations_count: number | null;
  passes_count: number | null;
  incomplete_count: number | null;
  violations: unknown;
  screenshot_path: string | null;
  annotated_screenshot_path: string | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

function formatAudit(row: AccessibilityJobRow) {
  return {
    id: row.id,
    url: row.url,
    standard: row.standard,
    status: row.status,
    violationsCount: row.violations_count,
    passesCount: row.passes_count,
    incompleteCount: row.incomplete_count,
    violations: row.violations,
    screenshotPath: row.screenshot_path,
    annotatedScreenshotPath: row.annotated_screenshot_path,
    durationMs: row.duration_ms,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function formatAuditSummary(row: AccessibilityJobRow) {
  return {
    id: row.id,
    url: row.url,
    standard: row.standard,
    status: row.status,
    violationsCount: row.violations_count,
    passesCount: row.passes_count,
    incompleteCount: row.incomplete_count,
    durationMs: row.duration_ms,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function accessibilityRoutes(app: FastifyInstance) {
  // POST /v1/accessibility — run WCAG accessibility audit
  app.post(
    '/v1/accessibility',
    {
      schema: {
        tags: ['accessibility'],
        summary: 'Run WCAG accessibility audit',
        description:
          'Captures a page and runs a comprehensive WCAG accessibility audit using axe-core. Returns structured violation reports with optional annotated screenshots.',
        security: [{ apiKey: [] }],
        body: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', format: 'uri', description: 'URL to audit for accessibility' },
            standard: {
              type: 'string',
              enum: ['WCAG2A', 'WCAG2AA', 'WCAG2AAA'],
              default: 'WCAG2AA',
              description: 'WCAG conformance level to check against',
            },
            screenshot_options: {
              type: 'object',
              properties: {
                viewport_width: { type: 'integer', minimum: 1, maximum: 7680 },
                viewport_height: { type: 'integer', minimum: 1, maximum: 4320 },
                delay_ms: { type: 'integer', minimum: 0, maximum: 30000 },
              },
              description: 'Screenshot capture options',
            },
            include_screenshot: {
              type: 'boolean',
              default: false,
              description: 'Include clean and annotated screenshots with violations highlighted',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              auditId: { type: 'string', format: 'uuid' },
              url: { type: 'string' },
              standard: { type: 'string', enum: ['WCAG2A', 'WCAG2AA', 'WCAG2AAA'] },
              violations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    impact: { type: 'string' },
                    description: { type: 'string' },
                    helpUrl: { type: 'string' },
                    nodes: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          html: { type: 'string' },
                          target: { type: 'array', items: { type: 'string' } },
                          failureSummary: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
              passesCount: { type: 'integer' },
              violationsCount: { type: 'integer' },
              incompleteCount: { type: 'integer' },
              screenshotPath: { type: 'string', nullable: true },
              annotatedScreenshotPath: { type: 'string', nullable: true },
              durationMs: { type: 'integer' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      preHandler: [authMiddleware],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = accessibilityRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, req, 'VALIDATION_ERROR', {
          details: parsed.error.issues,
        });
      }

      const { url, standard, screenshot_options, include_screenshot } = parsed.data;
      const apiKeyId = req.apiKey!.id;
      const tier = req.apiKey!.tier;
      const pool = getPool();
      const config = getConfig();

      // Check daily accessibility limit
      const plan = PLANS[tier];
      if (plan) {
        const usageResult = await pool.query(
          'SELECT COALESCE(count, 0)::int as count FROM accessibility_usage_daily WHERE api_key_id = $1 AND date = CURRENT_DATE',
          [apiKeyId],
        );
        const currentUsage = usageResult.rows[0]?.count ?? 0;
        if (currentUsage >= plan.maxAccessibilityDaily) {
          return sendError(reply, req, 'ACCESSIBILITY_LIMIT_EXCEEDED', {
            details: {
              limit: plan.maxAccessibilityDaily,
              used: currentUsage,
              tier: plan.name,
            },
          });
        }
      }

      // SSRF protection — check before creating job to avoid orphaned rows
      if (!config.ALLOW_PRIVATE_URLS && isPrivateUrl(url)) {
        return sendError(reply, req, 'SSRF_BLOCKED', {
          message: 'Access to private/internal URLs is not allowed',
        });
      }
      const start = performance.now();

      // Create audit job record
      const jobInsert = await pool.query(
        `INSERT INTO accessibility_jobs (api_key_id, url, standard, status)
         VALUES ($1, $2, $3, 'processing')
         RETURNING id`,
        [apiKeyId, url, standard],
      );
      const auditId = jobInsert.rows[0].id;

      let context: Awaited<ReturnType<typeof app.browserPool.acquire>> | undefined;
      try {
        // Acquire browser context and navigate
        const browserPool = app.browserPool;

        const viewportWidth = screenshot_options?.viewport_width ?? 1280;
        const viewportHeight = screenshot_options?.viewport_height ?? 800;

        context = await browserPool.acquire({
          viewport: { width: viewportWidth, height: viewportHeight },
        });

        const page = await context.newPage();

        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: config.NAVIGATION_TIMEOUT_MS });

          if (screenshot_options?.delay_ms) {
            await new Promise((resolve) => setTimeout(resolve, screenshot_options.delay_ms));
          }

          // Run axe-core accessibility analysis
          const { AxeBuilder } = await import('@axe-core/playwright');
          const axeTags = STANDARD_TO_AXE_TAGS[standard] ?? STANDARD_TO_AXE_TAGS['WCAG2AA'];
          const axeResults = await new AxeBuilder({ page }).withTags(axeTags).analyze();

          const formattedViolations = axeResults.violations.map(formatViolation);

          let screenshotPath: string | undefined;
          let annotatedScreenshotPath: string | undefined;

          if (include_screenshot) {
            const screenshotBuffer = await page.screenshot({ fullPage: true, type: 'png' });
            const storage = getStorageBackend();

            const cleanKey = `a11y-${auditId}.png`;
            screenshotPath = await storage.upload(cleanKey, screenshotBuffer, 'image/png');

            // Annotate with violation overlays
            if (formattedViolations.length > 0) {
              const annotatedBuffer = await annotateScreenshot(screenshotBuffer, formattedViolations);
              const annotatedKey = `a11y-${auditId}-annotated.png`;
              annotatedScreenshotPath = await storage.upload(annotatedKey, annotatedBuffer, 'image/png');
            }
          }

          const durationMs = Math.round(performance.now() - start);

          // Update audit job with results
          await pool.query(
            `UPDATE accessibility_jobs
             SET status = 'completed', violations_count = $1, passes_count = $2,
                 incomplete_count = $3, violations = $4, screenshot_path = $5,
                 annotated_screenshot_path = $6, duration_ms = $7, completed_at = NOW()
             WHERE id = $8`,
            [
              formattedViolations.length,
              axeResults.passes.length,
              axeResults.incomplete.length,
              JSON.stringify(formattedViolations),
              screenshotPath ?? null,
              annotatedScreenshotPath ?? null,
              durationMs,
              auditId,
            ],
          );

          // Increment accessibility usage
          await pool.query(
            `INSERT INTO accessibility_usage_daily (api_key_id, date, count)
             VALUES ($1, CURRENT_DATE, 1)
             ON CONFLICT (api_key_id, date) DO UPDATE SET count = accessibility_usage_daily.count + 1`,
            [apiKeyId],
          );

          await incrementUsage(apiKeyId);

          const response: Record<string, unknown> = {
            auditId,
            url,
            standard,
            violations: formattedViolations,
            passesCount: axeResults.passes.length,
            violationsCount: formattedViolations.length,
            incompleteCount: axeResults.incomplete.length,
            durationMs,
            timestamp: new Date().toISOString(),
          };

          if (include_screenshot) {
            response.screenshotPath = screenshotPath;
            response.annotatedScreenshotPath = annotatedScreenshotPath;
          }

          return reply.send(response);
        } finally {
          await page.close();
        }
      } catch (err) {
        const durationMs = Math.round(performance.now() - start);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';

        await pool.query(
          `UPDATE accessibility_jobs
           SET status = 'failed', error = $1, duration_ms = $2, completed_at = NOW()
           WHERE id = $3`,
          [errorMessage, durationMs, auditId],
        );

        return sendError(reply, req, 'ACCESSIBILITY_FAILED', {
          message: `Accessibility audit failed: ${errorMessage}`,
        });
      } finally {
        if (context) {
          await context.close();
        }
      }
    },
  );

  // GET /v1/accessibility/:id — get audit details
  app.get(
    '/v1/accessibility/:id',
    {
      schema: {
        tags: ['accessibility'],
        summary: 'Get accessibility audit result',
        description: 'Retrieve the result of a previous accessibility audit.',
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              audit: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  url: { type: 'string' },
                  standard: { type: 'string' },
                  status: { type: 'string', enum: ['processing', 'completed', 'failed'] },
                  violationsCount: { type: 'integer', nullable: true },
                  passesCount: { type: 'integer', nullable: true },
                  incompleteCount: { type: 'integer', nullable: true },
                  violations: { type: 'array', nullable: true },
                  screenshotPath: { type: 'string', nullable: true },
                  annotatedScreenshotPath: { type: 'string', nullable: true },
                  durationMs: { type: 'integer', nullable: true },
                  error: { type: 'string', nullable: true },
                  createdAt: { type: 'string', format: 'date-time' },
                  completedAt: { type: 'string', format: 'date-time', nullable: true },
                },
              },
            },
          },
        },
      },
      preHandler: [authMiddleware],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };

      if (!z.string().uuid().safeParse(id).success) {
        return sendError(reply, req, 'VALIDATION_ERROR', {
          message: 'Invalid audit ID format',
        });
      }

      const apiKeyId = req.apiKey!.id;
      const pool = getPool();

      const result = await pool.query(
        'SELECT * FROM accessibility_jobs WHERE id = $1 AND api_key_id = $2',
        [id, apiKeyId],
      );

      if (result.rows.length === 0) {
        return sendError(reply, req, 'NOT_FOUND', {
          message: 'Accessibility audit not found',
        });
      }

      return reply.send({ audit: formatAudit(result.rows[0]) });
    },
  );

  // GET /v1/accessibility — list audits
  app.get(
    '/v1/accessibility',
    {
      schema: {
        tags: ['accessibility'],
        summary: 'List accessibility audits',
        description: 'List all accessibility audits for the authenticated API key.',
        security: [{ apiKey: [] }],
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              audits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    url: { type: 'string' },
                    standard: { type: 'string' },
                    status: { type: 'string' },
                    violationsCount: { type: 'integer', nullable: true },
                    passesCount: { type: 'integer', nullable: true },
                    incompleteCount: { type: 'integer', nullable: true },
                    durationMs: { type: 'integer', nullable: true },
                    createdAt: { type: 'string', format: 'date-time' },
                    completedAt: { type: 'string', format: 'date-time', nullable: true },
                  },
                },
              },
              total: { type: 'integer' },
            },
          },
        },
      },
      preHandler: [authMiddleware],
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const apiKeyId = req.apiKey!.id;
      const { limit = 20, offset = 0 } = req.query as { limit?: number; offset?: number };
      const pool = getPool();

      const [result, countResult] = await Promise.all([
        pool.query(
          `SELECT * FROM accessibility_jobs WHERE api_key_id = $1
           ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
          [apiKeyId, limit, offset],
        ),
        pool.query(
          'SELECT COUNT(*)::int AS total FROM accessibility_jobs WHERE api_key_id = $1',
          [apiKeyId],
        ),
      ]);

      return reply.send({
        audits: result.rows.map(formatAuditSummary),
        total: countResult.rows[0].total,
      });
    },
  );
}
