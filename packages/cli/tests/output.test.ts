import { describe, it, expect } from 'vitest';
import { formatSuccess, formatError, formatInfo, formatData } from '../src/output.js';

const jsonOpts = { json: true, verbose: false };
const textOpts = { json: false, verbose: false };

describe('formatSuccess', () => {
  it('returns JSON when json mode is on', () => {
    const result = formatSuccess('Done', jsonOpts);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('success');
    expect(parsed.message).toBe('Done');
  });

  it('returns colored text in text mode', () => {
    const result = formatSuccess('Done', textOpts);
    expect(result).toContain('Done');
    expect(result).toContain('✓');
  });
});

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

describe('formatInfo', () => {
  it('returns JSON in json mode', () => {
    const result = formatInfo('Note', jsonOpts);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('info');
  });

  it('returns colored text in text mode', () => {
    const result = formatInfo('Note', textOpts);
    expect(result).toContain('ℹ');
  });
});

describe('formatData', () => {
  it('returns pretty JSON in json mode', () => {
    const result = formatData({ a: 1 }, jsonOpts);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('returns string as-is in text mode', () => {
    expect(formatData('hello', textOpts)).toBe('hello');
  });

  it('pretty-prints objects in text mode', () => {
    const result = formatData({ x: 1 }, textOpts);
    expect(result).toContain('"x": 1');
  });
});
