import type {
  AccessibilityOptions,
  AccessibilityReport,
  AnalyticsData,
  AsyncRenderResponse,
  BatchItem,
  BatchJob,
  BatchRenderResponse,
  CreateScheduleOptions,
  DiffOptions,
  ExtractOptions,
  ExtractResult,
  GifOptions,
  ListWebhookDeliveriesOptions,
  OgOptions,
  PdfOptions,
  RenderJob,
  Schedule,
  ScreenshotOptions,
  UpdateScheduleOptions,
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
  error?: unknown;
  code?: string;
  details?: unknown;
  request_id?: string;
  requestId?: string;
  retryAfter?: number;
  retry_after?: number;
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
    this.baseUrl = (options.baseUrl ?? 'http://localhost:3100').replace(/\/$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  }

  async screenshot(urlOrOptions: string | ScreenshotOptions, options: ScreenshotOptions = {}): Promise<Buffer> {
    const body = typeof urlOrOptions === 'string' ? { url: urlOrOptions, ...options } : urlOrOptions;
    return this.request<Buffer>('POST', '/v1/screenshot', body, { expectBinary: true });
  }

  async pdf(urlOrOptions: string | PdfOptions, options: PdfOptions = {}): Promise<Buffer> {
    const body = typeof urlOrOptions === 'string' ? { url: urlOrOptions, ...options } : urlOrOptions;
    return this.request<Buffer>('POST', '/v1/pdf', body, { expectBinary: true });
  }

  async og(url: string, options: OgOptions = {}): Promise<Buffer> {
    return this.request<Buffer>('POST', '/v1/og', { url, ...options }, { expectBinary: true });
  }

  async screenshotAsync(urlOrOptions: string | ScreenshotOptions, options: ScreenshotOptions = {}): Promise<AsyncRenderResponse> {
    const body = typeof urlOrOptions === 'string' ? { url: urlOrOptions, ...options } : urlOrOptions;
    const result = await this.request<{ id?: string; jobId?: string; pollUrl: string }>(
      'POST',
      '/v1/screenshot?async=true',
      body,
    );
    const jobId = normalizeNonEmptyString(result.jobId) ?? normalizeNonEmptyString(result.id);
    const pollUrl = normalizeNonEmptyString(result.pollUrl);
    if (!jobId || !pollUrl) {
      throw new ScreenForgeError('Malformed API response: expected jobId/id and pollUrl', {
        code: 'MALFORMED_RESPONSE',
        details: result,
      });
    }

    return {
      jobId,
      pollUrl,
    };
  }

  async pdfAsync(urlOrOptions: string | PdfOptions, options: PdfOptions = {}): Promise<AsyncRenderResponse> {
    const body = typeof urlOrOptions === 'string' ? { url: urlOrOptions, ...options } : urlOrOptions;
    const result = await this.request<{ id?: string; jobId?: string; pollUrl: string }>(
      'POST',
      '/v1/pdf?async=true',
      body,
    );
    const jobId = normalizeNonEmptyString(result.jobId) ?? normalizeNonEmptyString(result.id);
    const pollUrl = normalizeNonEmptyString(result.pollUrl);
    if (!jobId || !pollUrl) {
      throw new ScreenForgeError('Malformed API response: expected jobId/id and pollUrl', {
        code: 'MALFORMED_RESPONSE',
        details: result,
      });
    }

    return {
      jobId,
      pollUrl,
    };
  }

  async batchRender(items: BatchItem[]): Promise<BatchRenderResponse> {
    const result = await this.request<{ batchId: string; jobs: Array<{ id?: string; jobId?: string; pollUrl: string }> }>(
      'POST',
      '/v1/batch',
      { items },
    );
    const batchId = normalizeNonEmptyString(result.batchId);
    if (!batchId || !Array.isArray(result.jobs)) {
      throw new ScreenForgeError('Malformed API response: expected batchId and jobs array', {
        code: 'MALFORMED_RESPONSE',
        details: result,
      });
    }

    return {
      batchId,
      jobs: result.jobs.map((job) => {
        const jobId = normalizeNonEmptyString(job.jobId) ?? normalizeNonEmptyString(job.id);
        const pollUrl = normalizeNonEmptyString(job.pollUrl);
        if (!jobId || !pollUrl) {
          throw new ScreenForgeError('Malformed API response: expected jobId/id and pollUrl for each batch job', {
            code: 'MALFORMED_RESPONSE',
            details: job,
          });
        }
        return { jobId, pollUrl };
      }),
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

  async analytics(): Promise<AnalyticsData> {
    return this.request<AnalyticsData>('GET', '/v1/analytics');
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

  async extract(options: ExtractOptions): Promise<ExtractResult> {
    const result = await this.request<{
      extractionId?: string;
      data: unknown;
      modelUsed?: string;
      tokensUsed?: number;
      screenshotPath?: string;
      durationMs?: number;
    }>('POST', '/v1/extract', options);

    const extractionId = normalizeNonEmptyString(result.extractionId);
    const modelUsed = normalizeNonEmptyString(result.modelUsed);
    if (!extractionId || !modelUsed || typeof result.tokensUsed !== 'number' || typeof result.durationMs !== 'number') {
      throw new ScreenForgeError('Malformed API response: expected extractionId, modelUsed, tokensUsed, and durationMs', {
        code: 'MALFORMED_RESPONSE',
        details: result,
      });
    }

    return {
      extractionId,
      data: result.data,
      modelUsed,
      tokensUsed: result.tokensUsed,
      screenshotPath: result.screenshotPath,
      durationMs: result.durationMs,
    };
  }

  async accessibility(url: string, options: Omit<AccessibilityOptions, 'url'> = {}): Promise<AccessibilityReport> {
    const result = await this.request<AccessibilityReport>('POST', '/v1/accessibility', {
      url,
      ...options,
    });

    const auditId = normalizeNonEmptyString(result.auditId);
    if (!auditId || !Array.isArray(result.violations) || typeof result.passesCount !== 'number') {
      throw new ScreenForgeError('Malformed API response: expected auditId, violations array, and passesCount', {
        code: 'MALFORMED_RESPONSE',
        details: result,
      });
    }

    return result;
  }

  async gif(options: GifOptions): Promise<Buffer> {
    return this.request<Buffer>('POST', '/v1/gif', options, { expectBinary: true });
  }

  async gifAsync(options: GifOptions): Promise<AsyncRenderResponse> {
    const result = await this.request<{ id?: string; jobId?: string; pollUrl?: string }>('POST', '/v1/gif?async=true', options);

    const jobId = normalizeNonEmptyString(result.jobId ?? result.id);
    const pollUrl = normalizeNonEmptyString(result.pollUrl);
    if (!jobId || !pollUrl) {
      throw new ScreenForgeError('Malformed API response: expected jobId/id and pollUrl', {
        code: 'MALFORMED_RESPONSE',
        details: result,
      });
    }

    return { jobId, pollUrl };
  }

  async diff(options: DiffOptions): Promise<Buffer> {
    return this.request<Buffer>('POST', '/v1/diff', options, { expectBinary: true });
  }

  async createSchedule(options: CreateScheduleOptions): Promise<Schedule> {
    const result = await this.request<{ schedule?: Schedule }>('POST', '/v1/schedules', options);

    if (!result.schedule || !normalizeNonEmptyString(result.schedule.id)) {
      throw new ScreenForgeError('Malformed API response: expected schedule object with id', {
        code: 'MALFORMED_RESPONSE',
        details: result,
      });
    }

    return result.schedule;
  }

  async listSchedules(): Promise<Schedule[]> {
    const result = await this.request<{ schedules?: Schedule[] }>('GET', '/v1/schedules');

    if (!Array.isArray(result.schedules)) {
      throw new ScreenForgeError('Malformed API response: expected schedules array', {
        code: 'MALFORMED_RESPONSE',
        details: result,
      });
    }

    return result.schedules;
  }

  async getSchedule(id: string): Promise<Schedule> {
    const result = await this.request<{ schedule?: Schedule }>('GET', `/v1/schedules/${encodeURIComponent(id)}`);

    if (!result.schedule || !normalizeNonEmptyString(result.schedule.id)) {
      throw new ScreenForgeError('Malformed API response: expected schedule object with id', {
        code: 'MALFORMED_RESPONSE',
        details: result,
      });
    }

    return result.schedule;
  }

  async updateSchedule(id: string, options: UpdateScheduleOptions): Promise<Schedule> {
    const result = await this.request<{ schedule?: Schedule }>('PATCH', `/v1/schedules/${encodeURIComponent(id)}`, options);

    if (!result.schedule || !normalizeNonEmptyString(result.schedule.id)) {
      throw new ScreenForgeError('Malformed API response: expected schedule object with id', {
        code: 'MALFORMED_RESPONSE',
        details: result,
      });
    }

    return result.schedule;
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.request('DELETE', `/v1/schedules/${encodeURIComponent(id)}`);
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
          const text = await response.text();
          if (!text || text.trim().length === 0) {
            return undefined as T;
          }
          return JSON.parse(text) as T;
        }

        const parsed = await this.parseErrorResponse(response);
        const metadata = this.extractErrorMetadata(parsed, response.status);
        const retryAfterHeader = this.parseRetryAfterHeader(response.headers.get('retry-after'));
        const retryAfterSeconds = metadata.retryAfter ?? retryAfterHeader;
        if (retryAfterSeconds !== undefined) {
          metadata.retryAfter = retryAfterSeconds;
        }

        if (this.shouldRetryStatus(response.status) && attempt < this.maxRetries) {
          const delay = this.retryDelay(attempt, retryAfterSeconds);
          await sleep(delay);
          continue;
        }

        throw this.mapHttpError(response.status, metadata);
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

  private mapHttpError(status: number, metadata: NormalizedApiError): ScreenForgeError {
    const details: RequestErrorDetails = {
      status,
      code: metadata.code,
      details: metadata.details,
      requestId: metadata.requestId,
      retryAfter: metadata.retryAfter,
    };

    if (status === 429) {
      return new RateLimitError(metadata.message, details);
    }

    if (status === 400) {
      return new ValidationError(metadata.message, details);
    }

    if (status === 401 || status === 403) {
      return new AuthenticationError(metadata.message, details);
    }

    return new ScreenForgeError(metadata.message, details);
  }

  private extractErrorMetadata(parsed: ApiErrorResponse, status: number): NormalizedApiError {
    const queue: Record<string, unknown>[] = [];
    const seen = new Set<Record<string, unknown>>();

    const enqueue = (value: unknown) => {
      if (!isObject(value)) {
        return;
      }
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
      queue.push(value);
    };

    enqueue(parsed);
    enqueue(parsed.error);

    let message: string | undefined;
    let code: string | undefined;
    let details: unknown;
    let requestId: string | undefined;
    let retryAfter: number | undefined;

    const topLevelError = normalizeNonEmptyString(parsed.error);
    if (topLevelError) {
      message = topLevelError;
    }

    while (queue.length > 0) {
      const current = queue.shift() as Record<string, unknown>;

      if (message === undefined && typeof current.message === 'string' && current.message.length > 0) {
        message = current.message;
      }

      if (code === undefined && typeof current.code === 'string' && current.code.length > 0) {
        code = current.code;
      }

      if (details === undefined && 'details' in current) {
        details = current.details;
      }

      if (
        requestId === undefined
        && typeof current.request_id === 'string'
        && current.request_id.length > 0
      ) {
        requestId = current.request_id;
      }

      if (
        requestId === undefined
        && typeof current.requestId === 'string'
        && current.requestId.length > 0
      ) {
        requestId = current.requestId;
      }

      if (retryAfter === undefined) {
        retryAfter = toRetryAfterSeconds(current.retryAfter) ?? toRetryAfterSeconds(current.retry_after);
      }

      enqueue(current.error);
    }

    if (retryAfter === undefined && isObject(details)) {
      retryAfter = toRetryAfterSeconds(details.retryAfter) ?? toRetryAfterSeconds(details.retry_after);
    }

    return {
      message: message ?? `Request failed with status ${status}`,
      code,
      details,
      requestId,
      retryAfter,
    };
  }

  private parseRetryAfterHeader(retryAfterHeader: string | null): number | undefined {
    if (!retryAfterHeader) {
      return undefined;
    }

    const asNumber = toRetryAfterSeconds(retryAfterHeader);
    if (asNumber !== undefined) {
      return asNumber;
    }

    const dateMs = Date.parse(retryAfterHeader);
    if (Number.isNaN(dateMs)) {
      return undefined;
    }

    const seconds = Math.ceil((dateMs - Date.now()) / 1000);
    return seconds > 0 ? seconds : undefined;
  }
}

interface NormalizedApiError {
  message: string;
  code?: string;
  details?: unknown;
  requestId?: string;
  retryAfter?: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toRetryAfterSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    return undefined;
  }

  return undefined;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
