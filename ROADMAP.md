# ScreenForge Roadmap

## Completed Milestones

### v1.0.0 (Feb 2026) — Production Foundation
- ✅ Core rendering (screenshots, PDFs, OG cards)
- ✅ Browser pool with Playwright Chromium
- ✅ Content-hash caching with Redis
- ✅ API key authentication with tier-based rate limiting
- ✅ BullMQ async job queue
- ✅ Batch rendering (up to 50 jobs)
- ✅ Signed URLs with HMAC-SHA256
- ✅ Webhook delivery tracking and retry
- ✅ Stripe billing integration (checkout, portal, webhooks)
- ✅ Transactional email system (SMTP)
- ✅ Dashboard with usage charts and API key management
- ✅ Admin panel with user/queue/storage management
- ✅ Prometheus metrics and Grafana dashboards
- ✅ Python and JavaScript SDKs
- ✅ Docker Compose deployment
- ✅ SSRF protection and input sanitization
- ✅ Comprehensive test suite (150+ tests, 83% coverage)

### v1.1.0 (Feb 2026) — Developer Experience & Publishing
- ✅ Docker Hub multi-arch publishing (amd64/arm64)
- ✅ Polished API documentation site
- ✅ Landing page with conversion optimization
- ✅ E2E integration tests
- ✅ Circuit breaker and graceful shutdown
- ✅ Automated SDK publishing (npm, PyPI)
- ✅ Security audit and DNS rebinding protection
- ✅ CI/CD hardening

### v1.2.0 (Feb 2026) — Advanced Capture Controls
- ✅ Pre-capture actions (click, scroll, type, hover, wait, delay)
- ✅ Element hiding and removal via CSS selectors
- ✅ Element blurring with configurable radius
- ✅ Content validation (fail_if_contains, fail_if_missing)
- ✅ Ad blocking (40+ ad/tracker domains)
- ✅ SDK updates with Phase 2 rendering options

### v1.4.0 (Feb 2026) — Integrations & Extensibility
- ✅ CLI tool (`screenforge` binary) for terminal-based screenshots, PDFs, and health checks
- ✅ Custom font loading via CDN URLs (Google Fonts, jsDelivr, unpkg) with local caching
- ✅ Postman collection and OpenAPI tooling for API exploration and SDK generation
- ✅ Visual diff API — pixel-by-pixel screenshot comparison with diff image and mismatch stats
- ✅ Visual diff baselines — store reference screenshots and detect regressions with webhook notifications

---

## Future Plans

### v1.3.0 — Performance & Scale
- **Render optimization**
  - Image format optimization (WebP, AVIF)
  - Lazy resource loading
  - Smart cache warming
  - Multi-region CDN integration
- **Queue improvements**
  - Priority queues by tier
  - Job deduplication
  - Smarter retry policies
  - Rate limit smoothing
- **Infrastructure**
  - Horizontal scaling with Redis Cluster
  - Multi-instance browser pool coordination
  - Storage backends (S3, R2, GCS)
  - Database read replicas

### v1.5.0 — Enterprise & Security
- **Authentication**
  - OAuth2 provider integration
  - SSO support (SAML, OIDC)
  - Team workspaces with role-based access
  - API key rotation and audit logs
- **Compliance**
  - GDPR compliance toolkit
  - Data residency controls
  - Encryption at rest
  - SOC 2 preparation
- **Enterprise features**
  - Custom SLA tiers
  - Dedicated browser pools
  - White-label branding
  - On-premise deployment guides

### Later
- Mobile device emulation (iOS Safari, Android Chrome)
- Screenshot annotation API
- Multi-page PDF generation from URL lists
- Scheduled renders with cron-like syntax
- Browser extensions for testing
- GraphQL API
- Real-time render streaming (WebSockets)
- AI-powered element detection
- Render analytics ML insights

---

## Contributing

Have an idea or feature request? Open an issue or submit a PR!

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
