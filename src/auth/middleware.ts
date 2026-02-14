import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { lookupApiKey, type ApiKey } from '../db/api-keys.js';
import { getConfig } from '../config/index.js';
import { sendError } from '../security/errors.js';

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
    return sendError(reply, req, 'AUTH_REQUIRED', {
      message: 'API key required. Provide via Authorization: Bearer <key> or x-api-key header.',
    });
  }

  const apiKey = await lookupApiKey(rawKey);
  if (!apiKey) {
    return sendError(reply, req, 'INVALID_API_KEY');
  }

  if (!apiKey.active) {
    return sendError(reply, req, 'API_KEY_DISABLED');
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
    return sendError(reply, req, 'ADMIN_NOT_CONFIGURED');
  }

  if (!rawKey || !timingSafeCompare(rawKey, config.ADMIN_API_KEY)) {
    return sendError(reply, req, 'INVALID_ADMIN_KEY');
  }
}
