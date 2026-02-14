import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/index.js';

describe('config', () => {
  const validEnv = {
    PORT: '3100',
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    DATABASE_URL: 'postgresql:///screenforge?host=/var/run/postgresql',
    STORAGE_PATH: './storage',
    API_KEY_SALT: 'test-salt-must-be-16-chars-long',
    NODE_ENV: 'test',
  };

  it('loads valid config', () => {
    const config = loadConfig(validEnv);
    expect(config.PORT).toBe(3100);
    expect(config.REDIS_URL).toBe('redis://127.0.0.1:6379/0');
    expect(config.DATABASE_URL).toBe('postgresql:///screenforge?host=/var/run/postgresql');
    expect(config.STORAGE_PATH).toBe('./storage');
    expect(config.API_KEY_SALT).toBe('test-salt-must-be-16-chars-long');
    expect(config.NODE_ENV).toBe('test');
  });

  it('uses defaults for optional values', () => {
    const config = loadConfig({
      API_KEY_SALT: 'test-salt-must-be-16-chars-long',
    });
    expect(config.PORT).toBe(3100);
    expect(config.REDIS_URL).toBe('redis://127.0.0.1:6379/0');
    expect(config.NODE_ENV).toBe('development');
  });

  it('rejects missing API_KEY_SALT', () => {
    expect(() => loadConfig({})).toThrow('Invalid environment configuration');
  });

  it('rejects API_KEY_SALT shorter than 16 chars', () => {
    expect(() => loadConfig({ API_KEY_SALT: 'short' })).toThrow('Invalid environment configuration');
  });

  it('rejects invalid PORT', () => {
    expect(() =>
      loadConfig({ ...validEnv, PORT: '99999' }),
    ).toThrow('Invalid environment configuration');
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() =>
      loadConfig({ ...validEnv, NODE_ENV: 'staging' }),
    ).toThrow('Invalid environment configuration');
  });

  it('coerces PORT from string to number', () => {
    const config = loadConfig({ ...validEnv, PORT: '8080' });
    expect(config.PORT).toBe(8080);
    expect(typeof config.PORT).toBe('number');
  });

  it('defaults STORAGE_RETENTION_DAYS to 7', () => {
    const config = loadConfig(validEnv);
    expect(config.STORAGE_RETENTION_DAYS).toBe(7);
  });

  it('accepts custom STORAGE_RETENTION_DAYS', () => {
    const config = loadConfig({ ...validEnv, STORAGE_RETENTION_DAYS: '14' });
    expect(config.STORAGE_RETENTION_DAYS).toBe(14);
  });

  it('rejects STORAGE_RETENTION_DAYS less than 1', () => {
    expect(() =>
      loadConfig({ ...validEnv, STORAGE_RETENTION_DAYS: '0' }),
    ).toThrow('Invalid environment configuration');
  });
});
