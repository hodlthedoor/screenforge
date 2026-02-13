# Changelog

All notable changes to ScreenForge are documented here.

## [1.0.0] - 2026-02-13

### Added

- **Signed URLs** — pre-signed screenshot and PDF URLs with HMAC-SHA256 signatures and expiry
- **Stripe billing** — checkout, customer portal, subscription management with webhook handlers
- **Email system** — transactional emails for welcome, verification, password reset, billing alerts
- **Admin panel** — user management, queue monitoring, storage cleanup (session-based admin auth)
- **Webhook management** — delivery tracking, retry, test webhook endpoint
- **Legal pages** — Terms of Service and Privacy Policy
- **Prometheus metrics** — request counters, render durations, pool stats at /metrics
- **Structured logging** — pino-based logging with request IDs, module-level loggers
- **Content filters** — ad blocking, cookie banner hiding, custom CSS/JS injection
- **HTML rendering** — render from raw HTML in addition to URLs
- **Comprehensive API docs** — Swagger UI at /docs with full OpenAPI schemas
- **JavaScript SDK** — @screenforge/sdk with typed client, retries, error handling
- **Landing page** — developer-focused dark theme with hero, feature grid, pricing, code examples, and self-host callout
- **Dashboard** — protected area with session auth (cookie-based): overview with usage stats, API key management, daily/monthly usage charts, account settings
- **User auth** — email/password registration with bcrypt, session cookies via Redis
- **Docker Compose** — production setup with ScreenForge, Redis 7, PostgreSQL 16 (health checks, volumes, restart policies)
- **CI/CD** — GitHub Actions workflows for lint, typecheck, tests (with Redis+PG services), Docker build, and release to GHCR

### Changed

- Bumped version to 1.0.0
- Updated OpenAPI spec to 1.0.0
- Expanded README with full API reference, configuration guide, self-hosting instructions
- Updated `.env.example` with all configuration variables documented

## [0.2.0] - 2026-02-09

### Added

- Authentication system with API key tiers (Free/Starter/Pro/Business)
- Rate limiting with Redis sliding window
- BullMQ async job queue with webhook callbacks
- Batch rendering (up to 50 items)
- OG card generation with templates and themes
- SSRF protection and input sanitization
- Comprehensive test suite (150+ tests)

## [0.1.0] - 2026-02-09

### Added

- Initial screenshot and PDF rendering via Playwright
- Browser pool with auto-recycling
- Content-hash caching (Redis + file storage)
- Health check endpoints
- OpenAPI/Swagger documentation

[1.0.0]: https://github.com/hodlthedoor/atlas-project/compare/v0.2.0...v1.0.0
[0.2.0]: https://github.com/hodlthedoor/atlas-project/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/hodlthedoor/atlas-project/releases/tag/v0.1.0
