import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../auth/middleware.js';
import { getPool } from '../db/index.js';
import { createError } from '../security/errors.js';
import { validateCronExpression, getNextRun } from '../scheduler/cron.js';
import { PLANS } from '../billing/plans.js';

const createScheduleSchema = z.object({
  name: z.string().min(1).max(255),
  cron_expression: z.string().min(1).max(100),
  render_type: z.enum(['screenshot', 'pdf', 'og']),
  render_config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().default(true),
});

const updateScheduleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  cron_expression: z.string().min(1).max(100).optional(),
  render_type: z.enum(['screenshot', 'pdf', 'og']).optional(),
  render_config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export async function schedulesRoutes(app: FastifyInstance) {
  // POST /v1/schedules — create a new schedule
  app.post(
    '/v1/schedules',
    {
      schema: {
        tags: ['schedules'],
        summary: 'Create a schedule',
        description: 'Create a recurring render schedule with a cron expression.',
        security: [{ apiKey: [] }],
        body: {
          type: 'object',
          required: ['name', 'cron_expression', 'render_type', 'render_config'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            cron_expression: { type: 'string', minLength: 1, maxLength: 100 },
            render_type: { type: 'string', enum: ['screenshot', 'pdf', 'og'] },
            render_config: { type: 'object', additionalProperties: true },
            enabled: { type: 'boolean', default: true },
          },
        },
      },
      preHandler: [authMiddleware],
    },
    async (req, reply) => {
      const parsed = createScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        const err = createError('VALIDATION_ERROR', undefined, { details: parsed.error.issues });
        return reply.status(err.statusCode).send(err);
      }

      const { name, cron_expression, render_type, render_config, enabled } = parsed.data;
      const apiKeyId = req.apiKey!.id;
      const tier = req.apiKey!.tier;

      // Validate render_config.url is present for screenshot/pdf types
      if ((render_type === 'screenshot' || render_type === 'pdf') && !render_config.url) {
        const err = createError('VALIDATION_ERROR', 'render_config.url is required for screenshot and pdf types');
        return reply.status(err.statusCode).send(err);
      }

      // Validate cron expression
      const validation = validateCronExpression(cron_expression, tier);
      if (!validation.valid) {
        const err = createError('VALIDATION_ERROR', validation.error);
        return reply.status(err.statusCode).send(err);
      }

      // Check tier limit
      const plan = PLANS[tier];
      if (plan) {
        const pool = getPool();
        const countResult = await pool.query(
          'SELECT COUNT(*)::int as count FROM schedules WHERE api_key_id = $1',
          [apiKeyId],
        );
        if (countResult.rows[0].count >= plan.maxSchedules) {
          const err = createError('VALIDATION_ERROR', `Schedule limit reached (${plan.maxSchedules} for ${plan.name} plan). Upgrade to create more.`);
          return reply.status(err.statusCode).send(err);
        }
      }

      const nextRun = enabled ? getNextRun(cron_expression) : null;
      const pool = getPool();
      const result = await pool.query(
        `INSERT INTO schedules (api_key_id, name, cron_expression, render_type, render_config, enabled, next_run_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [apiKeyId, name, cron_expression, render_type, JSON.stringify(render_config), enabled, nextRun],
      );

      return reply.status(201).send({ schedule: formatSchedule(result.rows[0]) });
    },
  );

  // GET /v1/schedules — list schedules for authenticated API key
  app.get(
    '/v1/schedules',
    {
      schema: {
        tags: ['schedules'],
        summary: 'List schedules',
        description: 'List all recurring render schedules for the authenticated API key.',
        security: [{ apiKey: [] }],
      },
      preHandler: [authMiddleware],
    },
    async (req, reply) => {
      const apiKeyId = req.apiKey!.id;
      const pool = getPool();
      const result = await pool.query(
        'SELECT * FROM schedules WHERE api_key_id = $1 ORDER BY created_at DESC',
        [apiKeyId],
      );
      return reply.send({ schedules: result.rows.map(formatSchedule) });
    },
  );

  // GET /v1/schedules/:id — get schedule detail with last 10 render results
  app.get(
    '/v1/schedules/:id',
    {
      schema: {
        tags: ['schedules'],
        summary: 'Get schedule detail',
        description: 'Get a specific schedule with its last 10 render job results.',
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      preHandler: [authMiddleware],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const apiKeyId = req.apiKey!.id;
      const pool = getPool();

      const scheduleResult = await pool.query(
        'SELECT * FROM schedules WHERE id = $1 AND api_key_id = $2',
        [id, apiKeyId],
      );

      if (scheduleResult.rows.length === 0) {
        const err = createError('JOB_NOT_FOUND', 'Schedule not found');
        return reply.status(err.statusCode).send(err);
      }

      // Get last 10 render results for this schedule
      const jobsResult = await pool.query(
        `SELECT id, type, url, status, result_path, content_type, error, duration_ms, created_at, completed_at
         FROM render_jobs WHERE schedule_id = $1
         ORDER BY created_at DESC LIMIT 10`,
        [id],
      );

      return reply.send({
        schedule: formatSchedule(scheduleResult.rows[0]),
        recent_jobs: jobsResult.rows.map((j: Record<string, unknown>) => ({
          id: j.id,
          type: j.type,
          url: j.url,
          status: j.status,
          resultPath: j.result_path,
          contentType: j.content_type,
          error: j.error,
          durationMs: j.duration_ms,
          createdAt: j.created_at,
          completedAt: j.completed_at,
        })),
      });
    },
  );

  // PATCH /v1/schedules/:id — update a schedule
  app.patch(
    '/v1/schedules/:id',
    {
      schema: {
        tags: ['schedules'],
        summary: 'Update a schedule',
        description: 'Update cron expression, config, name, or enabled status of a schedule.',
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            cron_expression: { type: 'string', minLength: 1, maxLength: 100 },
            render_type: { type: 'string', enum: ['screenshot', 'pdf', 'og'] },
            render_config: { type: 'object', additionalProperties: true },
            enabled: { type: 'boolean' },
          },
        },
      },
      preHandler: [authMiddleware],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const apiKeyId = req.apiKey!.id;
      const parsed = updateScheduleSchema.safeParse(req.body);
      if (!parsed.success) {
        const err = createError('VALIDATION_ERROR', undefined, { details: parsed.error.issues });
        return reply.status(err.statusCode).send(err);
      }

      const pool = getPool();

      // Check ownership
      const existing = await pool.query(
        'SELECT * FROM schedules WHERE id = $1 AND api_key_id = $2',
        [id, apiKeyId],
      );
      if (existing.rows.length === 0) {
        const err = createError('JOB_NOT_FOUND', 'Schedule not found');
        return reply.status(err.statusCode).send(err);
      }

      const updates = parsed.data;
      const tier = req.apiKey!.tier;

      // Validate render_config.url for screenshot/pdf types
      const effectiveType = updates.render_type ?? existing.rows[0].render_type;
      const effectiveConfig = updates.render_config ?? existing.rows[0].render_config;
      if ((effectiveType === 'screenshot' || effectiveType === 'pdf') && !effectiveConfig?.url) {
        const err = createError('VALIDATION_ERROR', 'render_config.url is required for screenshot and pdf types');
        return reply.status(err.statusCode).send(err);
      }

      // Validate new cron expression if provided
      if (updates.cron_expression) {
        const validation = validateCronExpression(updates.cron_expression, tier);
        if (!validation.valid) {
          const err = createError('VALIDATION_ERROR', validation.error);
          return reply.status(err.statusCode).send(err);
        }
      }

      // Build dynamic SET clause
      const setClauses: string[] = ['updated_at = NOW()'];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (updates.name !== undefined) {
        setClauses.push(`name = $${paramIdx++}`);
        values.push(updates.name);
      }
      if (updates.cron_expression !== undefined) {
        setClauses.push(`cron_expression = $${paramIdx++}`);
        values.push(updates.cron_expression);
      }
      if (updates.render_type !== undefined) {
        setClauses.push(`render_type = $${paramIdx++}`);
        values.push(updates.render_type);
      }
      if (updates.render_config !== undefined) {
        setClauses.push(`render_config = $${paramIdx++}`);
        values.push(JSON.stringify(updates.render_config));
      }
      if (updates.enabled !== undefined) {
        setClauses.push(`enabled = $${paramIdx++}`);
        values.push(updates.enabled);
      }

      // Recompute next_run_at if cron or enabled changed
      const cronExpr = updates.cron_expression ?? existing.rows[0].cron_expression;
      const isEnabled = updates.enabled ?? existing.rows[0].enabled;
      const nextRun = isEnabled ? getNextRun(cronExpr) : null;
      setClauses.push(`next_run_at = $${paramIdx++}`);
      values.push(nextRun);

      values.push(id);
      values.push(apiKeyId);

      const result = await pool.query(
        `UPDATE schedules SET ${setClauses.join(', ')} WHERE id = $${paramIdx++} AND api_key_id = $${paramIdx} RETURNING *`,
        values,
      );

      return reply.send({ schedule: formatSchedule(result.rows[0]) });
    },
  );

  // DELETE /v1/schedules/:id — delete a schedule
  app.delete(
    '/v1/schedules/:id',
    {
      schema: {
        tags: ['schedules'],
        summary: 'Delete a schedule',
        description: 'Permanently delete a recurring render schedule.',
        security: [{ apiKey: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      preHandler: [authMiddleware],
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const apiKeyId = req.apiKey!.id;
      const pool = getPool();

      const result = await pool.query(
        'DELETE FROM schedules WHERE id = $1 AND api_key_id = $2 RETURNING id',
        [id, apiKeyId],
      );

      if (result.rows.length === 0) {
        const err = createError('JOB_NOT_FOUND', 'Schedule not found');
        return reply.status(err.statusCode).send(err);
      }

      return reply.send({ deleted: true, id: result.rows[0].id });
    },
  );
}

function formatSchedule(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    cronExpression: row.cron_expression,
    renderType: row.render_type,
    renderConfig: row.render_config,
    enabled: row.enabled,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
