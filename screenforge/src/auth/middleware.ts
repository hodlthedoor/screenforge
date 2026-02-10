import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { lookupApiKey, type ApiKey } from '../db/api-keys.js';
import { getConfig } from '../config/index.js';
import { createError } from '../security/errors.js';

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
    const err = createError('AUTH_REQUIRED', 'API key required. Provide via Authorization: Bearer <key> or x-api-key header.');
    return reply.status(err.statusCode).send(err);
  }

  const apiKey = await lookupApiKey(rawKey);
  if (!apiKey) {
    const err = createError('INVALID_API_KEY');
    return reply.status(err.statusCode).send(err);
  }

  if (!apiKey.active) {
    const err = createError('API_KEY_DISABLED');
    return reply.status(err.statusCode).send(err);
  }

  req.apiKey = apiKey;
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to keep constant time, then return false
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function adminAuthMiddleware(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const config = getConfig();
  const rawKey = extractKey(req);

  if (!config.ADMIN_API_KEY) {
    const err = createError('ADMIN_NOT_CONFIGURED');
    return reply.status(err.statusCode).send(err);
  }

  if (!rawKey || !timingSafeCompare(rawKey, config.ADMIN_API_KEY)) {
    const err = createError('INVALID_ADMIN_KEY');
    return reply.status(err.statusCode).send(err);
  }
}
