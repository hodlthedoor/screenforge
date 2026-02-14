import type { FastifyRequest, FastifyReply } from 'fastify';
import { getConfig } from '../config/index.js';
import { sendError } from '../security/errors.js';
import { incrementRenderTimeouts } from '../metrics/index.js';

export async function requestTimeoutHook(
  req: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const config = getConfig();
  const timeoutMs = config.RENDER_TIMEOUT_MS;

  const controller = new AbortController();
  req.renderAbortController = controller;
  req.renderAbortSignal = controller.signal;

  req.renderTimeoutId = setTimeout(() => {
    controller.abort();
    incrementRenderTimeouts();

    // Only send error if reply not already sent
    if (!_reply.sent) {
      sendError(_reply, req, 'RENDER_TIMEOUT');
    }
  }, timeoutMs);
}

export async function requestTimeoutCleanupHook(
  req: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  if (req.renderTimeoutId) {
    clearTimeout(req.renderTimeoutId);
    req.renderTimeoutId = undefined;
  }
}
