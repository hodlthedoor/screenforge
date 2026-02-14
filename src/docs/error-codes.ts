import type { FastifyInstance } from 'fastify';
import { ERROR_CODES } from '../security/errors.js';

interface ErrorCodeDoc {
  code: string;
  http_status: number;
  description: string;
  retry_guidance: string;
}

const ERROR_DOCUMENTATION: Record<string, Omit<ErrorCodeDoc, 'code' | 'http_status'>> = {
  VALIDATION_ERROR: {
    description: 'Request validation failed. Check request body, query parameters, or headers.',
    retry_guidance: 'Fix the validation errors in the details field and retry.',
  },
  INVALID_URL: {
    description: 'The provided URL is invalid or blocked.',
    retry_guidance: 'Ensure the URL is valid and not on the blocklist.',
  },
  SSRF_BLOCKED: {
    description: 'URLs targeting private networks (localhost, 127.0.0.1, 192.168.x.x, etc.) are not allowed.',
    retry_guidance: 'Use a publicly accessible URL or enable ALLOW_PRIVATE_URLS if authorized.',
  },
  ACTION_FAILED: {
    description: 'A pre-capture interaction action failed (e.g., selector not found, timeout). Check details.actionIndex and details.actionType for the failing action.',
    retry_guidance: 'Fix the action (check selector validity, increase timeouts) or remove the failing action.',
  },
  AUTH_REQUIRED: {
    description: 'API key required for this endpoint.',
    retry_guidance: 'Include a valid API key in the Authorization or X-Api-Key header.',
  },
  INVALID_API_KEY: {
    description: 'The provided API key is invalid or does not exist.',
    retry_guidance: 'Check your API key and ensure it is correct.',
  },
  INVALID_ADMIN_KEY: {
    description: 'The provided admin API key is invalid.',
    retry_guidance: 'Check your admin API key configuration.',
  },
  API_KEY_DISABLED: {
    description: 'The API key has been disabled.',
    retry_guidance: 'Contact support or re-enable the API key in the dashboard.',
  },
  QUOTA_EXCEEDED: {
    description: 'Monthly usage quota has been exceeded for this API key.',
    retry_guidance: 'Upgrade your plan or wait until the quota resets next month.',
  },
  RATE_LIMITED: {
    description: 'Too many requests. Rate limit exceeded.',
    retry_guidance: 'Wait before retrying. Check the Retry-After header for wait time.',
  },
  RENDER_TIMEOUT: {
    description: 'The render operation timed out.',
    retry_guidance: 'Retry with a simpler page or increase timeout limits.',
  },
  RENDER_FAILED: {
    description: 'The render operation failed due to an internal error.',
    retry_guidance: 'Retry the request. If it persists, check the URL or contact support.',
  },
  JOB_NOT_FOUND: {
    description: 'The requested render job was not found.',
    retry_guidance: 'Check the job ID and ensure the job exists.',
  },
  BATCH_NOT_FOUND: {
    description: 'The requested batch was not found.',
    retry_guidance: 'Check the batch ID and ensure the batch exists.',
  },
  BATCH_TOO_LARGE: {
    description: 'Batch request exceeds the maximum of 50 items.',
    retry_guidance: 'Split the batch into multiple requests of 50 items or fewer.',
  },
  ADMIN_NOT_CONFIGURED: {
    description: 'Admin API is not configured on this server.',
    retry_guidance: 'Configure the ADMIN_API_KEY environment variable.',
  },
  INTERNAL_ERROR: {
    description: 'An internal server error occurred.',
    retry_guidance: 'Retry the request. If it persists, contact support.',
  },
  NOT_FOUND: {
    description: 'The requested resource was not found.',
    retry_guidance: 'Check the URL and ensure the resource exists.',
  },
};

export async function errorCodesRoutes(app: FastifyInstance) {
  app.get('/v1/errors', async (_req, reply) => {
    const errors: ErrorCodeDoc[] = Object.entries(ERROR_CODES)
      .map(([code, { status }]) => ({
        code,
        http_status: status,
        description: ERROR_DOCUMENTATION[code]?.description ?? 'No description available',
        retry_guidance: ERROR_DOCUMENTATION[code]?.retry_guidance ?? 'Contact support',
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    return reply.send({ errors });
  });
}
