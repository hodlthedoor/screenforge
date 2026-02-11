# JavaScript SDK Implementation Plan — Summary

## Overview
Create `@screenforge/sdk` — a zero-dependency TypeScript-first npm package for the ScreenForge API.

## Key Features
- ✅ Full TypeScript support with strict types
- ✅ Dual ESM/CJS builds via tsup
- ✅ Zero runtime dependencies (uses native Node 18+ fetch)
- ✅ Automatic retry with exponential backoff
- ✅ Typed error classes for all API error codes
- ✅ Comprehensive test coverage with Vitest
- ✅ Clean API matching REST endpoints exactly

## Files to Create

### Configuration (4 files)
1. `sdk/js/package.json` — Package manifest, scripts, metadata
2. `sdk/js/tsconfig.json` — TypeScript strict mode config
3. `sdk/js/tsup.config.ts` — Dual ESM/CJS build config
4. `sdk/js/.npmignore` — Exclude source from npm package

### Source Code (6 files)
1. `sdk/js/src/types.ts` — TypeScript interfaces for all API types
2. `sdk/js/src/errors.ts` — Custom error classes (RateLimitError, ValidationError, etc.)
3. `sdk/js/src/constants.ts` — Default values (timeouts, retry config)
4. `sdk/js/src/utils.ts` — Retry logic with exponential backoff
5. `sdk/js/src/client.ts` — Main ScreenForge client class
6. `sdk/js/src/index.ts` — Package exports

### Tests (4 files)
1. `sdk/js/tests/client.test.ts` — Client method tests
2. `sdk/js/tests/retry.test.ts` — Retry logic tests
3. `sdk/js/tests/errors.test.ts` — Error class tests
4. `sdk/js/tests/types.test.ts` — Type validation tests

### Documentation (2 files)
1. `sdk/js/README.md` — Installation, usage examples, API reference
2. `sdk/js/LICENSE` — MIT license

## Client API Surface

```typescript
const client = new ScreenForge({
  apiKey: string,
  baseUrl?: string,
  timeout?: number,
  maxRetries?: number,
  retryDelay?: number,
});

// Synchronous rendering (returns Buffer)
await client.screenshot(url, options?) → Buffer
await client.pdf(url, options?) → Buffer
await client.og(options) → Buffer

// Asynchronous rendering (returns job ID)
await client.screenshotAsync(url, options?) → { id, status, pollUrl }
await client.pdfAsync(url, options?) → { id, status, pollUrl }

// Batch rendering
await client.batchRender(items[]) → { batchId, jobs[], pollUrl }

// Job polling
await client.pollJob(jobId) → RenderJob
await client.pollBatch(batchId) → BatchJob

// Usage stats
await client.getUsage() → UsageStats

// Webhooks
await client.listWebhookDeliveries(opts?) → WebhookDeliveriesResponse
await client.getWebhookDelivery(id) → WebhookDelivery
```

## Error Classes

```typescript
ScreenForgeError        // Base class
  ├─ RateLimitError     // 429 RATE_LIMITED (has retryAfter)
  ├─ ValidationError    // 400 VALIDATION_ERROR
  ├─ AuthenticationError // 401 AUTH_REQUIRED/INVALID_API_KEY
  ├─ QuotaExceededError // 429 QUOTA_EXCEEDED
  └─ JobNotFoundError   // 404 JOB_NOT_FOUND/BATCH_NOT_FOUND
```

## Implementation Phases

### Phase 1: Setup (15 min)
- Create directory structure
- Write `package.json`, `tsconfig.json`, `tsup.config.ts`
- Add LICENSE and .npmignore

### Phase 2: Core (45 min)
- Implement types.ts (all interfaces)
- Implement errors.ts (error classes)
- Implement utils.ts (retry logic)
- Implement client.ts (main class with all methods)
- Implement index.ts (exports)

### Phase 3: Tests (30 min)
- Write error class tests
- Write retry logic tests
- Write client integration tests
- Configure Vitest

### Phase 4: Docs (20 min)
- Write comprehensive README
- Add JSDoc comments
- Document all methods and error handling

### Phase 5: Build (10 min)
- Run `npm run build` and verify outputs
- Test dual ESM/CJS compatibility
- Validate package with `npm pack`

**Total Estimated Time**: ~2 hours

## Technical Decisions

### Native Fetch (Node 18+)
- ✅ Zero dependencies
- ✅ Built-in AbortController for timeouts
- ✅ Standard Web API
- ❌ Requires Node 18+ (acceptable for 2026)

### Dual ESM/CJS via tsup
- ✅ Maximum compatibility
- ✅ Automatic, no manual config
- ✅ Generates type declarations
- ✅ Tree-shakeable ESM

### Retry Strategy
- Default: 2 retries with exponential backoff (1s → 2s → 4s)
- Retryable status codes: 408, 429, 500, 502, 503, 504
- User-configurable: `maxRetries`, `retryDelay`
- Capped at 10s max delay

### Buffer for Binary Data
- Screenshots/PDFs return Node.js Buffer
- Alternative: ArrayBuffer (not Node-idiomatic)
- Users can convert to File, Blob, etc. as needed

## Edge Cases Handled

1. **Request Timeouts** — AbortController with configurable timeout
2. **Binary vs JSON** — Detects endpoint type, returns Buffer or JSON
3. **Rate Limiting** — RateLimitError with `retryAfter` property
4. **Network Failures** — Wrapped in ScreenForgeError, retryable
5. **Malformed Responses** — Graceful fallback to statusText
6. **Error Request IDs** — Captured in all errors for debugging

## Data Flow Example

```
User: client.screenshot('https://example.com')
  ↓
Client: POST /v1/screenshot with auth header
  ↓
Retry wrapper: catch errors, exponential backoff
  ↓
Response handler: check ok, parse error if needed
  ↓
Binary handler: arrayBuffer() → Buffer
  ↓
Return: Buffer with PNG data
```

## Dependencies

**Runtime**: None
**Dev**:
- tsup ^8.0.0 (bundler)
- typescript ^5.9.0 (compiler)
- vitest ^4.0.0 (testing)
- @types/node ^22.0.0 (Node types)

## Success Metrics

- [ ] `npm run build` produces dist/index.js (ESM), dist/index.cjs (CJS), dist/index.d.ts
- [ ] All tests pass with 100% coverage of core logic
- [ ] TypeScript compiles with --strict --noEmit
- [ ] Package works in both ESM and CJS projects
- [ ] README documents all methods with examples
- [ ] Error handling covers all API error codes
- [ ] Retry logic verified with unit tests

## Next Steps After Implementation

1. **Publish to npm** — `npm publish --access public`
2. **CI/CD** — Add GitHub Actions for tests + publish
3. **Version updates** — Semantic versioning for API changes
4. **Changelog** — Document breaking changes
5. **Examples repo** — Show real-world usage patterns

## Out of Scope (Future)

- Streaming responses
- Automatic job polling (`waitForJob()`)
- Response caching
- Webhook signature validation
- Browser/Deno support
- CLI wrapper
