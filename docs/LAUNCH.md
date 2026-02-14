# ScreenForge Launch Guide

## What is ScreenForge?

ScreenForge is a self-hostable screenshot, PDF, and OG image API — an open-source alternative to ScreenshotOne and Urlbox with complete feature parity and zero vendor lock-in.

## Quick Start

Get ScreenForge running in under 60 seconds:

```bash
git clone https://github.com/hodlthedoor/screenforge.git
cd screenforge
cp .env.example .env
# Generate required secrets:
#   openssl rand -hex 32   -> API_KEY_SALT
#   openssl rand -hex 32   -> SESSION_SECRET
docker-compose up -d
```

Visit `http://localhost:3100` and you're live.

## Key Features

- **Screenshots & PDFs** — Full-page capture, custom viewports, dark mode, element targeting
- **OG Card Generation** — Customizable social media preview images with templates
- **Batch Rendering** — Render up to 50 screenshots/PDFs in a single API call
- **Async/Polling** — Handle long-running renders with webhook callbacks
- **Signed URLs** — Pre-signed URLs with HMAC-SHA256 and expiry
- **Stripe Billing** — Built-in subscription management with checkout and customer portal
- **Admin Panel** — User management, queue monitoring, storage cleanup
- **API Playground** — Interactive browser-based API testing at `/playground`
- **Analytics Dashboard** — Usage stats, render history, top URLs at `/dashboard`
- **Prometheus Metrics** — Production-grade monitoring at `/metrics`

## Documentation

- **[API Reference](/docs)** — Complete API documentation with examples
- **[Self-Hosting Guide](../README.md#self-hosting)** — Deployment, configuration, and production setup
- **[Contributing Guide](../CONTRIBUTING.md)** — How to contribute to ScreenForge
- **[Security Policy](../SECURITY.md)** — Vulnerability reporting and security best practices
- **[Docker Publishing](DOCKER.md)** — Docker Hub and GHCR image publishing
- **[SDK Publishing](PUBLISHING.md)** — npm and PyPI SDK release workflow

## Pricing Tiers

ScreenForge includes a complete billing system out of the box:

| Tier | Monthly Quota | Price/mo |
|------|---------------|----------|
| **Free** | 1,000 renders | $0 |
| **Starter** | 10,000 renders | $19 |
| **Pro** | 100,000 renders | $49 |
| **Business** | 1,000,000 renders | $149 |

Configure tiers in `src/config.ts` or via environment variables.

## Live Demo & Testing

- **API Playground**: `http://localhost:3100/playground`
- **Dashboard**: `http://localhost:3100/dashboard`
- **API Docs**: `http://localhost:3100/docs`
- **Health Check**: `http://localhost:3100/health`
- **Metrics**: `http://localhost:3100/metrics`

## How to Contribute

We welcome contributions! See [CONTRIBUTING.md](../CONTRIBUTING.md) for:

- Code of conduct
- Development setup
- Testing guidelines
- Commit message conventions
- Pull request process

## Support & Community

- **Issues**: [GitHub Issues](https://github.com/hodlthedoor/screenforge/issues)
- **Discussions**: [GitHub Discussions](https://github.com/hodlthedoor/screenforge/discussions)
- **License**: [MIT License](../LICENSE)

## Why Self-Host?

1. **Data sovereignty** — Your renders never leave your infrastructure
2. **Zero vendor lock-in** — MIT licensed, runs anywhere
3. **Cost control** — No usage-based pricing surprises
4. **Full customization** — Modify and extend as needed
5. **Privacy-first** — No telemetry or tracking

---

**Ready to launch?** Run `docker-compose up -d` and start rendering.

For production deployments, see the [Self-Hosting Guide](../README.md#self-hosting).
