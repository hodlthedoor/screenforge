# Self-Hosting ScreenForge

ScreenForge is fully self-hostable. This guide covers the two main deployment options: Docker Compose (recommended) and bare metal.

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Docker + Docker Compose | 24+ |
| **or** Node.js | 22+ |
| **or** PostgreSQL | 16+ |
| **or** Redis | 7+ |

---

## Option 1: Docker Compose (Recommended)

The easiest path. A single command starts ScreenForge, PostgreSQL, and Redis with persistent volumes.

### 1. Clone the repository

```bash
git clone https://github.com/hodlthedoor/screenforge.git
cd screenforge
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set the required secrets:

```bash
# Generate secure values for these two required fields:
openssl rand -hex 32   # -> API_KEY_SALT
openssl rand -hex 32   # -> SESSION_SECRET
```

### 3. Start all services

```bash
docker compose up -d
```

### 4. Verify

```bash
curl http://localhost:3100/health
# {"status":"ok"}
```

The dashboard is at `http://localhost:3100/dashboard` and Swagger docs at `http://localhost:3100/docs`.

### Upgrading

```bash
docker compose pull && docker compose up -d
```

### With monitoring (Prometheus + Grafana)

```bash
docker compose --profile monitoring up -d
```

- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000` (default: admin / admin)

---

## Option 2: Bare Metal

Use this if you want to run ScreenForge directly on a Node.js host with existing PostgreSQL and Redis instances.

### Prerequisites

- Node.js 22+
- PostgreSQL 16+ (database and user with CREATEDB or pre-created database)
- Redis 7+

### 1. Clone and install dependencies

```bash
git clone https://github.com/hodlthedoor/screenforge.git
cd screenforge
npm install --include=dev
```

### 2. Install Playwright browsers

```bash
npx playwright install chromium
```

### 3. Create the database and run migrations

```bash
# Create the database (using peer auth on Linux):
createdb screenforge

# Run all migrations in order:
for f in sql/*.sql; do psql screenforge < "$f"; done
```

### 4. Configure environment

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL, API_KEY_SALT, SESSION_SECRET at minimum
```

For PostgreSQL peer auth (Linux):

```bash
DATABASE_URL=postgresql:///screenforge?host=/var/run/postgresql
```

For PostgreSQL with password:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/screenforge
```

### 5. Build and start

```bash
npm run build
npm start
```

### Production with pm2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # enable on boot
```

---

## SSL Setup

### Let's Encrypt (public domain)

```bash
# 1. Install certbot
sudo apt install certbot python3-certbot-nginx

# 2. Update nginx config with your domain
sed -i 's/screenforge.local/yourdomain.com/g' nginx-screenforge.conf

# 3. Deploy nginx config
sudo bash deploy-nginx.sh

# 4. Obtain certificate
sudo certbot --nginx -d yourdomain.com

# 5. Update BASE_URL
sed -i 's|https://screenforge.local|https://yourdomain.com|' .env
sed -i 's|https://screenforge.local|https://yourdomain.com|' ecosystem.config.cjs

# 6. Reload
sudo systemctl reload nginx
pm2 restart screenforge
```

### Self-signed (internal / development)

```bash
sudo bash deploy-nginx.sh
echo "YOUR_SERVER_IP screenforge.local" | sudo tee -a /etc/hosts
sudo nginx -t && sudo systemctl reload nginx
```

Access at `https://screenforge.local` (browser will warn about self-signed cert — this is expected).

The nginx config includes:

- HTTP → HTTPS redirect (301)
- Rate limiting (10 req/s per IP, burst 20)
- Security headers (HSTS, X-Frame-Options)
- Gzip compression
- 120s proxy timeout for long renders

---

## Environment Variable Reference

All configuration is done via environment variables. Copy `.env.example` to `.env` as a starting point.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3100` | Server port |
| `BASE_URL` | No | `http://localhost:3100` | Public base URL (used in async poll URLs) |
| `NODE_ENV` | No | `production` | Environment (`development`, `production`, `test`) |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `REDIS_URL` | No | `redis://redis:6379/0` | Redis connection string |
| `API_KEY_SALT` | **Yes** | — | Salt for API key hashing (min 16 chars) |
| `SESSION_SECRET` | **Yes** | — | Session cookie secret (min 32 chars) |
| `ADMIN_API_KEY` | No | — | Admin API key for `/v1/keys` management |
| `REQUIRE_AUTH` | No | `false` | Require API key on render endpoints |
| `ALLOW_PRIVATE_URLS` | No | `false` | Allow rendering private/internal URLs (SSRF risk) |
| `STORAGE_PATH` | No | `./storage` | Directory for rendered files |
| `BROWSER_POOL_SIZE` | No | `3` | Number of Playwright browser instances (1–20) |
| `MAX_RENDERS_PER_CONTEXT` | No | `100` | Recycle browser context after N renders |
| `CACHE_TTL_SECONDS` | No | `3600` | Cache duration in seconds (0 = disabled) |
| `NAVIGATION_TIMEOUT_MS` | No | `30000` | Page navigation timeout in milliseconds |
| `MAX_CONTENT_SIZE_MB` | No | `50` | Max request body size in MB |
| `METRICS_ENABLED` | No | `true` | Enable Prometheus `/metrics` endpoint |
| `STRIPE_SECRET_KEY` | No | — | Stripe secret key (enables billing) |
| `STRIPE_PUBLISHABLE_KEY` | No | — | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | No | — | Stripe webhook signing secret |
| `SMTP_HOST` | No | — | SMTP server hostname (enables email) |
| `SMTP_PORT` | No | `587` | SMTP port (587 for STARTTLS, 465 for SSL) |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password or API key |
| `SMTP_FROM` | No | `noreply@screenforge.dev` | From address for outgoing emails |

Generate secure secrets with:

```bash
openssl rand -hex 32
```

---

## Disabling Optional Features

ScreenForge works without billing or email — these are opt-in:

- **Billing**: omit all `STRIPE_*` variables
- **Email**: omit all `SMTP_*` variables
- **Metrics**: set `METRICS_ENABLED=false`
- **Auth**: leave `REQUIRE_AUTH=false` for open access (not recommended for public deployments)

---

## Troubleshooting

### Health check failing

```bash
curl http://localhost:3100/health
# Should return {"status":"ok","db":"ok","redis":"ok","browser":"ok","queue":"ok"}
```

Check component status — any `"error"` in the health response indicates a configuration issue.

### Database connection errors

- Docker: use `postgresql://screenforge:screenforge@postgres:5432/screenforge`
- Bare metal with peer auth: `postgresql:///screenforge?host=/var/run/postgresql`
- Bare metal with password: `postgresql://user:password@localhost:5432/screenforge`

### Browser pool issues

```bash
# Reinstall Playwright browsers
npx playwright install chromium
```

### Port already in use

Change `PORT` in `.env` and update nginx upstream if applicable.

---

## Security Recommendations for Production

- Set `REQUIRE_AUTH=true` to require API keys on all render endpoints
- Keep `ALLOW_PRIVATE_URLS=false` (default) to prevent SSRF attacks
- Use a strong `API_KEY_SALT` and `SESSION_SECRET` (32+ random bytes)
- Put ScreenForge behind nginx with SSL (see [SSL Setup](#ssl-setup) above)
- Restrict the `/metrics` endpoint to internal networks only
- Rotate API keys regularly via the dashboard
