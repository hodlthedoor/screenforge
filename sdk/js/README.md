# @screenforge/sdk

Official JavaScript/TypeScript SDK for ScreenForge.

## Installation

```bash
npm install @screenforge/sdk
```

## Quick Start

```ts
import { ScreenForge } from '@screenforge/sdk';

const client = new ScreenForge({
  apiKey: process.env.SCREENFORGE_API_KEY!,
  baseUrl: 'https://api.screenforge.dev',
});

const png = await client.screenshot('https://example.com', { fullPage: true });
```

## Client

```ts
const client = new ScreenForge({
  apiKey: 'sf_...',
  baseUrl: 'https://api.screenforge.dev', // optional, default: http://localhost:3100
  timeout: 30_000, // optional request timeout (ms)
  maxRetries: 2, // optional retry count
});
```

Retry behavior uses exponential backoff (`baseDelay * 2^attempt`) and retries transient failures (`429`, `500`, `502`, `503`, `504`) and network errors.

## Methods

### `screenshot(url, options?) => Promise<Buffer>`
Creates a screenshot (`image/png` or `image/jpeg`).

### `pdf(url, options?) => Promise<Buffer>`
Renders a webpage to PDF (`application/pdf`).

### `og(url, options?) => Promise<Buffer>`
Generates an OG image (`image/png`).

### `screenshotAsync(url, options?) => Promise<{ jobId, pollUrl }>`
Queues a screenshot job and returns polling info.

### `batchRender(items) => Promise<{ batchId, jobs }>`
Submits up to 50 batch items and returns batch/job polling references.

### `pollJob(jobId) => Promise<RenderJob>`
Gets async job status from `/v1/render/:id`.

### `pollBatch(batchId) => Promise<BatchJob>`
Gets batch status and per-job progress from `/v1/batch/:id`.

### `getUsage() => Promise<UsageStats>`
Returns API key usage and rate-limit stats.

### `listWebhookDeliveries(opts?) => Promise<WebhookDelivery[]>`
Lists webhook delivery attempts for the current API key.

## Errors

All SDK errors extend `ScreenForgeError`.

- `ValidationError` for `400`
- `AuthenticationError` for `401`/`403`
- `RateLimitError` for `429` (includes `retryAfter` when available)
- `ScreenForgeError` for other API/network/timeouts
- Error metadata from API envelopes is surfaced on errors: `code`, `requestId`, `details`, `retryAfter`

```ts
import { RateLimitError } from '@screenforge/sdk';

try {
  await client.getUsage();
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(err.retryAfter);
  }
}
```

## TypeScript Types

The package exports typed options and response models:

- `ScreenshotOptions`
- `PdfOptions`
- `OgOptions`
- `BatchItem`
- `RenderJob`
- `BatchJob`
- `UsageStats`
- `WebhookDelivery`
