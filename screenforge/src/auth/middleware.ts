import type { FastifyRequest, FastifyReply } from 'fastify';
import { lookupApiKey, type ApiKey } from '../db/api-keys.js';
import { getConfig } from '../config/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: ApiKey;
  }
}

function extractKey(req: FastifyRequest): string | null {
  const header = req.headers['authorization'] ?? req.headers['x-api-key'];
  if (!header || typeof header !== 'string') return null;

  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return header.trim();
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const config = getConfig();
  if (!config.REQUIRE_AUTH) return;

  const rawKey = extractKey(req);
  if (!rawKey) {
    return reply.status(401).send({
      error: 'API key required. Provide via Authorization: Bearer <key> or x-api-key header.',
      code: 'AUTH_REQUIRED',
      statusCode: 401,
    });
  }

  const apiKey = await lookupApiKey(rawKey);
  if (!apiKey) {
    return reply.status(401).send({
      error: 'Invalid API key',
      code: 'INVALID_API_KEY',
      statusCode: 401,
    });
  }

  if (!apiKey.active) {
    return reply.status(403).send({
      error: 'API key is disabled',
      code: 'API_KEY_DISABLED',
      statusCode: 403,
    });
  }

  req.apiKey = apiKey;
}

export async function adminAuthMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const config = getConfig();
  const rawKey = extractKey(req);

  if (!config.ADMIN_API_KEY) {
    return reply.status(503).send({
      error: 'Admin API not configured',
      code: 'ADMIN_NOT_CONFIGURED',
      statusCode: 503,
    });
  }

  if (!rawKey || rawKey !== config.ADMIN_API_KEY) {
    return reply.status(401).send({
      error: 'Invalid admin API key',
      code: 'INVALID_ADMIN_KEY',
      statusCode: 401,
    });
  }
}
