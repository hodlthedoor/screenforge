import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveConfig, loadConfigFile } from '../src/config.js';

describe('loadConfigFile', () => {
  const tmpPath = join(tmpdir(), `screenforge-test-${Date.now()}.json`);

  afterEach(async () => {
    try { await unlink(tmpPath); } catch { /* ignore */ }
  });

  it('returns empty object for missing file', async () => {
    const result = await loadConfigFile('/nonexistent/path.json');
    expect(result).toEqual({});
  });

  it('parses valid JSON config file', async () => {
    await writeFile(tmpPath, JSON.stringify({
      server: 'https://api.example.com',
      apiKey: 'sk_test_123',
      defaults: { width: 1920, height: 1080 },
    }));

    const result = await loadConfigFile(tmpPath);
    expect(result.server).toBe('https://api.example.com');
    expect(result.apiKey).toBe('sk_test_123');
    expect(result.defaults?.width).toBe(1920);
  });

  it('returns empty object for invalid JSON', async () => {
    await writeFile(tmpPath, 'not json');
    const result = await loadConfigFile(tmpPath);
    expect(result).toEqual({});
  });
});

describe('resolveConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses CLI flags with highest priority', async () => {
    process.env['SCREENFORGE_API_KEY'] = 'env_key';
    process.env['SCREENFORGE_SERVER'] = 'http://env-server';

    const config = await resolveConfig({
      apiKey: 'cli_key',
      server: 'http://cli-server',
      configFilePath: '/nonexistent',
    });

    expect(config.apiKey).toBe('cli_key');
    expect(config.server).toBe('http://cli-server');
  });

  it('falls back to env vars when no CLI flags', async () => {
    process.env['SCREENFORGE_API_KEY'] = 'env_key';
    process.env['SCREENFORGE_SERVER'] = 'http://env-server';

    const config = await resolveConfig({
      configFilePath: '/nonexistent',
    });

    expect(config.apiKey).toBe('env_key');
    expect(config.server).toBe('http://env-server');
  });

  it('falls back to config file values', async () => {
    delete process.env['SCREENFORGE_API_KEY'];
    delete process.env['SCREENFORGE_SERVER'];

    const tmpPath = join(tmpdir(), `screenforge-resolve-${Date.now()}.json`);
    await writeFile(tmpPath, JSON.stringify({
      apiKey: 'file_key',
      server: 'http://file-server',
    }));

    try {
      const config = await resolveConfig({ configFilePath: tmpPath });
      expect(config.apiKey).toBe('file_key');
      expect(config.server).toBe('http://file-server');
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  });

  it('uses default server when nothing specified', async () => {
    delete process.env['SCREENFORGE_API_KEY'];
    delete process.env['SCREENFORGE_SERVER'];

    const config = await resolveConfig({ configFilePath: '/nonexistent' });
    expect(config.server).toBe('http://localhost:3000');
    expect(config.apiKey).toBe('');
  });

  it('strips trailing slash from server URL', async () => {
    const config = await resolveConfig({
      server: 'http://example.com/',
      configFilePath: '/nonexistent',
    });
    expect(config.server).toBe('http://example.com');
  });
});
