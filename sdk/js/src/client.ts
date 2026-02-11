import type {
  AsyncRenderResponse,
  BatchItem,
  BatchJob,
  BatchRenderResponse,
  ListWebhookDeliveriesOptions,
  OgOptions,
  PdfOptions,
  RenderJob,
  ScreenshotOptions,
  UsageStats,
  WebhookDelivery,
} from './types';

interface RequestErrorDetails {
  status?: number;
  code?: string;
  details?: unknown;
  requestId?: string;
  retryAfter?: number;
  cause?: unknown;
}

export class ScreenForgeError extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly details?: unknown;
  public readonly requestId?: string;
  public readonly retryAfter?: number;

  constructor(message: string, details: RequestErrorDetails = {}) {
    super(message, { cause: details.cause });
    this.name = 'ScreenForgeError';
    this.status = details.status;
    this.code = details.code;
    this.details = details.details;
    this.requestId = details.requestId;
    this.retryAfter = details.retryAfter;
  }
}

export class RateLimitError extends ScreenForgeError {
  constructor(message: string, details: RequestErrorDetails = {}) {
    super(message, details);
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends ScreenForgeError {
  constructor(message: string, details: RequestErrorDetails = {}) {
    super(message, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends ScreenForgeError {
  constructor(message: string, details: RequestErrorDetails = {}) {
    super(message, details);
    this.name = 'AuthenticationError';
  }
}

export interface ScreenForgeOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

interface RequestOptions {
  expectBinary?: boolean;
}

interface ApiErrorResponse {
  error?: string | { message?: string; details?: unknown; request_id?: string; code?: string };
  code?: string;
  details?: unknown;
  request_id?: string;
  retryAfter?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 200;

export class ScreenForge {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: ScreenForgeOptions) {
    if (!options.apiKey) {
      throw new ValidationError('apiKey is required');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3000').replace(/\/$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  }

  async screenshot(url: string, options: ScreenshotOptions = {}): Promise<Buffer> {
    return this.request<Buffer>('POST', '/v1/screenshot', { url, ...options }, { expectBinary: true });
  }

  async pdf(url: string, options: PdfOptions = {}): Promise<Buffer> {
    return this.request<Buffer>('POST', '/v1/pdf', { url, ...options }, { expectBinary: true });
  }

  async og(url: string, options: OgOptions = {}): Promise<Buffer> {
    return this.request<Buffer>('POST', '/v1/og', { url, ...options }, { expectBinary: true });
  }

  async screenshotAsync(url: string, options: ScreenshotOptions = {}): Promise<AsyncRenderResponse> {
    const result = await this.request<{ id?: string; jobId?: string; pollUrl: string }>(
      'POST',
      '/v1/screenshot?async=true',
      { url, ...options },
    );

    return {
      jobId: result.jobId ?? result.id ?? '',
      pollUrl: result.pollUrl,
    };
  }

  async batchRender(items: BatchItem[]): Promise<BatchRenderResponse> {
    const result = await this.request<{ batchId: string; jobs: Array<{ id?: string; jobId?: string; pollUrl: string }> }>(
      'POST',
      '/v1/batch',
      { items },
    );

    return {
      batchId: result.batchId,
      jobs: result.jobs.map((job) => ({
        jobId: job.jobId ?? job.id ?? '',
        pollUrl: job.pollUrl,
      })),
    };
  }

  async pollJob(jobId: string): Promise<RenderJob> {
    return this.request<RenderJob>('GET', `/v1/render/${encodeURIComponent(jobId)}`);
  }

  async pollBatch(batchId: string): Promise<BatchJob> {
    return this.request<BatchJob>('GET', `/v1/batch/${encodeURIComponent(batchId)}`);
  }

  async getUsage(): Promise<UsageStats> {
    return this.request<UsageStats>('GET', '/v1/usage');
  }

  async listWebhookDeliveries(options: ListWebhookDeliveriesOptions = {}): Promise<WebhookDelivery[]> {
    const params = new URLSearchParams();
    if (options.page !== undefined) params.set('page', String(options.page));
    if (options.limit !== undefined) params.set('limit', String(options.limit));

    const query = params.toString();
    const path = query ? `/v1/webhooks/deliveries?${query}` : '/v1/webhooks/deliveries';
    const result = await this.request<{ deliveries: WebhookDelivery[] }>('GET', path);
    return result.deliveries;
  }

  private async request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await fetch(url, {
          method,
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
            accept: options.expectBinary ? '*/*' : 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutHandle);

        if (response.ok) {
          if (options.expectBinary) {
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer) as T;
          }
          return (await response.json()) as T;
        }

        const parsed = await this.parseErrorResponse(response);
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterSeconds = parsed.retryAfter ?? (retryAfterHeader ? Number(retryAfterHeader) : undefined);

        if (this.shouldRetryStatus(response.status) && attempt < this.maxRetries) {
          const delay = this.retryDelay(attempt, retryAfterSeconds);
          await sleep(delay);
          continue;
        }

        throw this.mapHttpError(response.status, parsed, retryAfterSeconds);
      } catch (err) {
        clearTimeout(timeoutHandle);

        if (err instanceof ScreenForgeError) {
          throw err;
        }

        if (err instanceof DOMException && err.name === 'AbortError') {
          const timeoutError = new ScreenForgeError(`Request timed out after ${this.timeout}ms`, {
            code: 'TIMEOUT',
          });

          if (attempt < this.maxRetries) {
            await sleep(this.retryDelay(attempt));
            continue;
          }

          throw timeoutError;
        }

        if (attempt < this.maxRetries) {
          await sleep(this.retryDelay(attempt));
          continue;
        }

        throw new ScreenForgeError('Network request failed', { cause: err, code: 'NETWORK_ERROR' });
      }
    }
  }

  private shouldRetryStatus(status: number): boolean {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  private retryDelay(attempt: number, retryAfterSeconds?: number): number {
    if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }

    return this.retryBaseDelayMs * (2 ** attempt);
  }

  private async parseErrorResponse(response: Response): Promise<ApiErrorResponse> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return { error: response.statusText || 'Request failed' };
    }

    try {
      return (await response.json()) as ApiErrorResponse;
    } catch {
      return { error: response.statusText || 'Request failed' };
    }
  }

  private mapHttpError(status: number, parsed: ApiErrorResponse, retryAfter?: number): ScreenForgeError {
    const message = this.errorMessage(parsed, status);
    const details: RequestErrorDetails = {
      status,
      code: parsed.code,
      details: parsed.details,
      requestId: parsed.request_id,
      retryAfter,
    };

    if (status === 429) {
      return new RateLimitError(message, details);
    }

    if (status === 400) {
      return new ValidationError(message, details);
    }

    if (status === 401 || status === 403) {
      return new AuthenticationError(message, details);
    }

    return new ScreenForgeError(message, details);
  }

  private errorMessage(parsed: ApiErrorResponse, status: number): string {
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      return parsed.error;
    }

    if (parsed.error && typeof parsed.error === 'object' && typeof parsed.error.message === 'string') {
      return parsed.error.message;
    }

    return `Request failed with status ${status}`;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
