# Security Policy

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue in ScreenForge, please report it responsibly.

### How to Report

**DO NOT** open a public GitHub issue for security vulnerabilities. Instead, please email us directly at:

**security@screenforge.dev**

### What to Include

When reporting a vulnerability, please include:

1. **Description**: Clear description of the vulnerability and its potential impact
2. **Steps to Reproduce**: Detailed steps to reproduce the issue
3. **Affected Versions**: Which versions are affected (if known)
4. **Suggested Fix**: If you have a proposed solution, include it (optional)
5. **Your Contact Info**: So we can follow up with questions or updates

### Response Timeline

- **Initial Response**: We aim to acknowledge your report within 48 hours
- **Status Update**: We'll provide a status update within 7 days
- **Resolution**: We'll work to fix confirmed vulnerabilities as quickly as possible, typically within 30 days for critical issues

### What to Expect

1. **Acknowledgment**: We'll confirm receipt of your report
2. **Validation**: We'll investigate and validate the vulnerability
3. **Fix**: We'll develop and test a fix
4. **Disclosure**: We'll coordinate disclosure with you
5. **Credit**: We'll credit you in the security advisory (unless you prefer to remain anonymous)

## Security Best Practices

When deploying ScreenForge in production, follow these security best practices:

### Authentication & Authorization

- **Enable Authentication**: Set `REQUIRE_AUTH=true` to require API keys for all render endpoints
- **Async Poll Endpoints**: Note that `/v1/render/:id` and `/v1/batch/:id` are intentionally public - the job ID itself acts as an authentication token (UUIDs are unguessable). These endpoints only expose job metadata and the URL being rendered, not API keys or sensitive user data.
- **Rotate API Keys**: Regularly rotate API keys, especially if they may have been compromised
- **Admin Endpoints**: Secure the `/v1/keys` admin endpoint with `ADMIN_API_KEY`
- **Metrics Access**: Set `METRICS_AUTH_REQUIRED=true` if your metrics contain sensitive data

### CORS Configuration

- **Production CORS**: Configure `CORS_ORIGINS` with a comma-separated list of allowed origins (e.g., `https://example.com,https://app.example.com`)
- **Development Only**: Never use `origin: true` in production deployments

### SSRF Protection

- **Private URLs**: Keep `ALLOW_PRIVATE_URLS=false` (default) to prevent SSRF attacks
- **Custom Validation**: If you need to render private URLs, implement additional validation in your application layer

### Network Security

- **HTTPS Only**: Always serve ScreenForge over HTTPS in production
- **Reverse Proxy**: Use nginx or a similar reverse proxy to terminate SSL and rate limit requests
- **Trust Proxy**: Enable `trustProxy` in production mode (already configured when `NODE_ENV=production`)

### Secrets Management

- **Environment Variables**: Never commit `.env` files with real secrets
- **API Key Salt**: Generate a strong `API_KEY_SALT` (minimum 32 characters): `openssl rand -hex 32`
- **Session Secret**: Generate a strong `SESSION_SECRET` (minimum 32 characters): `openssl rand -hex 32`
- **Stripe Webhooks**: Use the webhook signing secret (`STRIPE_WEBHOOK_SECRET`) to verify webhook authenticity

### Dependencies

- **Regular Updates**: Run `npm audit` regularly and update dependencies
- **Security Advisories**: Subscribe to security advisories for critical dependencies (Playwright, Fastify, etc.)

### Monitoring

- **Logging**: Monitor logs for suspicious activity (unusual URLs, failed auth attempts, rate limit hits)
- **Metrics**: Track metrics for anomalies (sudden traffic spikes, error rate increases)
- **Alerting**: Set up alerts for critical errors and security events

## Security Features

ScreenForge includes the following built-in security features:

### SSRF Protection

- Blocks rendering of private/internal IP addresses (127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16)
- Blocks IPv6 private ranges (::1, ::ffff:0:0/96, fd00::/8, fe80::/10)
- Can be disabled via `ALLOW_PRIVATE_URLS=true` for internal use cases

### Input Validation

- URL sanitization to prevent injection attacks
- HTML content size limits (2MB default)
- CSS/JS injection size limits (50KB/10KB)
- Selector and waitFor string length limits
- Dangerous pattern detection in custom CSS/JS

### Rate Limiting

- Sliding window rate limiting per API key
- Configurable limits per tier (free, starter, pro, business)
- Automatic cleanup of old rate limit data

### Authentication

- Secure API key hashing with salt
- Timing-safe comparison for API keys
- Optional authentication requirement (`REQUIRE_AUTH`)
- Admin-only endpoints for key management

### Security Headers

- `X-Content-Type-Options: nosniff` - Prevents MIME type sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `Strict-Transport-Security` - Enforces HTTPS in production (with `max-age=31536000; includeSubDomains`)

### Webhook Security

- Stripe webhook signature validation (enforced)
- SSRF protection for callback URLs
- Automatic retry with exponential backoff

## Known Limitations

- **DNS Rebinding**: SSRF protection validates hostnames at request time by resolving them to IP addresses. A malicious DNS server could return a public IP on first lookup (passing validation) and a private IP on subsequent lookups (DNS rebinding). To mitigate this, use firewall rules to block outbound traffic to private IP ranges at the network level, or deploy ScreenForge with `ALLOW_PRIVATE_URLS=false` (default) behind a DNS resolver that pins responses.
- **Browser Sandbox**: Playwright runs Chromium in a sandbox, but rendering untrusted content always carries some risk
- **Resource Limits**: Configure appropriate timeouts and resource limits to prevent DoS via expensive render jobs
- **File Storage**: Cached files are stored on disk - ensure proper file permissions and disk quotas

## Version Support

We provide security updates for:

- **Latest Release**: All security fixes
- **Previous Minor Version**: Critical security fixes only (for 6 months after new minor release)

Older versions are not supported. Please upgrade to the latest version to receive security updates.

## Disclosure Policy

We follow coordinated vulnerability disclosure:

1. Vulnerabilities are fixed privately
2. Security advisory is published after the fix is released
3. We coordinate with reporters on disclosure timeline
4. Critical vulnerabilities may receive expedited releases

Thank you for helping keep ScreenForge secure!
