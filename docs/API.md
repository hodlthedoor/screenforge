# ScreenForge API — Developer Resources

## Interactive Documentation

| Resource | URL |
|---|---|
| Swagger UI | `http://your-server:3000/docs/swagger` |
| API docs site | `http://your-server:3000/docs` |

## OpenAPI Spec

Download the machine-readable OpenAPI 3.0 spec:

| Format | Path |
|---|---|
| JSON | `docs/openapi.json` (generated) |
| YAML | `docs/openapi.yaml` (generated) |

Generate or refresh:

```sh
npm run generate:openapi
```

The spec is also served live by the running server at `/docs/swagger/json` and `/docs/swagger/yaml`.

## Postman Collection

Import the pre-built collection into Postman for instant API testing.

**Files:**
- `docs/postman-collection.json` — the collection
- `docs/postman-environment.json` — environment variables (`baseUrl`, `apiKey`)

**To import:**
1. Open Postman → **Import**
2. Select `docs/postman-collection.json`
3. Import `docs/postman-environment.json` as an Environment
4. Set the `apiKey` environment variable to your `sf_live_*` or `sf_test_*` key
5. Set `baseUrl` to your server URL (default: `http://localhost:3000`)

**Generate/refresh:**

```sh
npm run generate:openapi   # must run first
npm run generate:postman
```

Or run both at once:

```sh
npm run generate
```

## TypeScript SDK Types

Auto-generated TypeScript types are in `packages/sdk-generated/types.d.ts`.

```sh
npm run generate:openapi   # must run first
npm run generate:sdk
```

The generated types can be used with [`openapi-fetch`](https://openapi-ts.pages.dev/openapi-fetch/):

```ts
import createClient from 'openapi-fetch';
import type { paths } from '../packages/sdk-generated/types.js';

const client = createClient<paths>({ baseUrl: 'http://localhost:3000' });

const { data, error } = await client.POST('/v1/screenshot', {
  headers: { 'x-api-key': 'sf_live_...' },
  body: { url: 'https://example.com' },
});
```

For a full SDK with helper methods and response unwrapping, see `sdk/js/`.

## SDK Packages

| Package | Install |
|---|---|
| JavaScript/TypeScript | `npm install @screenforge/sdk` |
| Python | `pip install screenforge` |
| CLI | `npm install -g @screenforge/cli` |

## Generating All Artifacts

Run all generators in sequence:

```sh
npm run generate
# Equivalent to:
# npm run generate:openapi && npm run generate:postman && npm run generate:sdk
```

Generated files are excluded from git (`.gitignore`). Regenerate them after pulling changes or when the API spec changes.
