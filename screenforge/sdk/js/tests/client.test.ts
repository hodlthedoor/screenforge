import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  RateLimitError,
  ScreenForge,
  ScreenForgeError,
  ValidationError,
} from '../src/index';
import type { BatchItem, RenderJob, BatchJob } from '../src/types';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function binaryResponse(content: string, contentType: string) {
  return new Response(Buffer.from(content), {
    status: 200,
    headers: {
      'content-type': contentType,
    },
  });
}

describe('ScreenForge client', () => {
  const baseUrl = 'https://screenforge.example.com';
  let client: ScreenForge;

  beforeEach(() => {
    client = new ScreenForge({ apiKey: 'test-key', baseUrl, retryBaseDelayMs: 10 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('screenshot() posts to /v1/screenshot and returns Buffer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(binaryResponse('png-data', 'image/png'));

    const out = await client.screenshot('https://example.com', { fullPage: true });

    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString()).toBe('png-data');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${baseUrl}/v1/screenshot`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toMatchObject({ url: 'https://example.com', fullPage: true });
  });

  it('uses http://localhost:3100 as the default baseUrl', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(binaryResponse('png-data', 'image/png'));
    const defaultClient = new ScreenForge({ apiKey: 'test-key' });

    await defaultClient.screenshot('https://example.com');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:3100/v1/screenshot');
  });

  it('pdf() posts to /v1/pdf and returns Buffer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(binaryResponse('pdf-data', 'application/pdf'));

    const out = await client.pdf('https://example.com', { format: 'letter' });

    expect(out.toString()).toBe('pdf-data');
  });

  it('og() posts to /v1/og and returns Buffer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(binaryResponse('og-data', 'image/png'));

    const out = await client.og('https://example.com', { theme: 'dark' });

    expect(out.toString()).toBe('og-data');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${baseUrl}/v1/og`);
    expect(JSON.parse(String(init.body))).toMatchObject({ url: 'https://example.com', theme: 'dark' });
  });

  it('screenshotAsync() returns job info', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ id: 'job_123', pollUrl: `${baseUrl}/v1/render/job_123` }, 202),
    );

    const out = await client.screenshotAsync('https://example.com', { format: 'jpeg' });

    expect(out).toEqual({
      jobId: 'job_123',
      pollUrl: `${baseUrl}/v1/render/job_123`,
    });
  });

  it('batchRender() posts items and maps response jobs', async () => {
    const items: BatchItem[] = [
      { type: 'screenshot', url: 'https://a.example.com', options: { fullPage: true } },
      { type: 'pdf', url: 'https://b.example.com', options: { format: 'a4' } },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        batchId: 'batch_123',
        jobs: [
          { id: 'job_1', pollUrl: `${baseUrl}/v1/render/job_1` },
          { id: 'job_2', pollUrl: `${baseUrl}/v1/render/job_2` },
        ],
      }, 202),
    );

    const out = await client.batchRender(items);

    expect(out).toEqual({
      batchId: 'batch_123',
      jobs: [
        { jobId: 'job_1', pollUrl: `${baseUrl}/v1/render/job_1` },
        { jobId: 'job_2', pollUrl: `${baseUrl}/v1/render/job_2` },
      ],
    });
  });

  it('screenshotAsync() throws on malformed payload without job id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ pollUrl: `${baseUrl}/v1/render/job_missing` }, 202),
    );

    await expect(client.screenshotAsync('https://example.com')).rejects.toMatchObject({
      name: 'ScreenForgeError',
      code: 'MALFORMED_RESPONSE',
    });
  });

  it('batchRender() throws on malformed job payload without job id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        batchId: 'batch_123',
        jobs: [{ pollUrl: `${baseUrl}/v1/render/job_missing` }],
      }, 202),
    );

    await expect(client.batchRender([{ type: 'screenshot', url: 'https://a.example.com' }])).rejects.toMatchObject({
      name: 'ScreenForgeError',
      code: 'MALFORMED_RESPONSE',
    });
  });

  it('pollJob() gets JSON job payload', async () => {
    const payload: RenderJob = {
      id: 'job_1',
      type: 'screenshot',
      url: 'https://example.com',
      status: 'completed',
      contentType: 'image/png',
      durationMs: 123,
      createdAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:00:01Z',
      pollUrl: `${baseUrl}/v1/render/job_1`,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(payload));

    const out = await client.pollJob('job_1');

    expect(out).toEqual(payload);
  });

  it('pollBatch() gets batch payload', async () => {
    const payload: BatchJob = {
      id: 'batch_1',
      total: 2,
      completed: 1,
      failed: 0,
      status: 'processing',
      createdAt: '2026-01-01T00:00:00Z',
      jobs: [
        {
          id: 'job_1',
          type: 'screenshot',
          url: 'https://example.com',
          status: 'completed',
          durationMs: 100,
          pollUrl: `${baseUrl}/v1/render/job_1`,
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(payload));

    const out = await client.pollBatch('batch_1');

    expect(out).toEqual(payload);
  });

  it('getUsage() returns usage stats', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        apiKeyId: 'key_1',
        tier: 'free',
        usage: { today: 2, thisMonth: 10, monthlyQuota: 100, remaining: 90 },
        rateLimit: { requestsPerMinute: 60 },
      }),
    );

    const out = await client.getUsage();

    expect(out.usage.remaining).toBe(90);
    expect(out.rateLimit.requestsPerMinute).toBe(60);
  });

  it('listWebhookDeliveries() passes pagination and returns deliveries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        deliveries: [
          {
            id: 'del_1',
            jobId: 'job_1',
            url: 'https://hooks.example.com',
            status: 'delivered',
            attempts: 1,
            lastStatusCode: 200,
            lastError: null,
            createdAt: '2026-01-01T00:00:00Z',
            deliveredAt: '2026-01-01T00:00:01Z',
          },
        ],
        pagination: { page: 2, limit: 5, total: 10 },
      }),
    );

    const out = await client.listWebhookDeliveries({ page: 2, limit: 5 });

    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('del_1');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${baseUrl}/v1/webhooks/deliveries?page=2&limit=5`);
  });

  it('throws ValidationError for 400 responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: [{ path: ['url'] }],
          request_id: 'req_validation_1',
        },
      }, 400),
    );

    await expect(client.screenshot('not-a-url')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws AuthenticationError for 401 responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid API key',
          request_id: 'req_auth_1',
        },
      }, 401),
    );

    await expect(client.getUsage()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('throws RateLimitError for 429 responses and exposes retryAfter', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        error: {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded',
          details: {
            retryAfter: 12,
          },
          request_id: 'req_rate_1',
        },
      }, 429),
    );

    const noRetryClient = new ScreenForge({ apiKey: 'test-key', baseUrl, maxRetries: 0 });
    await expect(noRetryClient.getUsage()).rejects.toMatchObject({
      name: 'RateLimitError',
      code: 'RATE_LIMITED',
      requestId: 'req_rate_1',
      details: {
        retryAfter: 12,
      },
      retryAfter: 12,
    });
  });

  it('parses nested error envelope metadata from API responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        error: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Rate limit exceeded',
            details: {
              retryAfter: 9,
              reason: 'burst',
            },
            request_id: 'req_nested_1',
          },
        },
      }, 429),
    );

    const noRetryClient = new ScreenForge({ apiKey: 'test-key', baseUrl, maxRetries: 0 });
    await expect(noRetryClient.getUsage()).rejects.toMatchObject({
      name: 'RateLimitError',
      code: 'RATE_LIMITED',
      requestId: 'req_nested_1',
      details: {
        retryAfter: 9,
        reason: 'burst',
      },
      retryAfter: 9,
    });
  });

  it('retries transient server errors up to maxRetries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(jsonResponse({ error: 'still boom' }, 502))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const req = client.getUsage();
    await vi.runAllTimersAsync();
    const out = await req;

    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops retrying after maxRetries and throws ScreenForgeError', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'explode' }, 503));

    const req = expect(client.getUsage()).rejects.toBeInstanceOf(ScreenForgeError);
    await vi.runAllTimersAsync();
    await req;
  });

  it('throws timeout error when request exceeds timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    }));

    const timed = new ScreenForge({ apiKey: 'test-key', baseUrl, timeout: 20, maxRetries: 0 });

    await expect(timed.getUsage()).rejects.toMatchObject({
      name: 'ScreenForgeError',
      code: 'TIMEOUT',
    });
  });
});
