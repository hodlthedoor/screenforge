# ScreenForge

Self-hostable screenshot & render API. Open-source alternative to ScreenshotOne.

## Features

- **Screenshot capture** — full page, viewport, or element screenshots via Playwright
- **PDF rendering** — convert any URL to PDF with configurable options
- **HTML-to-image** — render raw HTML/CSS to PNG, JPEG, or WebP
- **API key authentication** — tier-based access with rate limiting
- **Job queue** — async rendering via BullMQ with Redis
- **Caching** — content-hash deduplication avoids re-rendering identical requests
- **Usage tracking** — daily usage counters per API key

## Pricing Model

| Tier     | Renders/month | Price    |
|----------|--------------|----------|
| Free     | 100          | $0       |
| Starter  | 5,000        | $9/mo    |
| Pro      | 25,000       | $29/mo   |
| Business | Unlimited    | $79/mo   |

## Quick Start

### Docker

```bash
cp .env.example .env
# Edit .env with your configuration (set API_KEY_SALT)

docker build -t screenforge .
docker run -p 3100:3100 --env-file .env screenforge
```

### Local Development

```bash
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env

npm run dev
```

## API Overview

### Health Check

```
GET /health
→ { "status": "ok", "timestamp": "..." }
```

### Take Screenshot

```
POST /v1/screenshot
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "url": "https://example.com",
  "format": "png",
  "width": 1920,
  "height": 1080,
  "fullPage": false
}
```

### Render PDF

```
POST /v1/pdf
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "url": "https://example.com",
  "format": "A4",
  "landscape": false
}
```

### Render HTML

```
POST /v1/html
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "html": "<h1>Hello</h1>",
  "css": "h1 { color: red; }",
  "format": "png",
  "width": 800,
  "height": 600
}
```

## Tech Stack

- **Runtime**: Node.js 22 + TypeScript
- **Framework**: Fastify
- **Browser**: Playwright (Chromium)
- **Queue**: BullMQ + Redis
- **Database**: PostgreSQL
- **Validation**: Zod
