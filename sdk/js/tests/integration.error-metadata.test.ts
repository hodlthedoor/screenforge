import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { ScreenForge } from '../src/index';

describe('ScreenForge client integration: error metadata', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/v1/usage') {
        res.statusCode = 429;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          error: {
            error: {
              code: 'RATE_LIMITED',
              message: 'Rate limit exceeded',
              details: {
                retryAfter: 6,
                window: 'minute',
              },
              request_id: 'req_live_1',
            },
          },
        }));
        return;
      }

      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: 'Not Found',
          request_id: 'req_not_found',
        },
      }));
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server');
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (!server.listening) {
      return;
    }
    server.close();
    await once(server, 'close');
  });

  it('surfaces nested error code/requestId/details/retryAfter via real HTTP', async () => {
    const client = new ScreenForge({ apiKey: 'test-key', baseUrl, maxRetries: 0 });

    await expect(client.getUsage()).rejects.toMatchObject({
      name: 'RateLimitError',
      code: 'RATE_LIMITED',
      requestId: 'req_live_1',
      details: {
        retryAfter: 6,
        window: 'minute',
      },
      retryAfter: 6,
    });
  });
});
