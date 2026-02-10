# Changelog

## [1.0.0] - 2026-02-10

### Added

- **Landing page** — developer-focused dark theme with hero, feature grid, pricing, code examples, and self-host callout
- **Dashboard** — protected area with session auth (cookie-based)
  - Overview page with usage stats and recent renders
  - API Keys page with create/revoke functionality
  - Usage page with daily/monthly charts by render type
  - Settings page with account management
- **User auth** — email/password registration with bcrypt, session cookies via Redis
- **Docker Compose** — production setup with ScreenForge, Redis 7, PostgreSQL 16 (health checks, volumes, restart policies)
- **CI/CD** — GitHub Actions workflows for lint, typecheck, tests (with Redis+PG services), Docker build, and release to GHCR
- **Comprehensive README** — badges, quick start, full API reference, config reference, self-hosting guide, architecture diagram

### Changed

- Updated `.env.example` with all configuration variables documented
- Bumped version to 1.0.0

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
