/**
 * ScreenForge Load Test Benchmark
 *
 * Runs three scenarios against a live ScreenForge instance:
 *   1. GET /health — non-render throughput baseline
 *   2. POST /v1/screenshot — render latency at varying concurrency
 *   3. POST /v1/batch — batch throughput
 *
 * Usage:
 *   npx tsx tests/load/benchmark.ts [--base-url http://localhost:3101]
 *
 * The script creates a temporary "business" API key (unlimited quota),
 * runs all scenarios, and prints a summary table.
 */

import autocannon from 'autocannon';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.argv.find((a) => a.startsWith('--base-url='))?.split('=')[1]
  ?? process.argv[process.argv.indexOf('--base-url') + 1]
  ?? 'http://localhost:3101';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql:///screenforge?host=/var/run/postgresql';
const API_KEY_SALT = process.env.API_KEY_SALT ?? 'bde3b834698b951ddb605ba70c2039df4e317a1ad8468a6e076645921edb83d9';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ScenarioResult {
  title: string;
  requests: number;
  throughput: number;
  errors: number;
  timeouts: number;
  p50: number;
  p97_5: number;
  p99: number;
  duration: number;
  non2xx: number;
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw + API_KEY_SALT).digest('hex');
}

async function createTestApiKey(pool: pg.Pool): Promise<string> {
  const raw = 'sf_live_' + randomBytes(24).toString('base64url');
  const keyHash = hashKey(raw);
  const signingSecret = randomBytes(32).toString('hex');

  await pool.query(
    `INSERT INTO api_keys (key_hash, prefix, name, tier, rate_limit, monthly_quota, signing_secret)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [keyHash, 'sf_live_', 'load-test-key', 'business', 999999, 999999999, signingSecret],
  );
  return raw;
}

async function deleteTestApiKey(pool: pg.Pool, rawKey: string): Promise<void> {
  const keyHash = hashKey(rawKey);
  // Clean up usage, render_jobs, batch_jobs, webhook_deliveries via cascade
  await pool.query(`DELETE FROM api_keys WHERE key_hash = $1`, [keyHash]);
}

function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function printResults(results: ScenarioResult[]): void {
  console.log('\n' + '='.repeat(100));
  console.log('SCREENFORGE LOAD TEST RESULTS');
  console.log('='.repeat(100));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('='.repeat(100));

  const header = [
    'Scenario'.padEnd(40),
    'Reqs'.padStart(8),
    'RPS'.padStart(8),
    'Errors'.padStart(8),
    'p50'.padStart(10),
    'p97.5'.padStart(10),
    'p99'.padStart(10),
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(100));

  for (const r of results) {
    const row = [
      r.title.padEnd(40),
      String(r.requests).padStart(8),
      r.throughput.toFixed(1).padStart(8),
      String(r.errors + r.timeouts + r.non2xx).padStart(8),
      formatLatency(r.p50).padStart(10),
      formatLatency(r.p97_5).padStart(10),
      formatLatency(r.p99).padStart(10),
    ].join(' | ');
    console.log(row);
  }

  console.log('='.repeat(100));
}

async function runScenario(opts: autocannon.Options & { title: string }): Promise<ScenarioResult> {
  const { title, ...autocannonOpts } = opts;
  console.log(`\n>>> Running: ${title} ...`);

  const result = await autocannon({
    ...autocannonOpts,
    url: autocannonOpts.url ?? BASE_URL,
  });

  const sr: ScenarioResult = {
    title,
    requests: result.requests.total,
    throughput: result.requests.average,
    errors: result.errors,
    timeouts: result.timeouts,
    p50: result.latency.p50,
    p97_5: (result.latency as Record<string, number>)['p97_5'] ?? result.latency.p99,
    p99: result.latency.p99,
    duration: result.duration,
    non2xx: result.non2xx,
  };

  console.log(`    Completed: ${sr.requests} reqs, ${sr.throughput.toFixed(1)} rps, ` +
    `p50=${formatLatency(sr.p50)}, p99=${formatLatency(sr.p99)}, errors=${sr.errors + sr.timeouts + sr.non2xx}`);

  return sr;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioHealth(): Promise<ScenarioResult> {
  return runScenario({
    title: 'GET /health (baseline, 100 connections)',
    url: `${BASE_URL}/health`,
    connections: 100,
    duration: 10,
    pipelining: 10,
  });
}

async function scenarioScreenshot(apiKey: string, connections: number): Promise<ScenarioResult> {
  return runScenario({
    title: `POST /v1/screenshot (${connections} concurrent)`,
    url: `${BASE_URL}/v1/screenshot`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ url: 'https://example.com', options: { width: 1280, height: 720 } }),
    connections,
    duration: 30,
  });
}

async function scenarioBatch(apiKey: string): Promise<ScenarioResult> {
  const items = Array.from({ length: 10 }, (_, i) => ({
    type: 'screenshot' as const,
    url: `https://example.com/?p=${i}`,
  }));

  return runScenario({
    title: 'POST /v1/batch (10 URLs, 5 concurrent)',
    url: `${BASE_URL}/v1/batch`,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ items }),
    connections: 5,
    duration: 30,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('ScreenForge Load Test');
  console.log(`Target: ${BASE_URL}`);

  // Verify server is up
  const healthResp = await fetch(`${BASE_URL}/health`);
  if (!healthResp.ok) {
    console.error(`Server not reachable at ${BASE_URL}/health (status: ${healthResp.status})`);
    process.exit(1);
  }
  console.log('Server is up.');

  // Create DB connection and test API key
  const pool = new pg.Pool({ connectionString: DB_URL, max: 2 });
  const apiKey = await createTestApiKey(pool);
  console.log(`Created test API key: ${apiKey.slice(0, 12)}...`);

  const allResults: ScenarioResult[] = [];

  try {
    // Scenario 1: Health endpoint baseline
    allResults.push(await scenarioHealth());

    // Scenario 2: Screenshot at 5, 10, 20 concurrent connections
    for (const conns of [5, 10, 20]) {
      allResults.push(await scenarioScreenshot(apiKey, conns));
    }

    // Scenario 3: Batch endpoint
    allResults.push(await scenarioBatch(apiKey));

    // Print summary
    printResults(allResults);

    // Output JSON for programmatic use
    const jsonPath = 'tests/load/results.json';
    const { writeFileSync } = await import('node:fs');
    writeFileSync(jsonPath, JSON.stringify({
      baseUrl: BASE_URL,
      timestamp: new Date().toISOString(),
      scenarios: allResults,
    }, null, 2));
    console.log(`\nDetailed results written to ${jsonPath}`);

  } finally {
    // Cleanup
    await deleteTestApiKey(pool, apiKey);
    await pool.end();
    console.log('Test API key cleaned up.');
  }
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
