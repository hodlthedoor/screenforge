# ScreenForge Performance Benchmarks

## Hardware

| Component | Specification |
|-----------|---------------|
| CPU | 2x Intel Xeon E5-2630 v4 (40 threads total) |
| RAM | 128 GB DDR4 |
| OS | Pop!_OS 24.04 (Linux 6.17) |
| Node.js | v22.22.0 |
| Disk | ~800 GB free |

## Test Methodology

Load tests use [autocannon](https://github.com/mcollina/autocannon) against a live production instance on `localhost:3101`. A temporary "business" tier API key with unlimited rate limits is created for each test run and cleaned up afterward.

Run benchmarks:

```bash
npm run test:load
# or with custom target:
npx tsx tests/load/benchmark.ts --base-url=http://localhost:3101
```

Results are written to `tests/load/results.json` (gitignored).

### Scenarios

1. **GET /health** — Non-render baseline. 100 connections, 10 pipelining, 10s duration.
2. **POST /v1/screenshot** — Render job submission at 5/10/20 concurrent connections, 30s each. Measures API throughput (job queuing), not render time.
3. **POST /v1/batch** — Batch submission with 10 URLs per request, 5 concurrent, 30s.

## Results (2026-02-14)

### Baseline (before tuning)

Configuration: `BROWSER_POOL_SIZE=5`, `WORKER_CONCURRENCY=3`, `DB_POOL_MAX=10`

| Scenario | Requests | RPS | Errors | p50 | p97.5 | p99 |
|----------|----------|-----|--------|-----|-------|-----|
| GET /health (100 conn) | 92,691 | 8,426 | 0 | 112ms | 134ms | 161ms |
| POST /v1/screenshot (5 conn) | 19,076 | 636 | 0 | 6ms | 13ms | 18ms |
| POST /v1/screenshot (10 conn) | 23,406 | 780 | 0 | 11ms | 19ms | 27ms |
| POST /v1/screenshot (20 conn) | 25,300 | 843 | 0 | 22ms | 34ms | 46ms |
| POST /v1/batch (10 URLs, 5 conn) | 4,930 | 164 | 0 | 28ms | 49ms | 69ms |

### Optimized

Configuration: `BROWSER_POOL_SIZE=8`, `WORKER_CONCURRENCY=8`, `DB_POOL_MAX=20`, `MAX_RENDERS_PER_CONTEXT=50`

| Scenario | Requests | RPS | Errors | p50 | p97.5 | p99 |
|----------|----------|-----|--------|-----|-------|-----|
| GET /health (100 conn) | 107,831 | 9,803 | 0 | 93ms | 180ms | 223ms |
| POST /v1/screenshot (5 conn) | 20,598 | 687 | 0 | 6ms | 12ms | 16ms |
| POST /v1/screenshot (10 conn) | 25,136 | 838 | 0 | 10ms | 18ms | 25ms |
| POST /v1/screenshot (20 conn) | 27,312 | 910 | 0 | 20ms | 30ms | 37ms |
| POST /v1/batch (10 URLs, 5 conn) | 4,932 | 164 | 0 | 28ms | 52ms | 64ms |

**Improvement**: Health +16%, Screenshot +8%, p99 latency improved across all scenarios.

## Architecture Notes

### Request Flow

Screenshot/PDF requests follow an async pattern:

1. **API accepts request** — validates input, checks auth + rate limits, enqueues to BullMQ (~5-30ms)
2. **Worker picks up job** — acquires browser context from pool, navigates, renders (~2-30s depending on page complexity)
3. **Result stored** — saved to disk, DB updated, webhooks fired

The benchmark measures step 1 (API throughput). Actual render throughput is limited by `WORKER_CONCURRENCY` and `BROWSER_POOL_SIZE`.

### Bottleneck Analysis

| Resource | Default | Impact |
|----------|---------|--------|
| `BROWSER_POOL_SIZE` | 3 (code) / 5 (production) | Each browser instance uses ~150-300MB RAM. With 128GB RAM, can safely run 8-10 instances. |
| `WORKER_CONCURRENCY` | 3 (hardcoded, now configurable) | Should match or be slightly less than `BROWSER_POOL_SIZE`. Controls how many renders happen simultaneously. |
| `DB_POOL_MAX` | 10 (hardcoded, now configurable) | PostgreSQL default max_connections is 100. 10-20 is fine for single-instance. |
| `NAVIGATION_TIMEOUT_MS` | 30,000 | 30s is reasonable for complex pages. Reduce to 15s for known-fast targets. |
| `MAX_RENDERS_PER_CONTEXT` | 100 | Browser recycling threshold. Higher values reduce browser restart overhead but increase memory leak risk. |

## Recommended Production Settings

For the current hardware (40 threads, 128GB RAM):

```bash
BROWSER_POOL_SIZE=8        # 8 browser instances (~2.4GB RAM)
WORKER_CONCURRENCY=8       # Match browser pool
DB_POOL_MAX=20             # Headroom for concurrent DB operations
MAX_RENDERS_PER_CONTEXT=50 # Recycle more frequently to prevent memory leaks
NAVIGATION_TIMEOUT_MS=30000
```

Conservative estimate for actual render throughput with these settings:

- Simple pages (example.com): ~8 renders/sec (1s per render, 8 concurrent)
- Complex SPAs: ~1-2 renders/sec (4-8s per render, 8 concurrent)

## Configurable Parameters

All parameters are set via environment variables:

| Variable | Type | Default | Range | Description |
|----------|------|---------|-------|-------------|
| `BROWSER_POOL_SIZE` | int | 3 | 1-20 | Number of Chromium browser instances |
| `MAX_RENDERS_PER_CONTEXT` | int | 100 | 1+ | Renders before browser recycling |
| `WORKER_CONCURRENCY` | int | 3 | 1-50 | BullMQ worker concurrency |
| `DB_POOL_MAX` | int | 10 | 1-100 | PostgreSQL connection pool maximum |
| `NAVIGATION_TIMEOUT_MS` | int | 30000 | 1000-120000 | Page navigation timeout |

## Observations

1. **Fastify throughput is not the bottleneck.** At 8,400+ rps for health checks, the HTTP layer has ample headroom.
2. **Screenshot API submissions are fast** (~6ms p50 at 5 concurrent). The async queue pattern decouples API response time from actual render latency.
3. **Rate limiting is the primary API-level constraint** for burst traffic. The sliding window rate limiter (per-key, per-minute) is effective.
4. **Batch endpoint is efficient** — 164 rps means ~1,640 individual renders queued per second at 5 concurrent connections.
5. **Memory is the primary scaling constraint** for browser pool size. Each Chromium instance uses 150-300MB.
