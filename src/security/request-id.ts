import { randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export function requestIdHook(req: FastifyRequest, reply: FastifyReply, done: () => void): void {
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  reply.header('X-Request-Id', requestId);
  req.headers['x-request-id'] = requestId;
  done();
}
