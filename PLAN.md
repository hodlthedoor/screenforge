# Implementation Plan: Structured Logging and Error Handling Improvements

## Overview
Enhance ScreenForge with comprehensive structured JSON logging and consistent error handling. Build on existing Fastify/Pino setup, create typed child loggers for modules, add detailed request/render logging, ensure all error responses follow canonical format with request_id, and provide error documentation endpoint.

## Current State Analysis

### ✅ Already Implemented
- Fastify with Pino configured in `src/index.ts` (lines 40-50)
- `pino-pretty` for development mode
- `LOG_LEVEL` env var in config schema (default 'info')
- Request logging hook with method, url, status, duration_ms, api_key_prefix, request_id (lines 69-84)
- Render job completion logging in worker (lines 208-220)
- `src/logging/index.ts` with `registerLoggers()` and `getLogger()` for child loggers
- `src/security/errors.ts` with `ERROR_CODES`, `buildErrorResponse()`, `sendError()` functions
- Error responses include request_id via `buildErrorResponse()`
- `src/docs/error-codes.ts` with error documentation at GET /v1/errors
- Test files: `tests/unit/logging.test.ts` and `tests/unit/error-format.test.ts` already exist
- No console.log usage found in src/ (grep returned no results)

### ⚠️ Gaps to Address
1. **Route handlers using legacy `createError()`** - render.ts, batch.ts, async-render.ts, og.ts still use old format
2. **Error handler needs standardization** - index.ts error handler (lines 138-160) should use new format consistently
3. **Queue worker logging incomplete** - Worker error handler doesn't use structured logger
4. **Module loggers not used yet** - Child loggers exist but aren't utilized in renderer/cache/auth/billing modules
5. **Cache logging missing** - No structured logs for cache hits/misses, evictions
6. **Test coverage incomplete** - Existing tests are basic, need more comprehensive scenarios

## Files to Create/Modify

### 1. **src/security/errors.ts** (MODIFY)
**Changes:**
- Mark `createError()` as deprecated (add JSDoc comment)
- Keep for backward compatibility but encourage migration to `buildErrorResponse()`/`sendError()`
- No breaking changes

**Edge cases:**
- Legacy code may still use `createError()` - it must continue working
- Ensure all error codes have proper typing

### 2. **src/index.ts** (MODIFY)
**Changes:**
- Update error handler (lines 138-160) to use `buildErrorResponse()` consistently
- Ensure all error paths include request_id
- Add structured logging for server startup/shutdown events
- Log queue worker events with structured format

**Edge cases:**
- Fastify validation errors must preserve details field
- 404 errors for undefined routes must work correctly
- Uncaught exceptions should still be logged before crashing

### 3. **src/routes/render.ts** (MODIFY)
**Changes:**
- Replace all `createError()` calls with `sendError()`
- Add structured logging for cache hits/misses using render logger
- Log validation failures, SSRF blocks, rate limits with context

**Edge cases:**
- Async render path must maintain same response format
- Rate limit errors must include retryAfter field
- Cached responses must log with cache_hit:true

### 4. **src/routes/batch.ts** (MODIFY)
**Changes:**
- Replace all `createError()` calls with `sendError()`
- Add structured logging for batch creation, validation failures
- Log per-item validation errors with item index

**Edge cases:**
- Batch validation errors must include item index in details
- SSRF checks per item must log which item failed

### 5. **src/routes/async-render.ts** (MODIFY)
**Changes:**
- Replace `createError()` with `sendError()`
- Add structured logging for job lookups, file reads

**Edge cases:**
- Job not found must use consistent error format
- Accept header negotiation should be logged

### 6. **src/routes/og.ts** (MODIFY)
**Changes:**
- Replace `createError()` with `sendError()`
- Add structured logging for OG card generation, metadata fetching
- Log cache hits/misses for OG cards

**Edge cases:**
- URL fetch failures should be logged with error details
- Template selection should be logged

### 7. **src/renderer/screenshot.ts** (READ & MODIFY)
**Changes:**
- Add structured logging using `getLogger('renderer')`
- Log navigation start/complete, timeouts, errors
- Include url, viewport, format in logs

**Edge cases:**
- Timeout errors must be distinguishable from other errors
- Browser crashes should be logged with full context

### 8. **src/renderer/pdf.ts** (READ & MODIFY)
**Changes:**
- Add structured logging using `getLogger('renderer')`
- Log PDF generation start/complete, options used
- Include url, format, margins in logs

**Edge cases:**
- Template rendering errors should be logged
- Header/footer template issues should be captured

### 9. **src/cache/index.ts** (READ & MODIFY)
**Changes:**
- Add structured logging using `getLogger('cache')`
- Log cache operations: get, set, eviction, cleanup
- Include hash, hit/miss, size, ttl in logs

**Edge cases:**
- Eviction events should log reason (TTL vs manual)
- Redis connection errors must be logged

### 10. **src/auth/middleware.ts** (READ & MODIFY)
**Changes:**
- Add structured logging using `getLogger('auth')`
- Log auth failures, API key lookups, disabled keys
- Include api_key_prefix in logs (never full key)

**Edge cases:**
- Missing API key vs invalid API key should be distinguishable
- Disabled keys should log with reason

### 11. **src/auth/rate-limiter.ts** (READ & MODIFY)
**Changes:**
- Add structured logging using `getLogger('auth')`
- Log rate limit hits, window resets
- Include api_key_id, limit, remaining in logs

**Edge cases:**
- Quota exceeded vs rate limited should be separate logs
- Redis errors in rate limiter must be logged

### 12. **src/queue/render-queue.ts** (MODIFY)
**Changes:**
- Use app.log or create queue logger in worker
- Replace implicit logging with structured logs
- Log job enqueue, start, complete, fail with full context

**Edge cases:**
- Worker events must include jobId, apiKeyId, type, url
- Batch completion checks should be logged
- Webhook send attempts should be logged

### 13. **tests/unit/logging.test.ts** (MODIFY)
**Changes:**
- Add tests for renderer, cache, auth, billing module loggers
- Test structured log format (JSON fields, types)
- Test render job logging (queue worker events)
- Test cache hit/miss logging

**Test scenarios:**
- Child logger creation for all modules
- Request logging includes all required fields
- Render logging includes url, type, duration_ms, cache_hit, format
- Error logging includes request_id, error code

### 14. **tests/unit/error-format.test.ts** (MODIFY)
**Changes:**
- Test all route handlers for consistent error format
- Test request_id propagation in all error paths
- Test error details field is optional
- Test /v1/errors endpoint completeness

**Test scenarios:**
- Validation errors from all routes
- Auth errors (missing key, invalid key, disabled key)
- Rate limit and quota errors
- SSRF blocking errors
- Job/batch not found errors
- Internal server errors
- All errors include request_id matching x-request-id header

## Implementation Approach

### Phase 1: Error Format Standardization (Files 1-6)
1. Deprecate `createError()` in errors.ts with JSDoc
2. Update error handler in index.ts to use `buildErrorResponse()`
3. Migrate all route handlers (render, batch, async-render, og) to `sendError()`
4. Verify error format consistency across all endpoints

### Phase 2: Module Logger Integration (Files 7-12)
1. Add logging to renderer modules (screenshot.ts, pdf.ts)
2. Add logging to cache operations (index.ts)
3. Add logging to auth middleware and rate limiter
4. Update queue worker to use structured logging
5. Add logging to billing operations (if any direct calls exist)

### Phase 3: Enhanced Request Logging (File 1)
1. Ensure request logging hook captures all fields
2. Add error logging in error handler
3. Add startup/shutdown logging
4. Verify log format in development (pino-pretty) and production (JSON)

### Phase 4: Test Coverage (Files 13-14)
1. Update logging.test.ts with comprehensive module logger tests
2. Update error-format.test.ts with all error scenarios
3. Add integration tests for render job logging
4. Verify all tests pass with new logging/error format

## Edge Cases & Considerations

### Logging Edge Cases
1. **Log levels** - Respect LOG_LEVEL env var; don't log sensitive data at any level
2. **Performance** - Structured logging should not impact render performance; use async logging
3. **API keys** - Log only prefix (first 7 chars), never full key
4. **URLs** - Log full URL in render jobs but truncate if excessively long (>200 chars)
5. **Error stacks** - Include stack traces in error logs but not in error responses
6. **Request IDs** - Preserve custom x-request-id headers; generate if missing
7. **Queue workers** - Workers run in separate process; need access to logger (pass via app.log)
8. **Test mode** - Logger should be disabled in tests (already handled by NODE_ENV=test)

### Error Handling Edge Cases
1. **Fastify validation** - Preserve Zod validation details in error response
2. **404s** - Catch-all 404 for undefined routes must use NOT_FOUND code
3. **500s** - Unhandled exceptions should log stack but return generic INTERNAL_ERROR to client
4. **Rate limiting** - Must include Retry-After header and retryAfter in response body
5. **SSRF blocking** - Must clearly indicate which URL was blocked
6. **Batch errors** - Must indicate which item in batch failed (include index)
7. **Webhook failures** - Should be logged but not block render job completion
8. **Database errors** - Should be logged with query context but not expose SQL to client

### Backward Compatibility
1. **createError()** - Keep as deprecated but functional for existing code
2. **Legacy error format** - Some old clients may expect old format; migration should be gradual
3. **Webhook payloads** - Don't change webhook payload format (separate from API responses)
4. **Log format** - Ensure pino-pretty still works for development

### Security Considerations
1. **Never log** - Full API keys, passwords, tokens, secrets
2. **Sanitize logs** - Don't log user-provided HTML/scripts that could pollute logs
3. **Request ID** - Don't allow malicious request IDs to inject log data
4. **Error details** - Don't expose internal paths, database structure, or stack traces to clients

## Success Criteria
- [ ] All route handlers use `sendError()` consistently
- [ ] All errors include request_id matching x-request-id header
- [ ] All errors follow canonical format: `{error: {code, message, details?, request_id}}`
- [ ] GET /v1/errors returns complete error documentation
- [ ] Module loggers (renderer, queue, cache, auth, billing) used throughout
- [ ] Request logging includes method, url, status, duration_ms, api_key_prefix, request_id
- [ ] Render logging includes url, type, duration_ms, cache_hit, format
- [ ] No console.log usage in src/
- [ ] All tests pass (logging.test.ts, error-format.test.ts, existing tests)
- [ ] No breaking changes to API responses or webhook payloads
- [ ] LOG_LEVEL env var controls verbosity correctly

## Execution Notes
- **No breaking changes** - Existing API behavior must be preserved
- **Incremental migration** - Routes can be updated one at a time
- **Test-driven** - Update tests first, then implementation
- **Backward compatible** - Keep `createError()` functional
- **Performance** - Async logging must not block requests
