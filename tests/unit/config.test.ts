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

  it('defaults GRACEFUL_SHUTDOWN_TIMEOUT_MS to 30000', () => {
    const config = loadConfig(validEnv);
    expect(config.GRACEFUL_SHUTDOWN_TIMEOUT_MS).toBe(30_000);
  });

  it('accepts custom GRACEFUL_SHUTDOWN_TIMEOUT_MS', () => {
    const config = loadConfig({ ...validEnv, GRACEFUL_SHUTDOWN_TIMEOUT_MS: '60000' });
    expect(config.GRACEFUL_SHUTDOWN_TIMEOUT_MS).toBe(60_000);
  });

  it('rejects GRACEFUL_SHUTDOWN_TIMEOUT_MS less than 1000', () => {
    expect(() =>
      loadConfig({ ...validEnv, GRACEFUL_SHUTDOWN_TIMEOUT_MS: '500' }),
    ).toThrow('Invalid environment configuration');
  });

  it('defaults RENDER_TIMEOUT_MS to 30000', () => {
    const config = loadConfig(validEnv);
    expect(config.RENDER_TIMEOUT_MS).toBe(30_000);
  });

  it('accepts custom RENDER_TIMEOUT_MS', () => {
    const config = loadConfig({ ...validEnv, RENDER_TIMEOUT_MS: '45000' });
    expect(config.RENDER_TIMEOUT_MS).toBe(45_000);
  });

  it('rejects RENDER_TIMEOUT_MS less than 1000', () => {
    expect(() =>
      loadConfig({ ...validEnv, RENDER_TIMEOUT_MS: '500' }),
    ).toThrow('Invalid environment configuration');
  });

  it('rejects RENDER_TIMEOUT_MS greater than 120000', () => {
    expect(() =>
      loadConfig({ ...validEnv, RENDER_TIMEOUT_MS: '150000' }),
    ).toThrow('Invalid environment configuration');
  });

  it('defaults CIRCUIT_BREAKER_THRESHOLD to 3', () => {
    const config = loadConfig(validEnv);
    expect(config.CIRCUIT_BREAKER_THRESHOLD).toBe(3);
  });

  it('accepts custom CIRCUIT_BREAKER_THRESHOLD', () => {
    const config = loadConfig({ ...validEnv, CIRCUIT_BREAKER_THRESHOLD: '5' });
    expect(config.CIRCUIT_BREAKER_THRESHOLD).toBe(5);
  });

  it('rejects CIRCUIT_BREAKER_THRESHOLD less than 1', () => {
    expect(() =>
      loadConfig({ ...validEnv, CIRCUIT_BREAKER_THRESHOLD: '0' }),
    ).toThrow('Invalid environment configuration');
  });

  describe('proxy configuration', () => {
    it('accepts valid HTTP proxy server', () => {
      const config = loadConfig({
        ...validEnv,
        PROXY_SERVER: 'http://proxy.example.com:8080',
      });
      expect(config.PROXY_SERVER).toBe('http://proxy.example.com:8080');
    });

    it('accepts valid HTTPS proxy server', () => {
      const config = loadConfig({
        ...validEnv,
        PROXY_SERVER: 'https://proxy.example.com:443',
      });
      expect(config.PROXY_SERVER).toBe('https://proxy.example.com:443');
    });

    it('accepts valid SOCKS5 proxy server', () => {
      const config = loadConfig({
        ...validEnv,
        PROXY_SERVER: 'socks5://proxy.example.com:1080',
      });
      expect(config.PROXY_SERVER).toBe('socks5://proxy.example.com:1080');
    });

    it('accepts proxy with username and password', () => {
      const config = loadConfig({
        ...validEnv,
        PROXY_SERVER: 'http://proxy.example.com:8080',
        PROXY_USERNAME: 'proxyuser',
        PROXY_PASSWORD: 'proxypass',
      });
      expect(config.PROXY_SERVER).toBe('http://proxy.example.com:8080');
      expect(config.PROXY_USERNAME).toBe('proxyuser');
      expect(config.PROXY_PASSWORD).toBe('proxypass');
    });

    it('accepts no proxy (optional)', () => {
      const config = loadConfig(validEnv);
      expect(config.PROXY_SERVER).toBeUndefined();
      expect(config.PROXY_USERNAME).toBeUndefined();
      expect(config.PROXY_PASSWORD).toBeUndefined();
    });

    it('rejects invalid proxy protocol', () => {
      expect(() =>
        loadConfig({ ...validEnv, PROXY_SERVER: 'ftp://proxy.example.com:21' }),
      ).toThrow('Invalid environment configuration');
    });

    it('rejects proxy without protocol', () => {
      expect(() =>
        loadConfig({ ...validEnv, PROXY_SERVER: 'proxy.example.com:8080' }),
      ).toThrow('Invalid environment configuration');
    });
  });
});
