# @screenforge/sdk

Official JavaScript/TypeScript SDK for the ScreenForge screenshot, PDF, and OG image API.

## Installation

```bash
npm install @screenforge/sdk
```

## Quick Start

```ts
import { ScreenForge } from '@screenforge/sdk';
import { writeFileSync } from 'fs';

const client = new ScreenForge({
  apiKey: process.env.SCREENFORGE_API_KEY!,
  baseUrl: 'https://api.screenforge.dev',
});

// Take a screenshot and save it
const png = await client.screenshot('https://example.com', { fullPage: true });
writeFileSync('example.png', png);

// Generate a PDF
const pdf = await client.pdf('https://example.com');
writeFileSync('example.pdf', pdf);
```

## Client Configuration

```ts
const client = new ScreenForge({
  // Required — your ScreenForge API key
  apiKey: 'sf_...',

  // API base URL (default: 'http://localhost:3100')
  baseUrl: 'https://api.screenforge.dev',

  // Request timeout in milliseconds (default: 30000)
  timeout: 30_000,

  // Number of retries on transient failures (default: 2)
  maxRetries: 2,

  // Base delay for exponential backoff in ms (default: 200)
  // Actual delay: retryBaseDelayMs * 2^attempt
  retryBaseDelayMs: 200,
});
```

Retries use exponential backoff and apply to transient HTTP failures (`429`, `500`, `502`, `503`, `504`), timeouts, and network errors. When a `Retry-After` header is present, the SDK respects it.

## Methods

### `screenshot(url, options?)` — `Promise<Buffer>`

Captures a screenshot of a webpage. Returns raw image bytes as a `Buffer`.

```ts
// Basic screenshot
const png = await client.screenshot('https://example.com');

// Full-page screenshot as JPEG with custom viewport
const jpeg = await client.screenshot('https://example.com', {
  fullPage: true,
  format: 'jpeg',
  quality: 80,
  viewport: { width: 1440, height: 900 },
});

// Screenshot a specific element with dark mode
const element = await client.screenshot('https://example.com', {
  selector: '#hero-section',
  darkMode: true,
  deviceScaleFactor: 2,
});

// Wait for a CSS selector before capturing
const delayed = await client.screenshot('https://example.com', {
  waitFor: '.content-loaded',
});

// Pre-capture actions: click, scroll, type before taking the screenshot
const interactive = await client.screenshot('https://example.com', {
  actions: [
    { type: 'click', selector: '#accept-cookies' },
    { type: 'scroll', y: 500 },
    { type: 'type', selector: '#search', value: 'hello' },
  ],
});

// Hide, remove, or blur elements before capture
const cleaned = await client.screenshot('https://example.com', {
  hide_selectors: ['.ad-banner', '.cookie-popup'],
  remove_selectors: ['.tracking-pixel'],
  blur_selectors: ['.email-address', '.phone-number'],
  blur_radius: 15,
  block_ads: true,
});

// Content validation — fail if page contains/misses specific content
const validated = await client.screenshot('https://example.com', {
  fail_if_contains: 'Error 404',
  fail_if_missing: '.main-content',
});

// Render from raw HTML instead of a URL
const html = await client.screenshot({
  html: '<h1>Hello World</h1>',
  viewport: { width: 800, height: 600 },
});
```

**Options (`ScreenshotOptions`):**

| Option | Type | Description |
|--------|------|-------------|
| `url` | `string` | URL to capture |
| `html` | `string` | Raw HTML to render (alternative to URL) |
| `viewport` | `{ width, height }` | Browser viewport dimensions |
| `format` | `'png' \| 'jpeg' \| 'webp'` | Image format |
| `quality` | `number` | JPEG/WebP quality (1-100) |
| `fullPage` | `boolean` | Capture full scrollable page |
| `selector` | `string` | CSS selector to capture a specific element |
| `waitFor` | `string` | CSS selector to wait for before capture |
| `darkMode` | `boolean` | Enable dark mode emulation |
| `deviceScaleFactor` | `number` | Device pixel ratio (e.g. 2 for retina) |
| `callback_url` | `string` | Webhook URL for async notifications |
| `actions` | `Action[]` | Pre-capture interactions (click, scroll, type, hover, wait) |
| `hide_selectors` | `string[]` | CSS selectors to hide (visibility: hidden) |
| `remove_selectors` | `string[]` | CSS selectors to remove from DOM |
| `blur_selectors` | `string[]` | CSS selectors to blur |
| `blur_radius` | `number` | Blur radius in pixels (1-50, default: 10) |
| `fail_if_contains` | `string` | Fail if page contains this text |
| `fail_if_missing` | `string` | Fail if page is missing this text |
| `block_ads` | `boolean` | Block ads and trackers |

---

### `pdf(url, options?)` — `Promise<Buffer>`

Renders a webpage to PDF. Returns raw PDF bytes as a `Buffer`.

```ts
// Basic PDF
const pdf = await client.pdf('https://example.com');

// A4 landscape with custom margins
const report = await client.pdf('https://example.com/report', {
  format: 'a4',
  landscape: true,
  margins: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
  printBackground: true,
});

// Letter format with header/footer templates and scaling
const invoice = await client.pdf('https://example.com/invoice', {
  format: 'letter',
  headerTemplate: '<div style="font-size:10px; text-align:center;">Invoice</div>',
  footerTemplate: '<div style="font-size:10px; text-align:center;"><span class="pageNumber"></span></div>',
  scale: 0.9,
});

// Render PDF from raw HTML
const htmlPdf = await client.pdf({
  html: '<h1>Contract</h1><p>Terms and conditions...</p>',
  format: 'legal',
});
```

**Options (`PdfOptions`):**

| Option | Type | Description |
|--------|------|-------------|
| `url` | `string` | URL to render |
| `html` | `string` | Raw HTML to render (alternative to URL) |
| `format` | `'a4' \| 'letter' \| 'legal'` | Paper format |
| `landscape` | `boolean` | Landscape orientation |
| `margins` | `{ top?, right?, bottom?, left? }` | Page margins (CSS units) |
| `printBackground` | `boolean` | Include background colors/images |
| `headerTemplate` | `string` | HTML template for page header |
| `footerTemplate` | `string` | HTML template for page footer |
| `scale` | `number` | Page scale factor (0.1-2.0) |
| `callback_url` | `string` | Webhook URL for async notifications |
| `actions` | `Action[]` | Pre-capture interactions (click, scroll, type, hover, wait) |
| `hide_selectors` | `string[]` | CSS selectors to hide (visibility: hidden) |
| `remove_selectors` | `string[]` | CSS selectors to remove from DOM |
| `blur_selectors` | `string[]` | CSS selectors to blur |
| `blur_radius` | `number` | Blur radius in pixels (1-50, default: 10) |
| `fail_if_contains` | `string` | Fail if page contains this text |
| `fail_if_missing` | `string` | Fail if page is missing this text |
| `block_ads` | `boolean` | Block ads and trackers |

---

### `og(url, options?)` — `Promise<Buffer>`

Generates an Open Graph image. Returns a PNG `Buffer`.

```ts
// Basic OG image from a URL
const og = await client.og('https://example.com');

// Customized OG card with title, description, and theme
const card = await client.og('https://example.com/blog/my-post', {
  title: 'How to Build a Screenshot API',
  description: 'A step-by-step guide to building your own screenshot service.',
  siteName: 'ScreenForge Blog',
  theme: 'dark',
  template: 'article',
});

// Product template with image
const product = await client.og('https://example.com/product/123', {
  title: 'Premium Widget',
  description: 'The best widget money can buy.',
  image: 'https://example.com/widget.png',
  template: 'product',
  theme: 'light',
});
```

**Options (`OgOptions`):**

| Option | Type | Description |
|--------|------|-------------|
| `title` | `string` | Card title |
| `description` | `string` | Card description |
| `siteName` | `string` | Site name shown on the card |
| `image` | `string` | URL of an image to include |
| `theme` | `'light' \| 'dark'` | Color theme |
| `template` | `'default' \| 'article' \| 'product'` | Card layout template |

---

### `screenshotAsync(url, options?)` — `Promise<AsyncRenderResponse>`

Queues a screenshot job for asynchronous processing. Returns a `jobId` and `pollUrl` to check status.

```ts
// Queue an async screenshot
const { jobId, pollUrl } = await client.screenshotAsync('https://example.com', {
  fullPage: true,
  format: 'png',
  viewport: { width: 1920, height: 1080 },
});

console.log(`Job queued: ${jobId}`);
console.log(`Poll at: ${pollUrl}`);

// Poll until complete (see pollJob below)
let job = await client.pollJob(jobId);
while (job.status === 'pending' || job.status === 'processing') {
  await new Promise((r) => setTimeout(r, 2000));
  job = await client.pollJob(jobId);
}

if (job.status === 'completed') {
  console.log(`Done in ${job.durationMs}ms — content type: ${job.contentType}`);
} else {
  console.error(`Failed: ${job.error}`);
}
```

Accepts the same options as `screenshot()`. Also available: `pdfAsync(url, options?)` for async PDF rendering.

---

### `batchRender(items)` — `Promise<BatchRenderResponse>`

Submits up to 50 render jobs in a single request. Each item can be a screenshot or PDF.

```ts
const batch = await client.batchRender([
  { type: 'screenshot', url: 'https://example.com', options: { fullPage: true } },
  { type: 'pdf', url: 'https://example.com/report', options: { format: 'a4' } },
  { type: 'screenshot', url: 'https://example.com/pricing' },
  { type: 'screenshot', html: '<h1>Hello</h1>' },
  {
    type: 'pdf',
    url: 'https://example.com/invoice',
    callbackUrl: 'https://myapp.com/webhooks/render',
  },
]);

console.log(`Batch ID: ${batch.batchId}`);
console.log(`Jobs submitted: ${batch.jobs.length}`);
batch.jobs.forEach((job) => {
  console.log(`  Job ${job.jobId} — poll at ${job.pollUrl}`);
});

// Poll the batch until all jobs complete
let status = await client.pollBatch(batch.batchId);
while (status.status !== 'completed' && status.status !== 'failed') {
  console.log(`Progress: ${status.completed}/${status.total} done, ${status.failed} failed`);
  await new Promise((r) => setTimeout(r, 3000));
  status = await client.pollBatch(batch.batchId);
}

console.log(`Batch finished: ${status.completed} completed, ${status.failed} failed`);
```

**`BatchItem` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'screenshot' \| 'pdf'` | Render type |
| `url` | `string` | URL to render |
| `html` | `string` | Raw HTML to render (alternative to URL) |
| `options` | `Record<string, unknown>` | Type-specific options |
| `callbackUrl` | `string` | Webhook URL for this job |

---

### `pollJob(jobId)` — `Promise<RenderJob>`

Checks the status of an async render job.

```ts
const job = await client.pollJob('job_abc123');

console.log(`Status: ${job.status}`);       // 'pending' | 'processing' | 'completed' | 'failed'
console.log(`Type: ${job.type}`);            // 'screenshot' | 'pdf' | 'og'
console.log(`Created: ${job.createdAt}`);
console.log(`Duration: ${job.durationMs}ms`);

if (job.status === 'failed') {
  console.error(`Error: ${job.error}`);
}
```

**Polling loop pattern:**

```ts
async function waitForJob(client: ScreenForge, jobId: string, intervalMs = 2000): Promise<RenderJob> {
  let job = await client.pollJob(jobId);
  while (job.status === 'pending' || job.status === 'processing') {
    await new Promise((r) => setTimeout(r, intervalMs));
    job = await client.pollJob(jobId);
  }
  return job;
}
```

---

### `pollBatch(batchId)` — `Promise<BatchJob>`

Checks the status of a batch render, including per-job progress.

```ts
const batch = await client.pollBatch('batch_xyz789');

console.log(`Batch status: ${batch.status}`);
console.log(`Total: ${batch.total}`);
console.log(`Completed: ${batch.completed}`);
console.log(`Failed: ${batch.failed}`);

// Inspect individual jobs
for (const job of batch.jobs) {
  console.log(`  ${job.id} [${job.type}] — ${job.status}`);
  if (job.error) {
    console.log(`    Error: ${job.error}`);
  }
}
```

**Polling loop pattern:**

```ts
async function waitForBatch(client: ScreenForge, batchId: string, intervalMs = 3000): Promise<BatchJob> {
  let batch = await client.pollBatch(batchId);
  while (batch.status === 'pending' || batch.status === 'processing') {
    console.log(`Progress: ${batch.completed}/${batch.total}`);
    await new Promise((r) => setTimeout(r, intervalMs));
    batch = await client.pollBatch(batchId);
  }
  return batch;
}
```

---

### `getUsage()` — `Promise<UsageStats>`

Returns current usage statistics and rate limit info for your API key.

```ts
const usage = await client.getUsage();

console.log(`Tier: ${usage.tier}`);
console.log(`Today: ${usage.usage.today} renders`);
console.log(`This month: ${usage.usage.thisMonth} / ${usage.usage.monthlyQuota}`);
console.log(`Remaining: ${usage.usage.remaining}`);
console.log(`Rate limit: ${usage.rateLimit.requestsPerMinute} req/min`);
```

**Response shape (`UsageStats`):**

```ts
{
  apiKeyId: string;
  tier: string;           // 'free' | 'starter' | 'pro' | 'business'
  usage: {
    today: number;        // renders used today
    thisMonth: number;    // renders used this month
    monthlyQuota: number; // monthly limit for your tier
    remaining: number;    // renders remaining this month
  };
  rateLimit: {
    requestsPerMinute: number;
  };
}
```

---

### `extract(options)` — `Promise<ExtractResult>`

Extract structured data from a webpage using LLM-powered vision analysis.

```ts
// Extract from a URL
const result = await client.extract({
  url: 'https://example.com/product',
  prompt: 'Extract the product title, price, and description',
  schema: {
    title: 'string',
    price: 'number',
    description: 'string'
  },
  model: 'sonnet', // or 'haiku'
});

console.log(result.data); // { title: "...", price: 99.99, description: "..." }
console.log(`Model: ${result.modelUsed}, Tokens: ${result.tokensUsed}`);

// Extract from an existing render job
const extracted = await client.extract({
  job_id: 'job_abc123',
  prompt: 'Extract all product names from the page',
  model: 'haiku',
});
```

**Options (`ExtractOptions`):**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `prompt` | `string` | ✅ | Extraction prompt for the LLM |
| `url` | `string` | One of `url` or `job_id` | URL to capture and extract from |
| `job_id` | `string` | One of `url` or `job_id` | Use screenshot from existing render job |
| `schema` | `object` | ❌ | JSON schema for structured extraction |
| `model` | `'sonnet' \| 'haiku'` | ❌ | LLM model (default: `'sonnet'`) |
| `screenshot_options` | `ExtractScreenshotOptions` | ❌ | Screenshot capture settings |

**`ExtractScreenshotOptions`:**

| Option | Type | Description |
|--------|------|-------------|
| `viewport_width` | `number` | Viewport width (1-7680) |
| `viewport_height` | `number` | Viewport height (1-4320) |
| `format` | `'png' \| 'jpeg' \| 'webp'` | Image format |
| `full_page` | `boolean` | Capture full page scroll |
| `delay_ms` | `number` | Wait before capture (0-30000ms) |

**Response shape (`ExtractResult`):**

```ts
{
  extractionId: string;       // Unique extraction job ID
  data: unknown;              // Extracted data (matches schema if provided)
  modelUsed: string;          // LLM model used (e.g., "claude-sonnet-4.5")
  tokensUsed: number;         // Tokens consumed
  screenshotPath?: string;    // Screenshot storage path (if new capture)
  durationMs: number;         // Processing time in milliseconds
}
```

---

### `accessibility(url, options?)` — `Promise<AccessibilityReport>`

Run a comprehensive WCAG accessibility audit on a webpage using axe-core.

```ts
const report = await client.accessibility('https://example.com', {
  standard: 'WCAG2AA',
  include_screenshot: true,
});

console.log(`Audit ID: ${report.auditId}`);
console.log(`Violations: ${report.violationsCount}`);
console.log(`Passes: ${report.passesCount}`);

for (const violation of report.violations) {
  console.log(`\n${violation.id} (${violation.impact})`);
  console.log(`  ${violation.description}`);
  console.log(`  Help: ${violation.helpUrl}`);

  for (const node of violation.nodes) {
    console.log(`  - Target: ${node.target.join(', ')}`);
    console.log(`    HTML: ${node.html}`);
  }
}

if (report.screenshotPath) {
  console.log(`Screenshot: ${report.screenshotPath}`);
  console.log(`Annotated: ${report.annotatedScreenshotPath}`);
}
```

**Options (`AccessibilityOptions`):**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `url` | `string` | ✅ | URL to audit |
| `standard` | `'WCAG2A' \| 'WCAG2AA' \| 'WCAG2AAA'` | ❌ | Conformance level (default: `'WCAG2AA'`) |
| `screenshot_options` | `AccessibilityScreenshotOptions` | ❌ | Screenshot capture settings |
| `include_screenshot` | `boolean` | ❌ | Include clean and annotated screenshots (default: `false`) |

**`AccessibilityScreenshotOptions`:**

| Option | Type | Description |
|--------|------|-------------|
| `viewport_width` | `number` | Viewport width (1-7680) |
| `viewport_height` | `number` | Viewport height (1-4320) |
| `delay_ms` | `number` | Wait before audit (0-30000ms) |

**Response shape (`AccessibilityReport`):**

```ts
{
  auditId: string;                        // Unique audit job ID
  url: string;                            // Audited URL
  standard: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
  violations: AccessibilityViolation[];   // Array of violations
  passesCount: number;                    // Number of passed checks
  violationsCount: number;                // Number of violations
  incompleteCount: number;                // Number of incomplete checks
  screenshotPath?: string;                // Clean screenshot path
  annotatedScreenshotPath?: string;       // Screenshot with violations highlighted
  durationMs: number;                     // Processing time in milliseconds
  timestamp: string;                      // ISO 8601 timestamp
}
```

**`AccessibilityViolation`:**

```ts
{
  id: string;              // Rule ID (e.g., "color-contrast")
  impact: string;          // "critical" | "serious" | "moderate" | "minor"
  description: string;     // Human-readable description
  helpUrl: string;         // Documentation URL
  nodes: Array<{
    html: string;          // Element HTML
    target: string[];      // CSS selectors
    failureSummary?: string; // What failed and how to fix
  }>;
}
```

---

### `listWebhookDeliveries(opts?)` — `Promise<WebhookDelivery[]>`

Lists webhook delivery attempts for your API key, with pagination.

```ts
// Get the first page of deliveries
const deliveries = await client.listWebhookDeliveries();

for (const d of deliveries) {
  console.log(`${d.id} — job ${d.jobId} — ${d.status}`);
  console.log(`  URL: ${d.url}`);
  console.log(`  Attempts: ${d.attempts}`);
  console.log(`  Status code: ${d.lastStatusCode}`);
  if (d.lastError) {
    console.log(`  Error: ${d.lastError}`);
  }
}

// Paginate through results
const page2 = await client.listWebhookDeliveries({ page: 2, limit: 25 });
```

**Options (`ListWebhookDeliveriesOptions`):**

| Option | Type | Description |
|--------|------|-------------|
| `page` | `number` | Page number (1-based) |
| `limit` | `number` | Results per page |

**Response shape (`WebhookDelivery`):**

```ts
{
  id: string;
  jobId: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}
```

## Error Handling

All SDK errors extend `ScreenForgeError`. The SDK provides specialized error classes for common failure modes:

| Error Class | HTTP Status | When |
|-------------|-------------|------|
| `ValidationError` | 400 | Invalid request parameters |
| `AuthenticationError` | 401, 403 | Missing or invalid API key |
| `RateLimitError` | 429 | Rate limit exceeded |
| `ScreenForgeError` | Other | Server errors, timeouts, network failures |

Every error includes optional metadata extracted from the API response:

```ts
import {
  ScreenForge,
  ScreenForgeError,
  RateLimitError,
  ValidationError,
  AuthenticationError,
} from '@screenforge/sdk';

try {
  const png = await client.screenshot('https://example.com');
} catch (err) {
  if (err instanceof RateLimitError) {
    // Back off and retry after the suggested delay
    console.log(`Rate limited. Retry after ${err.retryAfter} seconds`);
    await new Promise((r) => setTimeout(r, (err.retryAfter ?? 10) * 1000));
  }

  if (err instanceof ValidationError) {
    // Fix the request parameters
    console.error(`Bad request: ${err.message}`);
    console.error(`Details:`, err.details);
  }

  if (err instanceof AuthenticationError) {
    // Check your API key
    console.error(`Auth failed: ${err.message}`);
  }

  if (err instanceof ScreenForgeError) {
    // Catch-all for any ScreenForge error
    console.error(`Error: ${err.message}`);
    console.error(`Status: ${err.status}`);
    console.error(`Code: ${err.code}`);
    console.error(`Request ID: ${err.requestId}`);
  }
}
```

**Timeout and network errors:**

```ts
try {
  const png = await client.screenshot('https://slow-site.com');
} catch (err) {
  if (err instanceof ScreenForgeError && err.code === 'TIMEOUT') {
    console.error(`Request timed out after ${client.timeout}ms`);
  }
  if (err instanceof ScreenForgeError && err.code === 'NETWORK_ERROR') {
    console.error('Network error — is the API reachable?');
  }
}
```

## TypeScript Types

All types are exported from the package entry point:

```ts
import type {
  Action,
  ScreenshotOptions,
  PdfOptions,
  OgOptions,
  BatchItem,
  RenderJob,
  BatchJob,
  UsageStats,
  WebhookDelivery,
  ListWebhookDeliveriesOptions,
  AsyncRenderResponse,
  BatchRenderResponse,
  ExtractOptions,
  ExtractResult,
  ExtractScreenshotOptions,
  AccessibilityOptions,
  AccessibilityReport,
  AccessibilityScreenshotOptions,
  AccessibilityViolation,
  AccessibilityViolationNode,
} from '@screenforge/sdk';
```

| Type | Description |
|------|-------------|
| `Action` | Pre-capture interaction (click, scroll, type, hover, wait) |
| `ScreenshotOptions` | Options for `screenshot()` and `screenshotAsync()` |
| `PdfOptions` | Options for `pdf()` and `pdfAsync()` |
| `OgOptions` | Options for `og()` — title, theme, template |
| `BatchItem` | A single item in a batch render request |
| `RenderJob` | Status of an async render job |
| `BatchJob` | Status of a batch, including per-job items |
| `UsageStats` | API key usage and rate limit info |
| `WebhookDelivery` | A webhook delivery attempt record |
| `ListWebhookDeliveriesOptions` | Pagination options for `listWebhookDeliveries()` |
| `AsyncRenderResponse` | Return type of `screenshotAsync()` and `pdfAsync()` |
| `BatchRenderResponse` | Return type of `batchRender()` |
| `ExtractOptions` | Options for `extract()` — CSS selectors, metadata, and screenshot |
| `ExtractResult` | Return type of `extract()` — extracted text, metadata, links |
| `ExtractScreenshotOptions` | Screenshot options specific to `extract()` |
| `AccessibilityOptions` | Options for `accessibility()` — standard, screenshot |
| `AccessibilityReport` | Return type of `accessibility()` — violations, score, passes |
| `AccessibilityScreenshotOptions` | Screenshot options specific to `accessibility()` |
| `AccessibilityViolation` | A single accessibility violation with impact and nodes |
| `AccessibilityViolationNode` | A DOM node affected by an accessibility violation |
