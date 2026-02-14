import { describe, it, expect } from 'vitest';
import { sanitizeHeaders, sanitizeCookies, SanitizeError } from '../../src/security/sanitize.js';

describe('sanitizeHeaders', () => {
  it('allows valid custom headers', () => {
    const headers = { 'Authorization': 'Bearer token', 'X-Custom': 'value' };
    const result = sanitizeHeaders(headers);
    expect(result).toEqual(headers);
  });

  it('rejects Host header (case-insensitive)', () => {
    expect(() => sanitizeHeaders({ 'Host': 'evil.com' })).toThrow(SanitizeError);
    expect(() => sanitizeHeaders({ 'host': 'evil.com' })).toThrow(SanitizeError);
    expect(() => sanitizeHeaders({ 'HOST': 'evil.com' })).toThrow(SanitizeError);
    expect(() => sanitizeHeaders({ 'HoSt': 'evil.com' })).toThrow(SanitizeError);
  });

  it('rejects Content-Length header (case-insensitive)', () => {
    expect(() => sanitizeHeaders({ 'Content-Length': '100' })).toThrow(SanitizeError);
    expect(() => sanitizeHeaders({ 'content-length': '100' })).toThrow(SanitizeError);
    expect(() => sanitizeHeaders({ 'CONTENT-LENGTH': '100' })).toThrow(SanitizeError);
  });

  it('rejects Transfer-Encoding header (case-insensitive)', () => {
    expect(() => sanitizeHeaders({ 'Transfer-Encoding': 'chunked' })).toThrow(SanitizeError);
    expect(() => sanitizeHeaders({ 'transfer-encoding': 'chunked' })).toThrow(SanitizeError);
    expect(() => sanitizeHeaders({ 'TRANSFER-ENCODING': 'chunked' })).toThrow(SanitizeError);
  });

  it('allows undefined headers', () => {
    const result = sanitizeHeaders(undefined);
    expect(result).toBeUndefined();
  });

  it('rejects headers with non-string values', () => {
    expect(() => sanitizeHeaders({ 'X-Custom': 123 as unknown as string } as Record<string, string>)).toThrow(SanitizeError);
  });

  it('rejects excessively long header values', () => {
    const longValue = 'x'.repeat(10001);
    expect(() => sanitizeHeaders({ 'X-Custom': longValue })).toThrow(SanitizeError);
  });
});

describe('sanitizeCookies', () => {
  it('allows valid cookies', () => {
    const cookies = [
      { name: 'session', value: 'abc123', domain: '.example.com', path: '/' },
      { name: 'pref', value: 'dark' },
    ];
    const result = sanitizeCookies(cookies);
    expect(result).toEqual(cookies);
  });

  it('allows undefined cookies', () => {
    const result = sanitizeCookies(undefined);
    expect(result).toBeUndefined();
  });

  it('rejects cookies missing name', () => {
    expect(() => sanitizeCookies([{ value: 'test' } as { name: string; value: string }])).toThrow(SanitizeError);
  });

  it('rejects cookies missing value', () => {
    expect(() => sanitizeCookies([{ name: 'test' } as { name: string; value: string }])).toThrow(SanitizeError);
  });

  it('rejects cookies with empty name', () => {
    expect(() => sanitizeCookies([{ name: '', value: 'test' }])).toThrow(SanitizeError);
  });

  it('rejects cookies with excessively long name', () => {
    const longName = 'x'.repeat(501);
    expect(() => sanitizeCookies([{ name: longName, value: 'test' }])).toThrow(SanitizeError);
  });

  it('rejects cookies with excessively long value', () => {
    const longValue = 'x'.repeat(5001);
    expect(() => sanitizeCookies([{ name: 'test', value: longValue }])).toThrow(SanitizeError);
  });

  it('rejects cookies with excessively long domain', () => {
    const longDomain = 'x'.repeat(501);
    expect(() => sanitizeCookies([{ name: 'test', value: 'val', domain: longDomain }])).toThrow(SanitizeError);
  });

  it('rejects cookies with excessively long path', () => {
    const longPath = 'x'.repeat(501);
    expect(() => sanitizeCookies([{ name: 'test', value: 'val', path: longPath }])).toThrow(SanitizeError);
  });
});
