# ScreenForge

[![CI](https://github.com/hodlthedoor/atlas-project/actions/workflows/ci.yml/badge.svg)](https://github.com/hodlthedoor/atlas-project/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)](docker-compose.yml)

Self-hostable screenshot & render API. Open-source alternative to ScreenshotOne.

## Quick Start

```bash
git clone https://github.com/hodlthedoor/atlas-project.git
cd atlas-project/screenforge
cp .env.example .env  # edit API_KEY_SALT and SESSION_SECRET
docker compose up -d
```

The API is available at `http://localhost:3100`, dashboard at `http://localhost:3100/dashboard`.

## Features

- **Screenshots** — full page, viewport, or element-level capture (PNG/JPEG)
- **PDF generation** — any URL to PDF with A4/Letter/Legal, margins, headers
- **OG card generation** — auto-generate Open Graph preview images
- **Batch rendering** — up to 50 renders in a single request
- **Caching** — content-hash deduplication with configurable TTL
- **Webhooks** — async render notifications via callback URLs
- **Dashboard** — manage API keys, view usage charts, account settings
- **API key auth** — tier-based access with sliding-window rate limiting
- **Job queue** — async rendering via BullMQ with Redis

## API Reference

### Screenshots

```bash
curl -X POST http://localhost:3100/v1/screenshot \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "format": "png", "width": 1920, "height": 1080}' \
  --output screenshot.png
```

Options: `url`, `format` (png|jpeg), `width`, `height`, `fullPage`, `selector`, `darkMode`, `deviceScaleFactor`, `delay`

### PDF

```bash
curl -X POST http://localhost:3100/v1/pdf \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "format": "A4"}' \
  --output page.pdf
```

Options: `url`, `format` (A4|Letter|Legal), `landscape`, `margin`, `headerTemplate`, `footerTemplate`

### OG Cards

```bash
curl -X POST http://localhost:3100/v1/og \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' \
  --output og.png
```

Options: `url`, `title`, `description`, `template` (default|article|product), `theme` (light|dark)

### Batch

```bash
curl -X POST http://localhost:3100/v1/batch \
  -H "Content-Type: application/json" \
  -d '{"items": [{"type": "screenshot", "url": "https://example.com"}]}'
```

### Async Rendering

Add `?async=true` to any render endpoint to queue the job:

```bash
curl -X POST "http://localhost:3100/v1/screenshot?async=true" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
# Returns: {"jobId": "...", "pollUrl": "/v1/render/..."}
```

### Health

```
GET /health              → {"status": "ok"}
GET /v1/health           → {"status": "ok", "version": "1.0.0", "uptime": ..., "browserPool": {...}}
```

### API Key Management (Admin)

```bash
# Create key
curl -X POST http://localhost:3100/v1/keys \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "My Key", "tier": "pro"}'

# List keys
curl http://localhost:3100/v1/keys \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

## Pricing Tiers

| Tier     | Renders/month | Rate Limit   | Price   |
|----------|--------------|--------------|---------|
| Free     | 1,000        | 10 req/min   | $0      |
| Starter  | 10,000       | 50 req/min   | $19/mo  |
| Pro      | 100,000      | 200 req/min  | $49/mo  |
| Business | 1,000,000    | 1,000 req/min| $149/mo |

## Configuration

See [`.env.example`](.env.example) for all available environment variables.

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3100 | Server port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | redis://127.0.0.1:6379/0 | Redis connection |
| `API_KEY_SALT` | — | Salt for API key hashing (required, min 16 chars) |
| `SESSION_SECRET` | — | Session cookie secret (required, min 32 chars) |
| `BROWSER_POOL_SIZE` | 3 | Number of Playwright browser instances |
| `CACHE_TTL_SECONDS` | 3600 | Cache duration (0 = disabled) |
| `REQUIRE_AUTH` | false | Require API key for all endpoints |
| `ALLOW_PRIVATE_URLS` | false | Allow private/internal URL rendering |

## Self-Hosting Guide

### Docker Compose (recommended)

```bash
cp .env.example .env
# Set API_KEY_SALT and SESSION_SECRET (generate with: openssl rand -hex 32)
docker compose up -d
```

This starts ScreenForge with Redis and PostgreSQL. Data is persisted via Docker volumes.

### Manual Setup

```bash
# Prerequisites: Node.js 22+, PostgreSQL 16+, Redis 7+
npm install
npx playwright install chromium
psql screenforge < sql/002_auth_queue.sql
psql screenforge < sql/003_users.sql
cp .env.example .env  # configure
npm run build && npm start
```

## Architecture

```mermaid
graph TD
    Client([Client]) --> LB[Fastify Server :3100]
    LB --> Landing[Landing Page /]
    LB --> Auth[Auth Routes /login /register]
    LB --> Dash[Dashboard /dashboard/*]
    LB --> API[API Routes /v1/*]
    API --> Pool[Browser Pool]
    Pool --> PW[Playwright Chromium]
    API --> Queue[BullMQ Queue]
    Queue --> Worker[Queue Worker]
    Worker --> Pool
    API --> Cache[Redis Cache]
    API --> RateLimit[Rate Limiter]
    Auth --> PG[(PostgreSQL)]
    API --> PG
    Cache --> Redis[(Redis)]
    RateLimit --> Redis
    Queue --> Redis
```

## Development

```bash
npm run dev          # Start with hot reload
npm test             # Run test suite
npm run lint         # Lint check
npm run typecheck    # Type check
npm run build        # Compile TypeScript
```

## Tech Stack

- **Runtime**: Node.js 22 + TypeScript (strict mode)
- **Framework**: Fastify 5
- **Browser**: Playwright (Chromium)
- **Queue**: BullMQ + Redis
- **Database**: PostgreSQL 16
- **Validation**: Zod
- **Auth**: bcrypt + cookie sessions
- **Testing**: Vitest

## License

MIT
