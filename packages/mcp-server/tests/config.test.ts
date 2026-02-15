import { describe, expect, it } from 'vitest';

import { loadConfigFromEnv } from '../src/config';

describe('loadConfigFromEnv', () => {
  it('requires SCREENFORGE_API_KEY', () => {
    expect(() => loadConfigFromEnv({})).toThrow(/SCREENFORGE_API_KEY/);
  });

  it('uses default API URL and inline limit', () => {
    const config = loadConfigFromEnv({ SCREENFORGE_API_KEY: 'sk_test' });

    expect(config.apiUrl).toBe('http://localhost:3100');
    expect(config.inlineDataLimitBytes).toBe(524288);
    expect(config.extractLlmApiKey).toBeUndefined();
  });

  it('parses custom values', () => {
    const config = loadConfigFromEnv({
      SCREENFORGE_API_KEY: 'sk_test',
      SCREENFORGE_API_URL: 'https://api.example.com/',
      SCREENFORGE_MCP_INLINE_LIMIT_BYTES: '1024',
      SCREENFORGE_MCP_ARTIFACT_DIR: '/tmp/sf-artifacts',
      SCREENFORGE_MCP_EXTRACT_LLM_API_KEY: 'sk-ant-test',
    });

    expect(config.apiUrl).toBe('https://api.example.com');
    expect(config.inlineDataLimitBytes).toBe(1024);
    expect(config.artifactDir).toBe('/tmp/sf-artifacts');
    expect(config.extractLlmApiKey).toBe('sk-ant-test');
  });
});
