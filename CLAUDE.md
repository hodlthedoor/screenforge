# ScreenForge

Self-hostable screenshot, PDF, and OG image generation API. Open-source alternative to ScreenshotOne/Urlbox.

## Tech Stack

- Node.js 22 + TypeScript (strict mode, no `any`)
- Fastify 5 (API framework)
- Playwright + Chromium (browser automation)
- PostgreSQL 16 (persistence)
- Redis 7 + BullMQ 5 (caching, async job queue)
- Zod 4 (input validation)
- Sharp 0.34 (image processing)
- Stripe (billing, optional)
- Vitest 4 (testing, 70% coverage threshold)
- Docker & Docker Compose

## Project Structure

```
src/
  index.ts                # Server bootstrap, middleware, graceful shutdown
  config/index.ts         # Zod-validated env loading
  renderer/
    schemas.ts            # All Zod validation schemas (screenshot, PDF, GIF, diff)
    screenshot.ts         # Playwright screenshot capture
    pdf.ts                # PDF generation (A4/Letter/Legal)
    gif.ts                # GIF recording
    diff.ts               # Visual regression diffing (pixelmatch)
    browser-pool.ts       # Managed Playwright browser pool with context recycling
    devices.ts            # Device presets (iPhone, iPad, Galaxy, etc.)
    actions.ts            # Pre-capture interactions (click, scroll, type, hover, wait)
    fonts.ts              # Custom font loading (Google Fonts + direct CSS)
    filters.ts            # Ad blocking, element hiding/removal, blurring
    metadata.ts           # OG/Twitter card extraction
    content-validation.ts # fail_if_contains/fail_if_missing
    timeout.ts            # Per-request timeout handling
  routes/                 # 25+ Fastify route handlers
    render.ts             # POST /v1/screenshot, /v1/pdf (sync rendering)
    async-render.ts       # Async job queueing
    batch.ts              # Batch rendering (up to 50 items)
    signed.ts             # HMAC-signed GET URLs
    diff.ts               # Visual diff & baselines
    og.ts                 # OG card generation with templates
    gif.ts                # GIF recording
    admin.ts              # Admin operations
    auth.ts               # Login/register/password reset
    dashboard.ts          # Web UI for key & usage management
    billing.ts            # Stripe checkout & portal
    webhooks.ts           # Webhook management & delivery
    analytics.ts          # Usage analytics & history
    schedules.ts          # Recurring render jobs
    extract.ts            # Anthropic-powered content extraction
    accessibility.ts      # Accessibility scanning (Axe)
  auth/                   # API key auth, rate limiting, session
  billing/                # Stripe integration
  cache/                  # Redis-backed render cache with TTL
  db/                     # PostgreSQL pool, migrations, user/key management
  docs/                   # Swagger/OpenAPI documentation
  email/                  # Nodemailer SMTP templates
  logging/                # Pino logger
  metrics/                # Prometheus metrics (request count, duration, cache hits)
  queue/                  # BullMQ render queue, deduplication, retry policy
  scheduler/              # Recurring job scheduler & analytics refresh
  security/               # Input sanitization, SSRF protection
  storage/                # Local & S3-compatible storage backends
  webhooks/               # Webhook signing, delivery queue, retry logic
sql/                      # PostgreSQL migrations (25 files, applied in order)
tests/                    # Test files
docker-compose.yml        # Local dev: screenforge + postgres + redis + optional monitoring
Dockerfile                # Multi-stage build (Node 22 + Playwright Chromium deps)
ecosystem.config.cjs      # PM2 config (fork, 4GB max memory)
```

## Adding a Rendering Feature

Follow this pattern consistently:

1. **Schema** — Add Zod schema in `src/renderer/schemas.ts`
2. **Renderer** — Implement in `src/renderer/screenshot.ts` (or `pdf.ts`, `gif.ts`)
3. **Routes** — Wire into relevant route handlers in `src/routes/`
4. **Tests** — Write tests (vitest)
5. **Swagger** — Update OpenAPI docs in `src/docs/`

## Route Pattern

All routes follow: auth middleware → Zod validation → rate limit check → business logic → response.

See `src/routes/render.ts` as the canonical example.

## Key Architectural Features

- **Browser Pool** — reusable Playwright contexts with automatic recycling after N renders
- **Async Queue** — BullMQ for long-running renders, with webhooks on completion
- **Deduplication** — SHA256 fingerprinting shares browser execution for identical concurrent requests
- **Render Cache** — Redis-backed with TTL, content-addressed by request hash
- **Rate Limiting** — sliding window or token bucket per API key/tier
- **SSRF Protection** — blocks private/internal IP ranges by default (127.x, 10.x, 172.16-31.x, 192.168.x, ::1)
- **Graceful Shutdown** — waits for in-flight renders, closes pools sequentially
- **Error Handling** — centralized via `buildErrorResponse()` with typed error codes
- **Metrics** — Prometheus endpoint at `/metrics`

## Commands

```bash
npm run dev              # Dev server with hot reload (tsx watch)
npm run build            # TypeScript compile
npm start                # Production (node dist/index.js)
npm test                 # Run all tests (vitest run)
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report (70% threshold)
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm run test:e2e         # E2E tests (separate vitest config)
npm run generate         # Generate OpenAPI spec, Postman collection, SDKs
```

## Database

PostgreSQL 16 with 25 migrations in `sql/`. Tables include: users, api_keys, render_jobs, webhooks, billing_events, schedules, diff_baselines, analytics, etc.

- Migrations auto-run in Docker
- Manual: `psql screenforge < sql/001_initial.sql` (and so on in order)
- Test DB: `screenforge_test` — must have same migrations applied

## Environment Variables

**Required:**
- `API_KEY_SALT` — min 16 chars (`openssl rand -hex 32`)
- `SESSION_SECRET` — min 32 chars
- `DATABASE_URL` — PostgreSQL connection string (default: `postgresql:///screenforge?host=/var/run/postgresql`)

**Rendering:**
- `PORT=3100`
- `BROWSER_POOL_SIZE=3` (1-20 instances)
- `MAX_RENDERS_PER_CONTEXT=100`
- `CACHE_TTL_SECONDS=3600` (0 = disabled)
- `NAVIGATION_TIMEOUT_MS=30000`
- `RENDER_TIMEOUT_MS=30000`
- `STORAGE_PATH=./storage` (or S3 config)

**Security:**
- `REQUIRE_AUTH=false` (enforce API key auth)
- `ALLOW_PRIVATE_URLS=false` (SSRF protection)

**Optional integrations:**
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` — billing
- `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — email
- `ANTHROPIC_API_KEY` — AI content extraction (`/v1/extract`)
- `METRICS_ENABLED=true` — Prometheus metrics

**Testing:**
- Redis test DB: `redis://127.0.0.1:6379/15`

## Coding Standards

- TypeScript strict mode, no `any`, no `unknown` casts
- Conventional commits (feat:, fix:, refactor:, etc.)
- TDD: write failing tests first, then implement
- Keep files small, single responsibility
- Zod for all input validation — never trust raw input
