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
      `SELECT id, type, url, status, content_type, result_path, error, duration_ms,
              metadata_title, metadata_final_url, metadata_status_code, metadata_width, metadata_height,
              created_at, completed_at
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

    // Build metadata if available
    const metadata = job.status === 'completed' && (job.metadata_title !== null || job.metadata_final_url !== null || job.metadata_status_code !== null)
      ? {
          title: job.metadata_title ?? '',
          finalUrl: job.metadata_final_url ?? '',
          statusCode: job.metadata_status_code ?? 0,
          durationMs: job.duration_ms ?? 0,
          ...(job.metadata_width !== null ? { width: job.metadata_width } : {}),
          ...(job.metadata_height !== null ? { height: job.metadata_height } : {}),
        }
      : undefined;

    return reply.send({
      id: job.id,
      type: job.type,
      url: job.url,
      status: job.status,
      error: job.error ?? undefined,
      contentType: job.content_type ?? undefined,
      durationMs: job.duration_ms ?? undefined,
      metadata,
      createdAt: job.created_at,
      completedAt: job.completed_at ?? undefined,
      pollUrl: `${config.BASE_URL}/v1/render/${job.id}`,
    });
  });
}
