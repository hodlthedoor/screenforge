import { describe, it, expect } from 'vitest';
import { formatError, parsePositiveInt } from '../src/output.js';

const jsonOpts = { json: true, verbose: false };
const textOpts = { json: false, verbose: false };

describe('formatError', () => {
  it('returns JSON for Error objects in json mode', () => {
    const result = formatError(new Error('bad'), jsonOpts);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('error');
    expect(parsed.message).toBe('bad');
  });

  it('handles string errors', () => {
    const result = formatError('string error', jsonOpts);
    const parsed = JSON.parse(result);
    expect(parsed.message).toBe('string error');
  });

  it('returns colored text in text mode', () => {
    const result = formatError(new Error('fail'), textOpts);
    expect(result).toContain('fail');
    expect(result).toContain('✗');
  });
});

describe('parsePositiveInt', () => {
  it('parses valid positive integers', () => {
    expect(parsePositiveInt('42')).toBe(42);
    expect(parsePositiveInt('1')).toBe(1);
    expect(parsePositiveInt('1920')).toBe(1920);
  });

  it('rejects non-numeric strings', () => {
    expect(() => parsePositiveInt('abc')).toThrow('positive integer');
  });

  it('rejects zero', () => {
    expect(() => parsePositiveInt('0')).toThrow('positive integer');
  });

  it('rejects negative numbers', () => {
    expect(() => parsePositiveInt('-5')).toThrow('positive integer');
  });

  it('rejects floats', () => {
    expect(() => parsePositiveInt('12.5')).toThrow('positive integer');
  });

  it('rejects Infinity', () => {
    expect(() => parsePositiveInt('Infinity')).toThrow('positive integer');
  });
});
