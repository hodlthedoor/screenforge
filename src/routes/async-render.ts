import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { getPool } from '../db/index.js';
import { getConfig } from '../config/index.js';
import { sendError } from '../security/errors.js';

export async function asyncRenderRoutes(app: FastifyInstance) {
  const config = getConfig();

  app.get('/v1/render/:id', {
    schema: {
      tags: ['async'],
      summary: 'Poll async render job',
      description: 'Get the status and result of an async render job.',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Job ID' },
        },
        required: ['id'],
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const result = await getPool().query(
      `SELECT id, type, url, status, content_type, result_path, error, duration_ms, created_at, completed_at
       FROM render_jobs WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      sendError(reply, req, 'JOB_NOT_FOUND');
      return;
    }

    const job = result.rows[0];

    if (job.status === 'completed' && job.result_path) {
      const accept = (req.headers.accept ?? '').toLowerCase();
      // If client wants the rendered file directly
      if (accept.includes(job.content_type) || accept.includes('image/') || accept.includes('application/pdf')) {
        const buffer = await readFile(job.result_path);
        return reply
          .header('Content-Type', job.content_type)
          .header('X-Render-Duration-Ms', String(job.duration_ms))
          .send(buffer);
      }
    }

    return reply.send({
      id: job.id,
      type: job.type,
      url: job.url,
      status: job.status,
      error: job.error ?? undefined,
      contentType: job.content_type ?? undefined,
      durationMs: job.duration_ms ?? undefined,
      createdAt: job.created_at,
      completedAt: job.completed_at ?? undefined,
      pollUrl: `${config.BASE_URL}/v1/render/${job.id}`,
    });
  });
}
