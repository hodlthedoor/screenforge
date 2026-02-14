# Contributing to ScreenForge

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Development Setup

### Prerequisites

- Node.js 22+
- PostgreSQL 16+
- Redis 7+

### Getting Started

```bash
# Clone and install
git clone https://github.com/hodlthedoor/atlas-project.git
cd atlas-project/screenforge
npm install --include=dev

# Install Playwright browsers
npx playwright install chromium

# Create databases
createdb screenforge
createdb screenforge_test

# Run migrations
for f in sql/*.sql; do psql screenforge < "$f"; done
for f in sql/*.sql; do psql screenforge_test < "$f"; done

# Configure environment
cp .env.example .env
# Edit .env — at minimum set:
#   DATABASE_URL=postgresql:///screenforge?host=/var/run/postgresql
#   API_KEY_SALT=<openssl rand -hex 32>
#   SESSION_SECRET=<openssl rand -hex 32>

# Start dev server (hot reload)
npm run dev
```

The API runs at `http://localhost:3100`. Swagger docs are at `/docs`.

## Project Structure

```
src/
  index.ts          # App entry point, plugin registration
  config.ts         # Environment variable parsing (Zod)
  routes/           # Fastify route handlers (one file per domain)
  services/         # Business logic (browser pool, cache, queue)
  docs/             # Swagger/OpenAPI setup
  middleware/        # Auth, rate limiting, SSRF protection
sdk/js/             # JavaScript/TypeScript SDK
sql/                # Database migrations (applied in order)
tests/              # Vitest test suites
```

## Coding Standards

- **TypeScript strict mode** — no `any`, no `unknown` casts
- **Single responsibility** — one concern per file/function
- **Zod validation** — all external input validated with Zod schemas
- **Small files** — keep files focused and under ~300 lines
- **No unnecessary comments** — code should be self-documenting

## Testing

We use **Vitest** and follow **TDD** (test-driven development):

1. Write a failing test for the behavior you want
2. Implement the minimum code to make it pass
3. Refactor if needed

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run tests/screenshot.test.ts

# Run tests in watch mode
npx vitest

# Type check
npm run typecheck

# Lint
npm run lint
```

Tests require a `screenforge_test` database with all migrations applied.

## Database Migrations

Migrations are plain SQL files in `sql/`, numbered sequentially:

```
sql/001_init.sql
sql/002_auth_queue.sql
...
sql/010_analytics.sql
```

To add a migration:

1. Find the next number: `ls sql/`
2. Create `sql/NNN_description.sql`
3. Write idempotent SQL (`CREATE TABLE IF NOT EXISTS`, etc.)
4. Apply to both databases:
   ```bash
   psql screenforge < sql/NNN_description.sql
   psql screenforge_test < sql/NNN_description.sql
   ```

## Making Changes

### Branch Naming

Use descriptive branch names with a prefix:

- `feat/signed-url-caching`
- `fix/rate-limit-overflow`
- `refactor/browser-pool-cleanup`

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add webhook retry with exponential backoff
fix: prevent SSRF bypass via DNS rebinding
refactor: extract browser pool into standalone service
test: add coverage for batch rendering edge cases
docs: update API reference with analytics endpoint
```

### Pull Request Process

1. Fork the repository
2. Create a feature branch from `main`
3. Write tests first, then implement
4. Ensure all checks pass:
   ```bash
   npm test && npm run lint && npm run typecheck && npm run build
   ```
5. Push your branch and open a PR against `main`
6. Describe what changed and why in the PR description
7. Link any related issues

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
