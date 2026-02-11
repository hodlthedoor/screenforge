# JavaScript/TypeScript SDK Implementation Plan

## Overview
Create a publishable npm package (`@screenforge/sdk`) that provides a TypeScript-first client library for the ScreenForge API. The SDK will support all current API endpoints with full type safety, error handling, retry logic, and both sync/async rendering modes.

## Project Structure

```
sdk/js/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── .npmignore
├── README.md
├── LICENSE
├── src/
│   ├── index.ts           # Main export
│   ├── client.ts          # ScreenForge class
│   ├── types.ts           # TypeScript interfaces
│   ├── errors.ts          # Custom error classes
│   ├── utils.ts           # Retry logic, helpers
│   └── constants.ts       # Default values, timeouts
└── tests/
    ├── client.test.ts     # Client method tests
    ├── errors.test.ts     # Error handling tests
    ├── retry.test.ts      # Retry logic tests
    └── types.test.ts      # Type validation tests
```

## Files to Create

### 1. `sdk/js/package.json`
```json
{
  "name": "@screenforge/sdk",
  "version": "0.1.0",
  "description": "Official TypeScript/JavaScript SDK for ScreenForge screenshot & render API",
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
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build"
  },
  "keywords": [
    "screenforge",
    "screenshot",
    "pdf",
    "render",
    "api",
    "typescript"
  ],
  "engines": {
    "node": ">=18"
  },
  "dependencies": {},
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.9.0",
    "vitest": "^4.0.0",
    "@types/node": "^22.0.0"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/hodlthedoor/atlas-project.git",
    "directory": "screenforge/sdk/js"
  }
}
```

**Rationale**: Uses tsup for dual ESM/CJS builds, targets Node 18+ (native fetch support), zero runtime dependencies.

### 2. `sdk/js/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Rationale**: Strict TypeScript, generates declarations for IntelliSense.

### 3. `sdk/js/tsup.config.ts`
```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
});
```

**Rationale**: Dual ESM/CJS output for maximum compatibility, sourcemaps for debugging.

### 4. `sdk/js/src/types.ts`
**TypeScript interfaces matching ScreenForge API schemas:**

```typescript
// Screenshot Options
export interface Viewport {
  width: number;
  height: number;
}

export interface ScreenshotOptions {
  url: string;
  viewport?: Viewport;
  format?: 'png' | 'jpeg';
  quality?: number; // 0-100, only for jpeg
  fullPage?: boolean;
  selector?: string;
  waitFor?: string; // CSS selector to wait for
  darkMode?: boolean;
  deviceScaleFactor?: number; // 0.5-4
}

// PDF Options
export interface PdfMargins {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export interface PdfOptions {
  url: string;
  format?: 'a4' | 'letter' | 'legal';
  landscape?: boolean;
  margins?: PdfMargins;
  printBackground?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  scale?: number; // 0.1-2
}

// OG Card Options
export interface OgOptions {
  url?: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  theme?: 'light' | 'dark';
  template?: 'default' | 'article' | 'product';
}

// Batch Rendering
export interface BatchItem {
  type?: 'screenshot' | 'pdf';
  url: string;
  options?: Record<string, unknown>;
  callbackUrl?: string;
}

export interface BatchRequest {
  items: BatchItem[];
}

// Job Status
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface RenderJob {
  id: string;
  type: 'screenshot' | 'pdf' | 'og';
  url: string;
  status: JobStatus;
  error?: string;
  contentType?: string;
  durationMs?: number;
  createdAt: string;
  completedAt?: string;
  pollUrl: string;
}

export interface BatchJob {
  id: string;
  total: number;
  completed: number;
  failed: number;
  status: JobStatus;
  createdAt: string;
  completedAt?: string;
  jobs: Array<{
    id: string;
    type: string;
    url: string;
    status: JobStatus;
    error?: string;
    durationMs?: number;
    pollUrl: string;
  }>;
}

// Async render response
export interface AsyncRenderResponse {
  id: string;
  status: JobStatus;
  pollUrl: string;
}

// Batch create response
export interface BatchCreateResponse {
  batchId: string;
  total: number;
  status: string;
  jobs: Array<{
    id: string;
    pollUrl: string;
  }>;
  pollUrl: string;
}

// Usage Stats
export interface UsageStats {
  apiKeyId: string;
  tier: string;
  usage: {
    today: number;
    thisMonth: number;
    monthlyQuota: number;
    remaining: number;
  };
  rateLimit: {
    requestsPerMinute: number;
  };
}

// Webhook Delivery
export interface WebhookDelivery {
  id: string;
  jobId: string;
  url: string;
  status: 'pending' | 'retrying' | 'delivered' | 'failed';
  attempts: number;
  lastStatusCode?: number;
  lastError?: string;
  createdAt: string;
  deliveredAt?: string;
}

export interface ListWebhookDeliveriesOptions {
  page?: number;
  limit?: number;
}

export interface WebhookDeliveriesResponse {
  deliveries: WebhookDelivery[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

// Client Configuration
export interface ScreenForgeConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number; // Request timeout in ms
  maxRetries?: number; // Default: 2
  retryDelay?: number; // Initial retry delay in ms, default: 1000
}
```

**Rationale**: Maps directly to Zod schemas in `src/renderer/schemas.ts` and API response formats.

### 5. `sdk/js/src/errors.ts`
**Custom error classes for better error handling:**

```typescript
export class ScreenForgeError extends Error {
  public readonly statusCode?: number;
  public readonly code?: string;
  public readonly details?: unknown;
  public readonly requestId?: string;

  constructor(message: string, options?: {
    statusCode?: number;
    code?: string;
    details?: unknown;
    requestId?: string;
  }) {
    super(message);
    this.name = 'ScreenForgeError';
    this.statusCode = options?.statusCode;
    this.code = options?.code;
    this.details = options?.details;
    this.requestId = options?.requestId;
    Object.setPrototypeOf(this, ScreenForgeError.prototype);
  }
}

export class RateLimitError extends ScreenForgeError {
  public readonly retryAfter?: number; // seconds

  constructor(message: string, retryAfter?: number, options?: {
    requestId?: string;
    details?: unknown;
  }) {
    super(message, { statusCode: 429, code: 'RATE_LIMITED', ...options });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class ValidationError extends ScreenForgeError {
  constructor(message: string, details?: unknown, requestId?: string) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR', details, requestId });
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class AuthenticationError extends ScreenForgeError {
  constructor(message: string, requestId?: string) {
    super(message, { statusCode: 401, code: 'AUTH_REQUIRED', requestId });
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

export class QuotaExceededError extends ScreenForgeError {
  constructor(message: string, requestId?: string) {
    super(message, { statusCode: 429, code: 'QUOTA_EXCEEDED', requestId });
    this.name = 'QuotaExceededError';
    Object.setPrototypeOf(this, QuotaExceededError.prototype);
  }
}

export class JobNotFoundError extends ScreenForgeError {
  constructor(message: string, requestId?: string) {
    super(message, { statusCode: 404, code: 'JOB_NOT_FOUND', requestId });
    this.name = 'JobNotFoundError';
    Object.setPrototypeOf(this, JobNotFoundError.prototype);
  }
}
```

**Rationale**: Typed error classes make error handling more ergonomic for SDK users. Maps to API error codes.

### 6. `sdk/js/src/constants.ts`
**Default configuration values:**

```typescript
export const DEFAULT_BASE_URL = 'http://localhost:3100';
export const DEFAULT_TIMEOUT = 30000; // 30 seconds
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_DELAY = 1000; // 1 second
export const MAX_RETRY_DELAY = 10000; // 10 seconds

// Retryable HTTP status codes
export const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];
```

**Rationale**: Centralized configuration prevents magic numbers, makes testing easier.

### 7. `sdk/js/src/utils.ts`
**Retry logic with exponential backoff:**

```typescript
import { RETRYABLE_STATUS_CODES, MAX_RETRY_DELAY } from './constants.js';
import type { ScreenForgeConfig } from './types.js';

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function calculateBackoff(attempt: number, baseDelay: number): number {
  const delay = baseDelay * Math.pow(2, attempt);
  return Math.min(delay, MAX_RETRY_DELAY);
}

export function isRetryable(statusCode?: number): boolean {
  return statusCode ? RETRYABLE_STATUS_CODES.includes(statusCode) : false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Pick<ScreenForgeConfig, 'maxRetries' | 'retryDelay'>,
  isRetryableFn: (error: unknown) => boolean = () => false,
): Promise<T> {
  const maxRetries = config.maxRetries ?? 2;
  const retryDelay = config.retryDelay ?? 1000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Check if error is retryable
      if (!isRetryableFn(error)) {
        break;
      }

      // Calculate backoff delay
      const delay = calculateBackoff(attempt, retryDelay);
      await sleep(delay);
    }
  }

  throw lastError;
}
```

**Rationale**: Exponential backoff is industry standard for retries. Configurable but with sensible defaults.

### 8. `sdk/js/src/client.ts`
**Main ScreenForge client class:**

```typescript
import {
  ScreenForgeError,
  RateLimitError,
  ValidationError,
  AuthenticationError,
  QuotaExceededError,
  JobNotFoundError,
} from './errors.js';
import type {
  ScreenForgeConfig,
  ScreenshotOptions,
  PdfOptions,
  OgOptions,
  BatchRequest,
  BatchCreateResponse,
  RenderJob,
  BatchJob,
  UsageStats,
  AsyncRenderResponse,
  WebhookDeliveriesResponse,
  ListWebhookDeliveriesOptions,
  WebhookDelivery,
} from './types.js';
import { DEFAULT_BASE_URL, DEFAULT_TIMEOUT, DEFAULT_MAX_RETRIES, DEFAULT_RETRY_DELAY } from './constants.js';
import { withRetry, isRetryable } from './utils.js';

export class ScreenForge {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(config: ScreenForgeConfig) {
    if (!config.apiKey) {
      throw new Error('apiKey is required');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelay = config.retryDelay ?? DEFAULT_RETRY_DELAY;
  }

  /**
   * Fetch wrapper with retry logic and error handling
   */
  private async request<T = unknown>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    const doFetch = async (): Promise<T> => {
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': '@screenforge/sdk/0.1.0',
            ...options.headers,
          },
        });

        clearTimeout(timeoutId);

        // Handle error responses
        if (!response.ok) {
          await this.handleErrorResponse(response);
        }

        // Return JSON response for non-binary endpoints
        if (path.includes('/usage') || path.includes('/batch') || path.includes('/render/') || path.includes('/webhooks')) {
          return await response.json() as T;
        }

        // Return response for further processing (binary data)
        return response as unknown as T;
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof ScreenForgeError) {
          throw error;
        }

        // Handle network errors
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            throw new ScreenForgeError('Request timeout', { statusCode: 408 });
          }
          throw new ScreenForgeError(`Network error: ${error.message}`);
        }

        throw error;
      }
    };

    // Retry logic
    return withRetry(
      doFetch,
      { maxRetries: this.maxRetries, retryDelay: this.retryDelay },
      (error) => {
        if (error instanceof ScreenForgeError) {
          return isRetryable(error.statusCode);
        }
        return false;
      },
    );
  }

  /**
   * Parse error response and throw appropriate error
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: {
      error?: { code?: string; message?: string; details?: unknown; request_id?: string };
      code?: string;
      message?: string;
    };

    try {
      errorData = await response.json();
    } catch {
      // If JSON parse fails, use status text
      throw new ScreenForgeError(response.statusText, { statusCode: response.status });
    }

    const errorCode = errorData.error?.code ?? errorData.code;
    const errorMessage = errorData.error?.message ?? errorData.message ?? response.statusText;
    const requestId = errorData.error?.request_id;
    const details = errorData.error?.details;

    // Map error codes to custom error classes
    switch (errorCode) {
      case 'RATE_LIMITED': {
        const retryAfter = response.headers.get('Retry-After');
        throw new RateLimitError(errorMessage, retryAfter ? parseInt(retryAfter, 10) : undefined, { requestId, details });
      }
      case 'VALIDATION_ERROR':
        throw new ValidationError(errorMessage, details, requestId);
      case 'AUTH_REQUIRED':
      case 'INVALID_API_KEY':
      case 'API_KEY_DISABLED':
        throw new AuthenticationError(errorMessage, requestId);
      case 'QUOTA_EXCEEDED':
        throw new QuotaExceededError(errorMessage, requestId);
      case 'JOB_NOT_FOUND':
      case 'BATCH_NOT_FOUND':
        throw new JobNotFoundError(errorMessage, requestId);
      default:
        throw new ScreenForgeError(errorMessage, { statusCode: response.status, code: errorCode, details, requestId });
    }
  }

  /**
   * Capture a screenshot (synchronous)
   */
  async screenshot(url: string, options?: Omit<ScreenshotOptions, 'url'>): Promise<Buffer> {
    const body: ScreenshotOptions = { url, ...options };
    const response = await this.request<Response>('/v1/screenshot', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Generate a PDF (synchronous)
   */
  async pdf(url: string, options?: Omit<PdfOptions, 'url'>): Promise<Buffer> {
    const body: PdfOptions = { url, ...options };
    const response = await this.request<Response>('/v1/pdf', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Generate an Open Graph card (synchronous)
   */
  async og(options: OgOptions): Promise<Buffer> {
    const response = await this.request<Response>('/v1/og', {
      method: 'POST',
      body: JSON.stringify(options),
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Capture a screenshot (asynchronous - returns job ID)
   */
  async screenshotAsync(url: string, options?: Omit<ScreenshotOptions, 'url'>): Promise<AsyncRenderResponse> {
    const body: ScreenshotOptions = { url, ...options };
    return this.request<AsyncRenderResponse>('/v1/screenshot?async=true', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Generate a PDF (asynchronous - returns job ID)
   */
  async pdfAsync(url: string, options?: Omit<PdfOptions, 'url'>): Promise<AsyncRenderResponse> {
    const body: PdfOptions = { url, ...options };
    return this.request<AsyncRenderResponse>('/v1/pdf?async=true', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Submit a batch render request
   */
  async batchRender(items: BatchRequest['items']): Promise<BatchCreateResponse> {
    return this.request<BatchCreateResponse>('/v1/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  /**
   * Poll a render job status
   */
  async pollJob(jobId: string): Promise<RenderJob> {
    return this.request<RenderJob>(`/v1/render/${jobId}`);
  }

  /**
   * Poll a batch job status
   */
  async pollBatch(batchId: string): Promise<BatchJob> {
    return this.request<BatchJob>(`/v1/batch/${batchId}`);
  }

  /**
   * Get usage statistics for the current API key
   */
  async getUsage(): Promise<UsageStats> {
    return this.request<UsageStats>('/v1/usage');
  }

  /**
   * List webhook deliveries
   */
  async listWebhookDeliveries(options?: ListWebhookDeliveriesOptions): Promise<WebhookDeliveriesResponse> {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));

    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<WebhookDeliveriesResponse>(`/v1/webhooks/deliveries${query}`);
  }

  /**
   * Get a specific webhook delivery by ID
   */
  async getWebhookDelivery(deliveryId: string): Promise<WebhookDelivery> {
    return this.request<WebhookDelivery>(`/v1/webhooks/deliveries/${deliveryId}`);
  }
}
```

**Rationale**:
- Clean API surface matching REST endpoints
- Native fetch (Node 18+) eliminates dependencies
- Automatic retries with exponential backoff
- Type-safe error handling
- Buffer responses for binary data (screenshots, PDFs)
- Configurable timeouts

### 9. `sdk/js/src/index.ts`
**Main export file:**

```typescript
export { ScreenForge } from './client.js';
export * from './types.js';
export * from './errors.js';
```

**Rationale**: Single import for consumers: `import { ScreenForge } from '@screenforge/sdk'`

### 10. `sdk/js/README.md`
**Documentation and examples:**

````markdown
# @screenforge/sdk

Official TypeScript/JavaScript SDK for [ScreenForge](https://github.com/hodlthedoor/atlas-project) — self-hostable screenshot & render API.

## Installation

```bash
npm install @screenforge/sdk
```

## Quick Start

```typescript
import { ScreenForge } from '@screenforge/sdk';

const client = new ScreenForge({
  apiKey: 'your-api-key',
  baseUrl: 'http://localhost:3100', // optional, defaults to localhost:3100
});

// Take a screenshot
const screenshot = await client.screenshot('https://example.com', {
  format: 'png',
  viewport: { width: 1920, height: 1080 },
  fullPage: true,
});

// Save to file
await fs.writeFile('screenshot.png', screenshot);
```

## API Reference

### Configuration

```typescript
const client = new ScreenForge({
  apiKey: string;          // Required: Your API key
  baseUrl?: string;        // Optional: API base URL (default: http://localhost:3100)
  timeout?: number;        // Optional: Request timeout in ms (default: 30000)
  maxRetries?: number;     // Optional: Max retry attempts (default: 2)
  retryDelay?: number;     // Optional: Initial retry delay in ms (default: 1000)
});
```

### Methods

#### `screenshot(url, options?): Promise<Buffer>`

Capture a screenshot (synchronous).

```typescript
const buffer = await client.screenshot('https://example.com', {
  viewport: { width: 1920, height: 1080 },
  format: 'png',           // 'png' | 'jpeg'
  quality: 90,             // 0-100 (jpeg only)
  fullPage: false,         // Capture full page or just viewport
  selector: '.main',       // CSS selector to screenshot
  waitFor: '.content',     // Wait for selector before screenshot
  darkMode: false,         // Enable dark mode
  deviceScaleFactor: 1,    // 0.5-4 (for retina displays)
});
```

#### `pdf(url, options?): Promise<Buffer>`

Generate a PDF (synchronous).

```typescript
const buffer = await client.pdf('https://example.com', {
  format: 'a4',            // 'a4' | 'letter' | 'legal'
  landscape: false,
  margins: {
    top: '10mm',
    right: '10mm',
    bottom: '10mm',
    left: '10mm',
  },
  printBackground: true,
  headerTemplate: '<div>Header</div>',
  footerTemplate: '<div>Footer</div>',
  scale: 1,                // 0.1-2
});
```

#### `og(options): Promise<Buffer>`

Generate an Open Graph preview card.

```typescript
const buffer = await client.og({
  url: 'https://example.com',      // Auto-fetch OG metadata
  title: 'My Title',               // Override title
  description: 'Description',      // Override description
  siteName: 'Site Name',
  image: 'https://example.com/img.png',
  theme: 'light',                  // 'light' | 'dark'
  template: 'default',             // 'default' | 'article' | 'product'
});
```

#### `screenshotAsync(url, options?): Promise<{ id, status, pollUrl }>`

Queue a screenshot job (asynchronous).

```typescript
const job = await client.screenshotAsync('https://example.com', {
  format: 'png',
});

console.log(job.id);       // Job ID
console.log(job.pollUrl);  // URL to poll for status

// Poll for completion
const result = await client.pollJob(job.id);
if (result.status === 'completed') {
  console.log('Done!');
}
```

#### `pdfAsync(url, options?): Promise<{ id, status, pollUrl }>`

Queue a PDF job (asynchronous).

```typescript
const job = await client.pdfAsync('https://example.com');
const result = await client.pollJob(job.id);
```

#### `batchRender(items): Promise<BatchCreateResponse>`

Submit a batch of render jobs.

```typescript
const batch = await client.batchRender([
  { type: 'screenshot', url: 'https://example.com' },
  { type: 'pdf', url: 'https://example.org', options: { format: 'letter' } },
]);

console.log(batch.batchId);
console.log(batch.jobs);  // Array of { id, pollUrl }

// Poll batch status
const status = await client.pollBatch(batch.batchId);
console.log(status.completed, status.failed, status.total);
```

#### `pollJob(jobId): Promise<RenderJob>`

Get job status and metadata.

```typescript
const job = await client.pollJob('job-id');
console.log(job.status);      // 'pending' | 'processing' | 'completed' | 'failed'
console.log(job.durationMs);  // Render duration
console.log(job.error);       // Error message if failed
```

#### `pollBatch(batchId): Promise<BatchJob>`

Get batch status and all job statuses.

```typescript
const batch = await client.pollBatch('batch-id');
console.log(batch.status);
console.log(batch.jobs);  // Array of job statuses
```

#### `getUsage(): Promise<UsageStats>`

Get current API key usage statistics.

```typescript
const usage = await client.getUsage();
console.log(usage.usage.thisMonth);      // Renders this month
console.log(usage.usage.monthlyQuota);   // Monthly quota
console.log(usage.usage.remaining);      // Remaining renders
console.log(usage.rateLimit.requestsPerMinute);
```

#### `listWebhookDeliveries(options?): Promise<WebhookDeliveriesResponse>`

List webhook deliveries for the API key.

```typescript
const deliveries = await client.listWebhookDeliveries({
  page: 1,
  limit: 50,
});

deliveries.deliveries.forEach(d => {
  console.log(d.id, d.status, d.attempts);
});
```

#### `getWebhookDelivery(deliveryId): Promise<WebhookDelivery>`

Get a specific webhook delivery.

```typescript
const delivery = await client.getWebhookDelivery('delivery-id');
console.log(delivery.payload);
console.log(delivery.lastStatusCode);
```

## Error Handling

The SDK throws typed errors for easier handling:

```typescript
import {
  ScreenForgeError,
  RateLimitError,
  ValidationError,
  AuthenticationError,
  QuotaExceededError,
  JobNotFoundError,
} from '@screenforge/sdk';

try {
  await client.screenshot('https://example.com');
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter} seconds`);
  } else if (error instanceof ValidationError) {
    console.log('Invalid request:', error.details);
  } else if (error instanceof AuthenticationError) {
    console.log('Invalid API key');
  } else if (error instanceof QuotaExceededError) {
    console.log('Monthly quota exceeded');
  } else if (error instanceof ScreenForgeError) {
    console.log(`Error ${error.statusCode}: ${error.message}`);
  }
}
```

## Advanced Usage

### Custom Retry Logic

```typescript
const client = new ScreenForge({
  apiKey: 'your-api-key',
  maxRetries: 5,           // Retry up to 5 times
  retryDelay: 2000,        // Start with 2s delay (exponential backoff)
});
```

### Timeouts

```typescript
const client = new ScreenForge({
  apiKey: 'your-api-key',
  timeout: 60000,  // 60 second timeout
});
```

## TypeScript

Full TypeScript support with exported types:

```typescript
import type {
  ScreenshotOptions,
  PdfOptions,
  OgOptions,
  RenderJob,
  BatchJob,
  UsageStats,
} from '@screenforge/sdk';
```

## Requirements

- Node.js >= 18 (native fetch support)

## License

MIT
````

**Rationale**: Comprehensive docs with examples for every method, error handling patterns, TypeScript usage.

### 11. `sdk/js/.npmignore`
```
src/
tests/
tsconfig.json
tsup.config.ts
vitest.config.ts
*.test.ts
node_modules/
.git/
```

**Rationale**: Only ship built files to npm, exclude source and tests.

### 12. `sdk/js/vitest.config.ts`
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['tests/**', 'dist/**', '*.config.ts'],
    },
  },
});
```

## Test Suite

### `sdk/js/tests/client.test.ts`
**Test all client methods:**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ScreenForge } from '../src/client.js';
import {
  AuthenticationError,
  ValidationError,
  RateLimitError,
  QuotaExceededError,
} from '../src/errors.js';

describe('ScreenForge Client', () => {
  let client: ScreenForge;

  beforeAll(() => {
    client = new ScreenForge({
      apiKey: process.env.TEST_API_KEY || 'test-key',
      baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3100',
    });
  });

  describe('constructor', () => {
    it('should throw if apiKey is missing', () => {
      expect(() => new ScreenForge({ apiKey: '' })).toThrow('apiKey is required');
    });

    it('should use default baseUrl if not provided', () => {
      const c = new ScreenForge({ apiKey: 'key' });
      expect(c).toBeDefined();
    });
  });

  describe('screenshot', () => {
    it('should capture a screenshot', async () => {
      const buffer = await client.screenshot('https://example.com', {
        viewport: { width: 1920, height: 1080 },
        format: 'png',
      });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Verify PNG signature
      expect(buffer.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
    });

    it('should support JPEG format', async () => {
      const buffer = await client.screenshot('https://example.com', {
        format: 'jpeg',
        quality: 80,
      });

      expect(buffer).toBeInstanceOf(Buffer);
      // Verify JPEG signature
      expect(buffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    });

    it('should handle validation errors', async () => {
      await expect(
        client.screenshot('not-a-url')
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('pdf', () => {
    it('should generate a PDF', async () => {
      const buffer = await client.pdf('https://example.com', {
        format: 'a4',
      });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Verify PDF signature
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    });
  });

  describe('og', () => {
    it('should generate OG card from URL', async () => {
      const buffer = await client.og({
        url: 'https://example.com',
      });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should generate OG card from manual data', async () => {
      const buffer = await client.og({
        title: 'Test Title',
        description: 'Test Description',
        siteName: 'Test Site',
        theme: 'dark',
      });

      expect(buffer).toBeInstanceOf(Buffer);
    });
  });

  describe('async rendering', () => {
    it('should queue screenshot job', async () => {
      const job = await client.screenshotAsync('https://example.com');

      expect(job).toHaveProperty('id');
      expect(job).toHaveProperty('status');
      expect(job).toHaveProperty('pollUrl');
      expect(job.status).toBe('pending');
    });

    it('should poll job status', async () => {
      const job = await client.screenshotAsync('https://example.com');
      const result = await client.pollJob(job.id);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('status');
      expect(['pending', 'processing', 'completed', 'failed']).toContain(result.status);
    });
  });

  describe('batch rendering', () => {
    it('should submit batch request', async () => {
      const batch = await client.batchRender([
        { type: 'screenshot', url: 'https://example.com' },
        { type: 'pdf', url: 'https://example.org' },
      ]);

      expect(batch).toHaveProperty('batchId');
      expect(batch).toHaveProperty('jobs');
      expect(batch.jobs).toHaveLength(2);
    });

    it('should poll batch status', async () => {
      const batch = await client.batchRender([
        { type: 'screenshot', url: 'https://example.com' },
      ]);

      const status = await client.pollBatch(batch.batchId);
      expect(status).toHaveProperty('total');
      expect(status).toHaveProperty('completed');
      expect(status).toHaveProperty('failed');
    });
  });

  describe('usage', () => {
    it('should get usage stats', async () => {
      const usage = await client.getUsage();

      expect(usage).toHaveProperty('usage');
      expect(usage.usage).toHaveProperty('thisMonth');
      expect(usage.usage).toHaveProperty('monthlyQuota');
      expect(usage.usage).toHaveProperty('remaining');
    });
  });

  describe('webhooks', () => {
    it('should list webhook deliveries', async () => {
      const deliveries = await client.listWebhookDeliveries({ page: 1, limit: 10 });

      expect(deliveries).toHaveProperty('deliveries');
      expect(deliveries).toHaveProperty('pagination');
      expect(Array.isArray(deliveries.deliveries)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw AuthenticationError for invalid API key', async () => {
      const badClient = new ScreenForge({
        apiKey: 'invalid-key',
        baseUrl: client['baseUrl'],
      });

      await expect(
        badClient.screenshot('https://example.com')
      ).rejects.toThrow(AuthenticationError);
    });

    it('should include request ID in errors', async () => {
      try {
        await client.screenshot('not-a-url');
      } catch (error) {
        if (error instanceof ValidationError) {
          expect(error.requestId).toBeDefined();
        }
      }
    });
  });
});
```

### `sdk/js/tests/retry.test.ts`
**Test retry logic:**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { withRetry, calculateBackoff, isRetryable } from '../src/utils.js';

describe('Retry Logic', () => {
  describe('calculateBackoff', () => {
    it('should calculate exponential backoff', () => {
      expect(calculateBackoff(0, 1000)).toBe(1000);
      expect(calculateBackoff(1, 1000)).toBe(2000);
      expect(calculateBackoff(2, 1000)).toBe(4000);
      expect(calculateBackoff(3, 1000)).toBe(8000);
    });

    it('should cap at MAX_RETRY_DELAY', () => {
      expect(calculateBackoff(10, 1000)).toBe(10000); // capped
    });
  });

  describe('isRetryable', () => {
    it('should return true for retryable status codes', () => {
      expect(isRetryable(408)).toBe(true);
      expect(isRetryable(429)).toBe(true);
      expect(isRetryable(500)).toBe(true);
      expect(isRetryable(502)).toBe(true);
      expect(isRetryable(503)).toBe(true);
      expect(isRetryable(504)).toBe(true);
    });

    it('should return false for non-retryable status codes', () => {
      expect(isRetryable(400)).toBe(false);
      expect(isRetryable(401)).toBe(false);
      expect(isRetryable(404)).toBe(false);
    });
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetry(fn, { maxRetries: 2, retryDelay: 100 });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('temporary'))
        .mockResolvedValue('success');

      const isRetryableFn = () => true;
      const result = await withRetry(fn, { maxRetries: 2, retryDelay: 10 }, isRetryableFn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('permanent'));
      const isRetryableFn = () => false;

      await expect(
        withRetry(fn, { maxRetries: 2, retryDelay: 10 }, isRetryableFn)
      ).rejects.toThrow('permanent');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));
      const isRetryableFn = () => true;

      await expect(
        withRetry(fn, { maxRetries: 2, retryDelay: 10 }, isRetryableFn)
      ).rejects.toThrow('always fails');

      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });
});
```

### `sdk/js/tests/errors.test.ts`
**Test error classes:**

```typescript
import { describe, it, expect } from 'vitest';
import {
  ScreenForgeError,
  RateLimitError,
  ValidationError,
  AuthenticationError,
  QuotaExceededError,
  JobNotFoundError,
} from '../src/errors.js';

describe('Error Classes', () => {
  it('should create ScreenForgeError', () => {
    const error = new ScreenForgeError('Test error', {
      statusCode: 500,
      code: 'TEST_ERROR',
      details: { foo: 'bar' },
      requestId: 'req-123',
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ScreenForgeError);
    expect(error.message).toBe('Test error');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('TEST_ERROR');
    expect(error.details).toEqual({ foo: 'bar' });
    expect(error.requestId).toBe('req-123');
  });

  it('should create RateLimitError', () => {
    const error = new RateLimitError('Rate limited', 60, { requestId: 'req-123' });

    expect(error).toBeInstanceOf(ScreenForgeError);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.statusCode).toBe(429);
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.retryAfter).toBe(60);
  });

  it('should create ValidationError', () => {
    const error = new ValidationError('Invalid input', { field: 'url' }, 'req-123');

    expect(error).toBeInstanceOf(ScreenForgeError);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('should create AuthenticationError', () => {
    const error = new AuthenticationError('Invalid key', 'req-123');

    expect(error).toBeInstanceOf(ScreenForgeError);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error.statusCode).toBe(401);
  });

  it('should create QuotaExceededError', () => {
    const error = new QuotaExceededError('Quota exceeded', 'req-123');

    expect(error).toBeInstanceOf(ScreenForgeError);
    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error.statusCode).toBe(429);
  });

  it('should create JobNotFoundError', () => {
    const error = new JobNotFoundError('Job not found', 'req-123');

    expect(error).toBeInstanceOf(ScreenForgeError);
    expect(error).toBeInstanceOf(JobNotFoundError);
    expect(error.statusCode).toBe(404);
  });
});
```

## Implementation Approach

### Phase 1: Project Setup
1. Create `sdk/js/` directory structure
2. Initialize `package.json` with dependencies
3. Configure TypeScript (`tsconfig.json`)
4. Configure tsup for dual ESM/CJS builds
5. Add LICENSE (MIT) and .npmignore

### Phase 2: Core Implementation
1. Implement type definitions (`src/types.ts`)
2. Implement error classes (`src/errors.ts`)
3. Implement utility functions (`src/utils.ts`, `src/constants.ts`)
4. Implement main client (`src/client.ts`)
5. Create main export (`src/index.ts`)

### Phase 3: Testing
1. Set up Vitest configuration
2. Write unit tests for error classes
3. Write unit tests for retry logic
4. Write integration tests for client methods
5. Run tests against local ScreenForge instance

### Phase 4: Documentation
1. Write comprehensive README.md
2. Add JSDoc comments to all public methods
3. Add usage examples
4. Document error handling patterns

### Phase 5: Build & Validation
1. Run `npm run build` to verify dual output
2. Verify type declarations are generated
3. Test in both ESM and CJS projects
4. Validate package contents with `npm pack`

## Data Flow

### Synchronous Render (screenshot/pdf/og)
```
User Code
  → client.screenshot(url, options)
  → request<Response>('/v1/screenshot', { body })
  → fetch with timeout & retries
  → handleErrorResponse (if !ok)
  → response.arrayBuffer()
  → Buffer.from(arrayBuffer)
  → return Buffer to user
```

### Asynchronous Render
```
User Code
  → client.screenshotAsync(url, options)
  → request<AsyncRenderResponse>('/v1/screenshot?async=true', { body })
  → fetch with timeout & retries
  → return { id, status, pollUrl }
  → user calls client.pollJob(id)
  → request<RenderJob>('/v1/render/:id')
  → return job status
```

### Batch Render
```
User Code
  → client.batchRender([items])
  → request<BatchCreateResponse>('/v1/batch', { items })
  → fetch with timeout & retries
  → return { batchId, jobs[], pollUrl }
  → user calls client.pollBatch(batchId)
  → request<BatchJob>('/v1/batch/:id')
  → return batch status + all job statuses
```

### Error Handling Flow
```
fetch() → response.ok === false
  → response.json() to parse error
  → extract { error.code, error.message, error.request_id }
  → map code to typed error class:
      - RATE_LIMITED → RateLimitError
      - VALIDATION_ERROR → ValidationError
      - AUTH_REQUIRED → AuthenticationError
      - QUOTA_EXCEEDED → QuotaExceededError
      - JOB_NOT_FOUND → JobNotFoundError
      - default → ScreenForgeError
  → throw typed error
  → user catches with instanceof checks
```

### Retry Flow
```
withRetry(fn, config, isRetryableFn)
  → attempt = 0
  → try fn()
  → catch error
    → if !isRetryableFn(error) → throw
    → if attempt >= maxRetries → throw
    → calculate backoff delay (exponential)
    → sleep(delay)
    → attempt++
    → retry
```

## Edge Cases & Considerations

### 1. Request Timeouts
- Default 30s timeout via AbortController
- User-configurable via `timeout` option
- Timeout triggers retry if retries enabled
- Timeout error has 408 status code (retryable)

### 2. Binary Response Handling
- Screenshot/PDF/OG endpoints return binary data
- Use `response.arrayBuffer()` then `Buffer.from()`
- Other endpoints return JSON
- Detect based on endpoint path

### 3. Rate Limiting
- API returns `429` with `Retry-After` header
- SDK throws `RateLimitError` with `retryAfter` property
- Automatic retry with exponential backoff
- Users can catch and implement custom backoff

### 4. Quota Exceeded
- Different from rate limiting (monthly quota vs per-minute)
- Throws `QuotaExceededError` (429 but different code)
- NOT retried automatically (quota won't recover quickly)

### 5. Network Failures
- AbortError → ScreenForgeError with 408 (timeout)
- Other fetch errors → ScreenForgeError with generic message
- All network errors are retryable by default

### 6. Invalid JSON Responses
- If error response isn't JSON, fallback to `response.statusText`
- Prevents SDK from crashing on malformed responses

### 7. Node Version Compatibility
- Requires Node 18+ for native `fetch()`
- Buffer is Node.js global
- No polyfills needed for modern Node

### 8. TypeScript Strict Mode
- All types fully defined
- No `any` or `unknown` (except in JSON parsing)
- Discriminated unions for error types

### 9. Async Job Polling
- SDK provides `pollJob()` but doesn't auto-poll
- Users implement polling loops themselves
- Could add `waitForJob()` helper in future version

### 10. Webhook Delivery Pagination
- `listWebhookDeliveries()` supports `page` and `limit`
- Returns pagination metadata
- Users implement pagination loops

### 11. API Key Security
- SDK never logs or exposes API key
- Passed in `Authorization: Bearer` header
- Users responsible for secure storage (env vars, etc.)

### 12. Error Request IDs
- All API errors include `request_id`
- Captured in error objects for debugging
- Users can log for support tickets

## Success Criteria

1. **Build**: `npm run build` succeeds, generates ESM + CJS + .d.ts
2. **Tests**: All unit and integration tests pass
3. **Types**: TypeScript compilation with `--strict` succeeds
4. **Dual Output**: Package works in both ESM and CJS projects
5. **Zero Dependencies**: No runtime dependencies
6. **Documentation**: README covers all methods with examples
7. **Error Handling**: All API error codes mapped to typed errors
8. **Retry Logic**: Exponential backoff works correctly
9. **Binary Data**: Screenshots/PDFs return valid Buffer objects
10. **API Coverage**: All current API endpoints supported

## Future Enhancements (Out of Scope)

- Streaming responses for large files
- Automatic polling with callbacks (`waitForJob()`)
- Rate limit backoff with `Retry-After` header respect
- Response caching in SDK
- Request signing for webhook validation
- Browser/Deno support (requires fetch polyfill)
- CLI tool built on SDK

## Dependencies

**Runtime**: None (uses native Node 18+ fetch, Buffer)

**Dev Dependencies**:
- `tsup` — dual ESM/CJS bundler
- `typescript` — TypeScript compiler
- `vitest` — test runner
- `@types/node` — Node.js type definitions

## Notes

- SDK follows ScreenForge API conventions exactly
- Error codes match `src/security/errors.ts`
- Type schemas match `src/renderer/schemas.ts`
- All endpoints in `src/routes/*.ts` are covered
- Retry logic is conservative (max 2 retries by default)
- Users can disable retries by setting `maxRetries: 0`
- SDK is stateless (no connection pooling or caching)
- Each method is independent, no method dependencies
