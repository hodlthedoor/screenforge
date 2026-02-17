/**
 * Tests for developer tooling artifact generation.
 *
 * These tests run the generate scripts in-process (using buildServer directly)
 * and verify the generated artifacts are structurally correct.
 *
 * In CI: run `npm run generate` before `npm test` to catch spec drift.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../src/index.js';
import type { FastifyInstance } from 'fastify';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('Developer tooling — OpenAPI spec', () => {
  let app: FastifyInstance;
  let spec: Record<string, unknown>;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    app = await buildServer({ skipBrowserInit: true });
    await app.ready();
    spec = app.swagger() as Record<string, unknown>;
  });

  afterAll(async () => {
    await app.close();
  });

  it('spec is valid OpenAPI 3.x', () => {
    expect((spec.openapi as string)).toMatch(/^3\./);
    expect(spec.info).toBeDefined();
    expect((spec.info as Record<string, string>).title).toBe('ScreenForge API');
    expect(spec.paths).toBeDefined();
  });

  it('spec has at least 40 paths', () => {
    const paths = spec.paths as Record<string, unknown>;
    expect(Object.keys(paths).length).toBeGreaterThanOrEqual(40);
  });

  it('spec includes core render endpoints', () => {
    const paths = spec.paths as Record<string, unknown>;
    const required = ['/v1/screenshot', '/v1/pdf', '/v1/og', '/v1/batch', '/v1/health'];
    for (const path of required) {
      expect(Object.keys(paths), `Missing path: ${path}`).toContain(path);
    }
  });

  it('all v1 paths have at least one operation with a response schema', () => {
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    for (const [path, methods] of Object.entries(paths)) {
      if (!path.startsWith('/v1/')) continue;
      for (const [method, operation] of Object.entries(methods)) {
        if (method === 'parameters') continue;
        const op = operation as { responses?: Record<string, unknown> };
        expect(op.responses, `${method.toUpperCase()} ${path} missing responses`).toBeDefined();
      }
    }
  });

  it('security schemes are defined (apiKey + bearer)', () => {
    const components = spec.components as Record<string, unknown> | undefined;
    const schemes = (components?.securitySchemes ?? {}) as Record<string, unknown>;
    expect(Object.keys(schemes)).toContain('apiKey');
    expect(Object.keys(schemes)).toContain('bearer');
  });

  it('has all required API tags', () => {
    const tags = (spec.tags as Array<{ name: string }>)?.map((t) => t.name) ?? [];
    const required = ['render', 'async', 'batch', 'og', 'admin', 'usage', 'health', 'signed', 'billing', 'webhooks', 'auth'];
    for (const tag of required) {
      expect(tags, `Missing tag: ${tag}`).toContain(tag);
    }
  });
});

describe('Developer tooling — Postman collection generation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    app = await buildServer({ skipBrowserInit: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('can convert OpenAPI spec to a valid Postman collection', async () => {
    const spec = app.swagger();
    const specStr = JSON.stringify(spec);

    const { convert } = require('openapi-to-postmanv2') as {
      convert: (
        input: { type: 'string'; data: string },
        options: Record<string, unknown>,
        cb: (err: Error | null, result: { result: boolean; output: Array<{ type: string; data: unknown }>; reason?: string }) => void,
      ) => void;
    };

    const result = await new Promise<{ result: boolean; output: Array<{ type: string; data: unknown }>; reason?: string }>(
      (resolve, reject) =>
        convert(
          { type: 'string', data: specStr },
          { folderStrategy: 'Tags', collectionName: 'ScreenForge API' },
          (err, r) => (err ? reject(err) : resolve(r)),
        ),
    );

    expect(result.result, result.reason ?? 'Conversion failed').toBe(true);
    expect(result.output).toHaveLength(1);
    expect(result.output[0].type).toBe('collection');

    const collection = result.output[0].data as Record<string, unknown>;
    expect(collection.info).toBeDefined();
    expect((collection.info as Record<string, string>).name).toBe('ScreenForge API');
    expect(collection.item).toBeDefined();

    // The collection must have at least as many folders as we have API tag groups
    const items = collection.item as unknown[];
    expect(items.length).toBeGreaterThanOrEqual(10);
  });

  it('collection info has correct schema', async () => {
    const spec = app.swagger();
    const { convert } = require('openapi-to-postmanv2') as {
      convert: (
        input: { type: 'string'; data: string },
        options: Record<string, unknown>,
        cb: (err: Error | null, result: { result: boolean; output: Array<{ type: string; data: unknown }> }) => void,
      ) => void;
    };

    const result = await new Promise<{ result: boolean; output: Array<{ type: string; data: unknown }> }>(
      (resolve, reject) =>
        convert(
          { type: 'string', data: JSON.stringify(spec) },
          { folderStrategy: 'Tags' },
          (err, r) => (err ? reject(err) : resolve(r)),
        ),
    );

    const collection = result.output[0].data as Record<string, unknown>;
    const info = collection.info as Record<string, unknown>;

    // Postman collection v2.1 schema URL
    expect(info.schema as string).toContain('schema.getpostman.com');
    // Must have a unique ID
    expect(info._postman_id ?? info.id).toBeTruthy();
  });
});

describe('Developer tooling — generate scripts smoke tests', () => {
  /**
   * These tests verify the generate scripts can run against a live server.
   * They test script logic without actually writing to disk (using in-process conversion).
   */

  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    app = await buildServer({ skipBrowserInit: true });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('swagger() returns JSON-serializable spec', () => {
    const spec = app.swagger();
    expect(() => JSON.stringify(spec)).not.toThrow();
    const roundtripped = JSON.parse(JSON.stringify(spec));
    expect(roundtripped.openapi).toBeDefined();
  });

  it('spec YAML-serializable (js-yaml can dump it)', async () => {
    const yaml = await import('js-yaml');
    const spec = app.swagger();
    expect(() => yaml.dump(spec, { lineWidth: 120 })).not.toThrow();
  });
});
