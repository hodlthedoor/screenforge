# ScreenForge JavaScript SDK - Implementation Plan

## Overview

Create an official JavaScript/TypeScript SDK for the ScreenForge API as a standalone npm package. The SDK will provide a type-safe, ergonomic interface for all ScreenForge features: screenshots, PDFs, OG cards, batch rendering, async jobs, and webhooks.

## Package Details

- **Package Name**: `@screenforge/sdk` (or `screenforge-sdk`)
- **Target Environments**: Node.js 18+ and modern browsers
- **Bundle Formats**: ESM and CJS
- **Language**: TypeScript (strict mode)
- **Dependencies**: Minimal (zero if possible, zod for validation)

## Architecture

```
@screenforge/sdk
├── src/
│   ├── client.ts           # Main SDK client class
│   ├── types.ts            # All type definitions
│   ├── schemas.ts          # Zod schemas (mirror server schemas)
│   ├── errors.ts           # Custom error classes
│   ├── resources/
│   │   ├── screenshots.ts  # Screenshot API methods
│   │   ├── pdfs.ts        # PDF API methods
│   │   ├── og.ts          # OG card API methods
│   │   ├── batch.ts       # Batch API methods
│   │   ├── jobs.ts        # Async job polling
│   │   └── webhooks.ts    # Webhook signature verification
│   ├── utils/
│   │   ├── fetch.ts       # HTTP client wrapper
│   │   ├── retry.ts       # Retry logic with exponential backoff
│   │   └── validation.ts  # Input validation helpers
│   └── index.ts           # Public API exports
├── tests/
│   ├── unit/              # Unit tests (mocked HTTP)
│   └── integration/       # Integration tests (real API)
├── examples/
│   ├── basic.ts
│   ├── batch.ts
│   ├── async.ts
│   └── webhooks.ts
└── package.json
```

## Data Flow

### Synchronous Rendering
```
User code → SDK client → HTTP POST /v1/screenshot
         ← Buffer + metadata ← Server
```

### Async Rendering
```
User code → SDK client → HTTP POST /v1/screenshot?async=true
         ← Job ID + poll URL ← Server
User code → SDK.waitForJob(jobId) → Polls /v1/render/:id
         ← Buffer + metadata ← Server (when complete)
```

### Batch Rendering
```
User code → SDK client → HTTP POST /v1/batch
         ← Batch ID + job IDs ← Server
User code → SDK.waitForBatch(batchId) → Polls /v1/batch/:id
         ← All results ← Server (when complete)
```

### Webhook Verification
```
Incoming webhook → SDK.verifyWebhook(signature, body, secret)
                ← true/false
```

## File Structure & Implementation Details

### 1. `src/client.ts` - Main SDK Client

**Purpose**: Central client class with API key management and resource routing

```typescript
export class ScreenForge {
  private apiKey?: string;
  private baseUrl: string;
  private timeout: number;

  public screenshots: Screenshots;
  public pdfs: Pdfs;
  public og: OgCards;
  public batch: Batch;
  public jobs: Jobs;

  constructor(options: ScreenForgeOptions) {
    // Initialize resources with shared config
  }

  // Internal HTTP methods used by resources
  private async request<T>(options: RequestOptions): Promise<T>
}
```

**Edge Cases**:
- Missing/invalid API key (throw on instantiation or first request?)
- Network timeouts → retry with exponential backoff
- Rate limiting → respect Retry-After headers
- Invalid base URL format

### 2. `src/types.ts` - Type Definitions

**Purpose**: TypeScript interfaces matching ScreenForge API schemas

```typescript
export interface ScreenshotOptions {
  url: string;
  viewport?: { width: number; height: number };
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  selector?: string;
  waitFor?: string;
  darkMode?: boolean;
  deviceScaleFactor?: number;
}

export interface PdfOptions {
  url: string;
  format?: 'a4' | 'letter' | 'legal';
  landscape?: boolean;
  margins?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  printBackground?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  scale?: number;
}

export interface OgCardOptions {
  url?: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  theme?: 'light' | 'dark';
  template?: 'default' | 'article' | 'product';
}

export interface BatchItem {
  type: 'screenshot' | 'pdf';
  url: string;
  options?: Record<string, unknown>;
  callbackUrl?: string;
}

export interface RenderJob {
  id: string;
  type: 'screenshot' | 'pdf';
  url: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  contentType?: string;
  durationMs?: number;
  createdAt: string;
  completedAt?: string;
}

export interface RenderResult {
  buffer: Buffer;
  contentType: string;
  durationMs?: number;
  cached?: boolean;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id: string;
  };
}
```

**Edge Cases**:
- Browser-only types (no Buffer) → use Blob or ArrayBuffer
- Optional fields with sensible defaults
- Strict vs loose mode (runtime validation)

### 3. `src/schemas.ts` - Zod Validation Schemas

**Purpose**: Runtime validation matching server-side schemas

```typescript
import { z } from 'zod';

// Mirror server schemas EXACTLY
export const screenshotOptionsSchema = z.object({
  url: z.string().url(),
  viewport: z.object({
    width: z.number().int().min(1).max(7680).default(1920),
    height: z.number().int().min(1).max(4320).default(1080),
  }).default({ width: 1920, height: 1080 }),
  format: z.enum(['png', 'jpeg']).default('png'),
  quality: z.number().int().min(0).max(100).optional(),
  fullPage: z.boolean().default(false),
  selector: z.string().optional(),
  waitFor: z.string().optional(),
  darkMode: z.boolean().default(false),
  deviceScaleFactor: z.number().min(0.5).max(4).default(1),
});

// Additional schemas for other endpoints...
```

**Edge Cases**:
- Schema version mismatch between SDK and API
- Provide option to disable validation for performance
- Transform/coerce types (string → number)

### 4. `src/errors.ts` - Custom Error Classes

**Purpose**: Typed errors for different failure modes

```typescript
export class ScreenForgeError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ScreenForgeError';
  }
}

export class ValidationError extends ScreenForgeError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, undefined, details);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends ScreenForgeError {
  constructor(message: string, public retryAfter: number) {
    super(message, 'RATE_LIMITED', 429);
    this.name = 'RateLimitError';
  }
}

export class QuotaExceededError extends ScreenForgeError {
  constructor(message: string) {
    super(message, 'QUOTA_EXCEEDED', 429);
    this.name = 'QuotaExceededError';
  }
}

export class RenderTimeoutError extends ScreenForgeError {
  constructor(message: string) {
    super(message, 'RENDER_TIMEOUT', 504);
    this.name = 'RenderTimeoutError';
  }
}

export class JobNotFoundError extends ScreenForgeError {
  constructor(jobId: string) {
    super(`Job ${jobId} not found`, 'JOB_NOT_FOUND', 404);
    this.name = 'JobNotFoundError';
  }
}
```

**Edge Cases**:
- Network errors vs API errors
- Parse error responses with missing fields
- Unrecognized error codes → generic ScreenForgeError

### 5. `src/resources/screenshots.ts` - Screenshot API

**Purpose**: Screenshot-specific methods

```typescript
export class Screenshots {
  constructor(private client: ScreenForgeClient) {}

  async create(options: ScreenshotOptions): Promise<RenderResult> {
    // Validate options
    const validated = screenshotOptionsSchema.parse(options);

    // POST to /v1/screenshot
    const response = await this.client.request({
      method: 'POST',
      path: '/v1/screenshot',
      body: validated,
      responseType: 'buffer',
    });

    return {
      buffer: response.body,
      contentType: response.headers['content-type'],
      durationMs: parseInt(response.headers['x-render-duration-ms'] ?? '0'),
      cached: response.headers['x-cache'] === 'HIT',
    };
  }

  async createAsync(options: ScreenshotOptions, callbackUrl?: string): Promise<RenderJob> {
    // POST to /v1/screenshot?async=true
    const response = await this.client.request({
      method: 'POST',
      path: '/v1/screenshot',
      query: { async: 'true' },
      body: { ...options, callback_url: callbackUrl },
      responseType: 'json',
    });

    return response as RenderJob;
  }
}
```

**Edge Cases**:
- Binary response handling (Node vs Browser)
- Large file responses (stream vs buffer)
- Content-Type validation

### 6. `src/resources/jobs.ts` - Job Polling & Management

**Purpose**: Async job polling with timeout/retry

```typescript
export class Jobs {
  constructor(private client: ScreenForgeClient) {}

  async get(jobId: string): Promise<RenderJob> {
    const response = await this.client.request({
      method: 'GET',
      path: `/v1/render/${jobId}`,
      responseType: 'json',
    });
    return response as RenderJob;
  }

  async getResult(jobId: string): Promise<RenderResult> {
    // Accept header to get binary result directly
    const response = await this.client.request({
      method: 'GET',
      path: `/v1/render/${jobId}`,
      headers: { Accept: 'image/*, application/pdf' },
      responseType: 'buffer',
    });

    return {
      buffer: response.body,
      contentType: response.headers['content-type'],
      durationMs: parseInt(response.headers['x-render-duration-ms'] ?? '0'),
    };
  }

  async waitFor(
    jobId: string,
    options: { timeout?: number; interval?: number } = {},
  ): Promise<RenderResult> {
    const timeout = options.timeout ?? 60_000; // 60s default
    const interval = options.interval ?? 1_000; // 1s default
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const job = await this.get(jobId);

      if (job.status === 'completed') {
        return this.getResult(jobId);
      }

      if (job.status === 'failed') {
        throw new ScreenForgeError(
          job.error ?? 'Render failed',
          'RENDER_FAILED',
          500,
        );
      }

      await sleep(interval);
    }

    throw new RenderTimeoutError('Job polling timed out');
  }
}
```

**Edge Cases**:
- Job never completes → timeout
- Job transitions to failed mid-poll
- Network failure during polling → retry
- Exponential backoff for long-running jobs

### 7. `src/resources/batch.ts` - Batch API

**Purpose**: Batch rendering with parallel job management

```typescript
export class Batch {
  constructor(private client: ScreenForgeClient) {}

  async create(items: BatchItem[]): Promise<{
    batchId: string;
    jobs: Array<{ id: string; pollUrl: string }>;
  }> {
    if (items.length === 0 || items.length > 50) {
      throw new ValidationError('Batch must contain 1-50 items');
    }

    const response = await this.client.request({
      method: 'POST',
      path: '/v1/batch',
      body: { items },
      responseType: 'json',
    });

    return response;
  }

  async getStatus(batchId: string): Promise<{
    id: string;
    total: number;
    completed: number;
    failed: number;
    status: 'processing' | 'completed' | 'failed';
    jobs: RenderJob[];
  }> {
    const response = await this.client.request({
      method: 'GET',
      path: `/v1/batch/${batchId}`,
      responseType: 'json',
    });
    return response;
  }

  async waitFor(
    batchId: string,
    options: { timeout?: number; interval?: number; onProgress?: (completed: number, total: number) => void } = {},
  ): Promise<RenderJob[]> {
    const timeout = options.timeout ?? 300_000; // 5min default
    const interval = options.interval ?? 2_000; // 2s default
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const status = await this.getStatus(batchId);

      options.onProgress?.(status.completed, status.total);

      if (status.status === 'completed' || status.status === 'failed') {
        return status.jobs;
      }

      await sleep(interval);
    }

    throw new RenderTimeoutError('Batch polling timed out');
  }
}
```

**Edge Cases**:
- Partial batch failure (some succeed, some fail)
- Progress tracking callbacks
- Cancel batch mid-flight (not supported by API yet)

### 8. `src/resources/webhooks.ts` - Webhook Verification

**Purpose**: Verify webhook signatures from ScreenForge

```typescript
import { createHmac } from 'node:crypto';

export class Webhooks {
  verifySignature(
    signature: string,
    timestamp: string,
    body: string | Buffer,
    secret: string,
  ): boolean {
    const payload = `${timestamp}.${typeof body === 'string' ? body : body.toString('utf-8')}`;
    const expectedSignature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return signature === expectedSignature;
  }

  constructEvent(
    signature: string,
    timestamp: string,
    body: string | Buffer,
    secret: string,
    options: { toleranceSeconds?: number } = {},
  ): WebhookEvent {
    // Verify signature
    if (!this.verifySignature(signature, timestamp, body, secret)) {
      throw new ScreenForgeError(
        'Invalid webhook signature',
        'WEBHOOK_VERIFICATION_FAILED',
        400,
      );
    }

    // Check timestamp tolerance (prevent replay attacks)
    const tolerance = options.toleranceSeconds ?? 300; // 5min default
    const now = Math.floor(Date.now() / 1000);
    const eventTime = parseInt(timestamp, 10);

    if (Math.abs(now - eventTime) > tolerance) {
      throw new ScreenForgeError(
        'Webhook timestamp too old',
        'WEBHOOK_TIMESTAMP_INVALID',
        400,
      );
    }

    // Parse event
    const event = JSON.parse(typeof body === 'string' ? body : body.toString('utf-8'));
    return event as WebhookEvent;
  }
}

export interface WebhookEvent {
  type: 'render.completed' | 'render.failed';
  data: {
    jobId: string;
    url: string;
    status: string;
    error?: string;
  };
}
```

**Edge Cases**:
- Replay attacks → timestamp validation
- Browser environment (no crypto module) → use Web Crypto API
- Invalid JSON in body
- Missing signature headers

### 9. `src/utils/fetch.ts` - HTTP Client

**Purpose**: Unified HTTP client with retry logic

```typescript
export interface FetchOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  responseType: 'json' | 'buffer';
  timeout?: number;
  retries?: number;
}

export class HttpClient {
  constructor(
    private baseUrl: string,
    private apiKey?: string,
    private timeout = 30_000,
  ) {}

  async request(options: FetchOptions): Promise<{
    body: unknown;
    headers: Record<string, string>;
    status: number;
  }> {
    const url = new URL(options.path, this.baseUrl);

    // Add query params
    if (options.query) {
      Object.entries(options.query).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const headers: Record<string, string> = {
      ...options.headers,
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    if (options.body && options.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    // Retry logic with exponential backoff
    const maxRetries = options.retries ?? 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? this.timeout);

        const response = await fetch(url.toString(), {
          method: options.method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Parse response
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        // Handle error responses
        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw parseApiError(response.status, errorBody);
        }

        // Parse success response
        const body = options.responseType === 'json'
          ? await response.json()
          : Buffer.from(await response.arrayBuffer());

        return { body, headers: responseHeaders, status: response.status };

      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx except 429)
        if (error instanceof ScreenForgeError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
          throw error;
        }

        // Exponential backoff before retry
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10_000);
          await sleep(delay);
        }
      }
    }

    throw lastError ?? new Error('Request failed');
  }
}

function parseApiError(status: number, body: ErrorResponse | Record<string, unknown>): ScreenForgeError {
  if ('error' in body && typeof body.error === 'object' && body.error) {
    const err = body.error as { code?: string; message?: string; details?: unknown; request_id?: string };

    // Map to specific error classes
    switch (err.code) {
      case 'RATE_LIMITED':
        return new RateLimitError(err.message ?? 'Rate limited', 0);
      case 'QUOTA_EXCEEDED':
        return new QuotaExceededError(err.message ?? 'Quota exceeded');
      case 'RENDER_TIMEOUT':
        return new RenderTimeoutError(err.message ?? 'Render timeout');
      case 'JOB_NOT_FOUND':
        return new JobNotFoundError('');
      default:
        return new ScreenForgeError(
          err.message ?? 'Unknown error',
          err.code ?? 'UNKNOWN',
          status,
          err.request_id,
          err.details,
        );
    }
  }

  return new ScreenForgeError('Request failed', 'UNKNOWN', status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Edge Cases**:
- AbortController not available (older Node)
- Network errors vs timeout vs abort
- Response too large → streaming
- Rate limit headers → respect Retry-After

### 10. `src/index.ts` - Public API

**Purpose**: Clean public exports

```typescript
export { ScreenForge } from './client.js';
export type {
  ScreenForgeOptions,
  ScreenshotOptions,
  PdfOptions,
  OgCardOptions,
  BatchItem,
  RenderJob,
  RenderResult,
  WebhookEvent,
} from './types.js';
export {
  ScreenForgeError,
  ValidationError,
  RateLimitError,
  QuotaExceededError,
  RenderTimeoutError,
  JobNotFoundError,
} from './errors.js';
```

## Testing Strategy

### Unit Tests (`tests/unit/`)

Mock all HTTP calls using a mock fetch implementation or library like `nock`.

**Test Coverage**:
- ✅ Client initialization (valid/invalid options)
- ✅ Request building (headers, query params, body)
- ✅ Response parsing (JSON, Buffer, errors)
- ✅ Error handling (network, timeout, API errors)
- ✅ Retry logic (exponential backoff)
- ✅ Schema validation (valid/invalid inputs)
- ✅ Webhook signature verification
- ✅ Job polling (success, failure, timeout)
- ✅ Batch processing

### Integration Tests (`tests/integration/`)

Test against real ScreenForge API (requires running instance).

**Test Coverage**:
- ✅ Screenshot creation (sync & async)
- ✅ PDF generation
- ✅ OG card generation
- ✅ Batch rendering
- ✅ Job polling
- ✅ Rate limiting (trigger and recover)
- ✅ Webhook delivery

## Build & Distribution

### package.json

```json
{
  "name": "@screenforge/sdk",
  "version": "1.0.0",
  "description": "Official JavaScript SDK for ScreenForge API",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "TEST_INTEGRATION=true vitest run tests/integration",
    "lint": "eslint src/ tests/",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build && npm test"
  },
  "keywords": ["screenshot", "pdf", "render", "api", "og-cards"],
  "license": "MIT",
  "engines": {
    "node": ">=18"
  },
  "dependencies": {
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^25.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.9.0",
    "vitest": "^4.0.0",
    "eslint": "^10.0.0"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/screenforge/sdk-js.git"
  },
  "bugs": {
    "url": "https://github.com/screenforge/sdk-js/issues"
  }
}
```

### Build Tool: tsup

Use `tsup` for fast, zero-config bundling:
- ESM + CJS output
- Type declarations
- Tree-shakeable
- Source maps

## Edge Cases & Error Scenarios

### Network Failures
- **Timeout**: Retry with exponential backoff (max 3 attempts)
- **Connection refused**: Throw immediately (no retry)
- **DNS failure**: Throw immediately (no retry)

### API Errors
- **400 Validation**: Throw `ValidationError` with details
- **401 Unauthorized**: Throw `ScreenForgeError` (no retry)
- **429 Rate Limited**: Extract `Retry-After`, wait, then retry once
- **500 Server Error**: Retry with backoff (max 3 attempts)
- **504 Gateway Timeout**: Map to `RenderTimeoutError`

### Data Handling
- **Large responses**: For very large files (>50MB), consider streaming API
- **Binary data**: Ensure Buffer/Blob compatibility across environments
- **Malformed JSON**: Catch parse errors, wrap in `ScreenForgeError`

### Job Polling
- **Job stuck in 'processing'**: Timeout after configurable duration
- **Job transitions to 'failed'**: Throw with error message from API
- **Polling interval**: Start at 1s, increase to 5s after 10 attempts (adaptive)

### Webhook Verification
- **Missing signature header**: Throw immediately
- **Clock skew**: Allow configurable tolerance (default 5min)
- **Invalid secret**: Verification fails silently (return false)

### Browser vs Node.js
- **crypto module**: Use Web Crypto API in browsers for HMAC
- **Buffer class**: Use `Uint8Array` or `Blob` in browsers
- **fetch polyfill**: Not needed (native in modern browsers & Node 18+)

## Documentation

### README.md Sections
1. **Installation**: `npm install @screenforge/sdk`
2. **Quick Start**: Basic screenshot example
3. **Authentication**: API key setup
4. **API Reference**:
   - Screenshots (sync & async)
   - PDFs
   - OG Cards
   - Batch rendering
   - Job polling
   - Webhook verification
5. **Error Handling**: Error types and retry strategies
6. **TypeScript**: Type definitions and IDE autocomplete
7. **Examples**: Link to `/examples` directory

### JSDoc Comments
- Add JSDoc to all public methods
- Include parameter descriptions
- Link to API docs where relevant
- Add `@example` tags for common use cases

## Rollout Plan

### Phase 1: Core SDK (MVP)
- ✅ HTTP client with retry logic
- ✅ Screenshots resource (sync only)
- ✅ PDF resource (sync only)
- ✅ Error handling
- ✅ TypeScript types
- ✅ Unit tests
- ✅ README with examples

### Phase 2: Async & Batch
- ✅ Async rendering (job polling)
- ✅ Batch API
- ✅ OG cards
- ✅ Advanced retry strategies
- ✅ Integration tests

### Phase 3: Webhooks & Polish
- ✅ Webhook signature verification
- ✅ Browser compatibility testing
- ✅ Performance benchmarks
- ✅ Full API docs (TypeDoc)
- ✅ Publish to npm

## Success Metrics

- **API Coverage**: 100% of ScreenForge endpoints supported
- **Test Coverage**: >90% line coverage
- **Bundle Size**: <50KB minified (tree-shakeable)
- **Zero Breaking Changes**: Strict semver adherence
- **Documentation**: Every public method documented with examples

## Open Questions

1. **Streaming API**: Should SDK support streaming for large files? (Future feature)
2. **Rate Limit Queue**: Should SDK queue requests when rate limited? (No - let users handle)
3. **Browser File Download**: Provide helper to download Buffer as file in browser?
4. **Abort Controller**: Expose request cancellation via AbortSignal?
5. **Usage Tracking**: Should SDK expose `/v1/usage` endpoint methods?

## Dependencies

- `zod`: Schema validation (matches server-side)
- `fetch`: Native in Node 18+ and browsers (no polyfill needed)
- `crypto`: Native module (Web Crypto API for browsers)

## Related Files (ScreenForge Server)

Reference these for schema/API parity:
- `src/renderer/schemas.ts` - Validation schemas
- `src/routes/render.ts` - Screenshot/PDF endpoints
- `src/routes/batch.ts` - Batch endpoint
- `src/routes/async-render.ts` - Job polling
- `src/routes/og.ts` - OG card endpoint
- `src/webhooks/signer.ts` - Webhook signing logic
- `src/security/errors.ts` - Error codes and formats
