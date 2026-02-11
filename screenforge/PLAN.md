# Implementation Plan: Structured Logging and Error Handling Improvements

## Overview
Enhance ScreenForge with comprehensive structured JSON logging and consistent error response formatting. Build on existing pino configuration, extend module-based child loggers, and ensure all error responses follow a canonical format with request tracking.

## Current State Analysis

### Already Implemented ✅
- **Pino logger** configured in `src/index.ts` with `pino-pretty` for development
- **LOG_LEVEL** env var in config schema (lines 11)
- **Request logging hook** (lines 69-84) — logs method, url, status, duration_ms, api_key_prefix, request_id
- **Request ID tracking** via `src/security/request-id.ts` — generates/propagates request IDs
- **Child logger infrastructure** in `src/logging/index.ts` — `getLogger()` creates module-bound loggers
- **Render job logging** in queue worker (lines 208-230) — logs completed/failed jobs with url, type, duration_ms, format, job_id
- **Error code infrastructure** in `src/security/errors.ts`:
  - `ERROR_CODES` constant with status codes
  - `buildErrorResponse()` creates `{ error: { code, message, details?, request_id } }`
  - `sendError()` helper
  - Legacy `createError()` (backwards compat)
- **Error documentation endpoint** at `GET /v1/errors` (`src/docs/error-codes.ts`)
- **Tests exist** for logging and error format (though incomplete)

### Issues to Fix ❌
1. **Inconsistent error responses** — routes use legacy `createError()` which returns `{ error: string, code, statusCode, ...extra }` instead of canonical `{ error: { code, message, details?, request_id } }`
2. **Missing request_id in errors** — request ID exists in headers but not consistently in error response bodies
3. **No render logging in sync routes** — `/v1/screenshot` and `/v1/pdf` don't log renders (only async queue does)
4. **Cache hit logging missing** — cache hits should be logged with duration_ms: 0
5. **No module logger usage** — child loggers exist but aren't used in routes/queue/cache
6. **Incomplete tests** — placeholders exist but don't verify actual behavior

## Files to Create

### None
All required files already exist. We only need to modify existing files.

## Files to Modify

### 1. `src/security/errors.ts`
**Changes:**
- Deprecate `createError()` — add JSDoc `@deprecated` tag pointing to `buildErrorResponse()` + `sendError()`
- Ensure `buildErrorResponse()` always includes `request_id` from `req.id` (already does)
- Add type export for `ErrorResponse` (already exists)

**Rationale:** Centralize error formatting, ensure all errors are consistent.

### 2. `src/routes/render.ts` (lines 14, 39-42, 48-50, 72-73, 97-98, 109-110, 116-117)
**Changes:**
- Replace all `createError()` calls with `buildErrorResponse()` + `reply.status().send()`
- Add render logging for sync requests:
  - Cache HIT: log with `{ url, type: 'screenshot'|'pdf', duration_ms: 0, cache_hit: true, format, request_id }`
  - Cache MISS: log with `{ url, type, duration_ms, cache_hit: false, format, request_id }`
- Use `getLogger('renderer')` for render-specific logs

**Example before:**
```typescript
const err = createError('SSRF_BLOCKED');
return reply.status(err.statusCode).send(err);
```

**Example after:**
```typescript
const response = buildErrorResponse('SSRF_BLOCKED', req);
return reply.status(400).send(response);
```

### 3. `src/routes/batch.ts` (lines 9, 28-29, 41-42, 47-48, 56-57, 122-123)
**Changes:**
- Replace all `createError()` calls with `buildErrorResponse()` + `reply.status().send()`
- Ensure all error responses include `request_id`

### 4. `src/routes/async-render.ts` (lines 5, 20-21)
**Changes:**
- Replace `createError()` calls with `buildErrorResponse()` + `reply.status().send()`

### 5. `src/routes/og.ts` (lines 8, 106-107, 117-118, 124-125)
**Changes:**
- Replace `createError()` calls with `buildErrorResponse()` + `sendError()`
- Add render logging:
  - Cache HIT: log with `{ type: 'og', cache_hit: true, duration_ms: 0, format: 'png' }`
  - Cache MISS: log with `{ type: 'og', cache_hit: false, duration_ms, format: 'png' }`
- Use `getLogger('renderer')` for OG card logs

### 6. `src/queue/render-queue.ts`
**Changes:**
- Import `getLogger('queue')` for structured queue logging
- Replace worker event logging (lines 46-92) with child logger:
  - `worker.on('completed')` → use `queueLogger.info()`
  - `worker.on('failed')` → use `queueLogger.error()`
- Keep existing log structure (already good): `{ url, type, duration_ms, cache_hit: false, format, job_id, status }`

**Note:** Current implementation logs to `app.log` (lines 211-230 in `src/index.ts`), which is fine but should be moved to queue module.

### 7. `src/index.ts`
**Changes:**
- Move queue worker event logging (lines 208-230) to `src/queue/render-queue.ts`
- Pass `getLogger('queue')` to worker creation
- Simplify `createWorker()` signature to accept logger

### 8. `src/cache/index.ts`
**Changes:**
- Import `getLogger('cache')` at module level
- Add cache operation logging:
  - `get()` — log cache hits/misses: `{ operation: 'get', key_prefix: hash.slice(0, 8), hit: boolean }`
  - `set()` — log cache writes: `{ operation: 'set', key_prefix: hash.slice(0, 8), size_bytes: buffer.length }`
  - `close()` — log shutdown: `{ operation: 'close' }`

**Rationale:** Cache is a critical performance component; logging helps debug cache behavior.

### 9. `tests/unit/logging.test.ts`
**Changes:**
- Complete placeholder tests (lines 69-73, 76-81):
  - Test `api_key_prefix` logging when auth is present (create test API key)
  - Test render job logging structure (mock queue worker events)
- Add new tests:
  - Verify child loggers include `module` field in logs
  - Test cache hit/miss logging
  - Test error logging format

### 10. `tests/unit/error-format.test.ts`
**Changes:**
- Update assertions to match canonical error format:
  - OLD: `{ error: string, code: string, statusCode: number }`
  - NEW: `{ error: { code: string, message: string, details?: object, request_id: string } }`
- Update line 32-35 to check for `body.error.code`, `body.error.message`, `body.error.request_id`
- Update line 55-60 (auth errors)
- Update line 69-75 (not found errors)
- Update line 88-90 (details field)
- Add test to verify `request_id` in error body matches `x-request-id` header

## Approach

### Phase 1: Update Error Response Format (Low Risk)
1. Modify all route handlers to use `buildErrorResponse()` + `sendError()`
2. Remove all `createError()` calls (keep function for backward compat, mark deprecated)
3. Verify error responses include `request_id` consistently

### Phase 2: Add Render Logging (Medium Risk)
1. Add logging to sync render routes (`/v1/screenshot`, `/v1/pdf`, `/v1/og`)
2. Log cache hits/misses with structured format
3. Move queue worker logging from `src/index.ts` to `src/queue/render-queue.ts`

### Phase 3: Add Cache Logging (Low Risk)
1. Import logger in `src/cache/index.ts`
2. Add operation logging (get, set, close)
3. Keep logs minimal (key prefix, not full data)

### Phase 4: Complete Tests (Low Risk)
1. Update `error-format.test.ts` to assert new canonical format
2. Complete placeholder tests in `logging.test.ts`
3. Add cache logging tests

## Edge Cases and Considerations

### 1. Fastify Request ID Availability
- **Issue:** `req.id` is set by Fastify's built-in request ID generator, but we also have custom `requestIdHook`
- **Solution:** Current `requestIdHook` reads `req.headers['x-request-id']` or generates UUID, then sets header. Fastify's `req.id` is separate. We should use `req.id` (Fastify's built-in) or ensure `req.id` is set in hook.
- **Action:** Update `requestIdHook` to set `req.id` instead of just headers

### 2. Performance Impact of Logging
- **Issue:** Logging every cache operation might add overhead
- **Solution:** Use `LOG_LEVEL=warn` in production to reduce verbosity; cache logs should be at `debug` level
- **Action:** Use `logger.debug()` for cache operations, `logger.info()` for renders

### 3. Log Volume in Production
- **Issue:** High-traffic APIs generate massive logs
- **Solution:**
  - Request logs already exist (good)
  - Render logs are 1:1 with requests (acceptable)
  - Cache logs should be `debug` level (off in production by default)
- **Action:** Set appropriate log levels (info for important events, debug for verbose)

### 4. Sensitive Data in Logs
- **Issue:** URLs, options, or user data might contain secrets
- **Solution:**
  - Never log full request bodies
  - Log URL domain only (not query params) OR sanitize URLs
  - Don't log API key values (only prefix — already done)
- **Action:** Review all log statements to ensure no secrets leak

### 5. Backwards Compatibility
- **Issue:** External clients might depend on old error format `{ error: string, code: string }`
- **Solution:**
  - Keep `createError()` but deprecate it
  - Update all internal usage to new format
  - Document breaking change in migration guide
- **Action:** Add deprecation warning to `createError()` JSDoc

### 6. Request ID Propagation to Queue Jobs
- **Issue:** Async/batch jobs don't have original request context
- **Solution:**
  - Store `request_id` in job data when enqueueing
  - Include in job completion/failure logs
- **Action:** Add `requestId` field to `RenderJobData` interface, log it in worker events

### 7. Error Handler Hook
- **Issue:** Global error handler (lines 138-160 in `src/index.ts`) already uses `buildErrorResponse()` — good!
- **Solution:** No changes needed, already correct
- **Action:** Verify all error paths go through this handler

### 8. Test Environment Logging
- **Issue:** Tests disable logging (`logger: false` when `NODE_ENV=test`)
- **Solution:** Mock logger in tests that need to verify log output
- **Action:** Use `vi.spyOn(app.log, 'info')` to capture logs in tests

### 9. Log Correlation Across Services
- **Issue:** If ScreenForge calls external services (webhooks), request IDs should propagate
- **Solution:** Include `X-Request-Id` header in outbound webhook requests
- **Action:** Update webhook delivery to include request ID (future enhancement, out of scope)

### 10. Module Logger Initialization
- **Issue:** `getLogger()` throws if called before `registerLoggers(app)`
- **Solution:** Already handled in current implementation
- **Action:** Ensure all modules import logger lazily (inside route handlers, not at module level)

## Implementation Order

1. **Update `src/security/request-id.ts`** — set `req.id` to match header
2. **Update route handlers** (render.ts, batch.ts, async-render.ts, og.ts) — replace `createError()`
3. **Add render logging** to sync routes (render.ts, og.ts)
4. **Move queue logging** from index.ts to render-queue.ts
5. **Add cache logging** to cache/index.ts
6. **Update tests** (error-format.test.ts, logging.test.ts)
7. **Run tests** — verify all assertions pass
8. **Manual testing** — trigger errors, check logs, verify request IDs

## Success Criteria

- ✅ All error responses follow canonical format: `{ error: { code, message, details?, request_id } }`
- ✅ All API requests log structured JSON with `method`, `url`, `status`, `duration_ms`, `api_key_prefix`, `request_id`
- ✅ All render operations log with `url`, `type`, `duration_ms`, `cache_hit`, `format`, `request_id`
- ✅ All module loggers (renderer, queue, cache, auth, billing) are available and used
- ✅ `request_id` appears in both response headers and error response bodies
- ✅ Tests pass and verify log format, error format, request ID propagation
- ✅ No console.log/console.error statements remain (all replaced with structured logger)

## Out of Scope

- Log aggregation/shipping (Datadog, CloudWatch, etc.) — infrastructure concern
- Distributed tracing (OpenTelemetry) — future enhancement
- Auth/billing module logging — no changes needed yet (covered by request logging)
- Webhook request ID propagation — future enhancement
- Log retention/rotation — handled by deployment environment
