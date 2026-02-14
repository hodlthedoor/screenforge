import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test parseJsonResponse behavior through extractFromImage
// since parseJsonResponse is not exported. We mock fetch to control the response.

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { extractFromImage, AnthropicApiError } from '../../src/api/anthropic.js';

describe('anthropic extractFromImage', () => {
  const baseReq = {
    imageBase64: 'dGVzdA==',
    imageMediaType: 'image/png' as const,
    prompt: 'Extract data',
    model: 'sonnet' as const,
    apiKey: 'sk-ant-test',
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('throws AnthropicApiError when LLM returns invalid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'This is not valid JSON at all!' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });

    await expect(extractFromImage(baseReq)).rejects.toThrow(AnthropicApiError);
    await mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'not json' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    try {
      await extractFromImage(baseReq);
    } catch (err) {
      expect(err).toBeInstanceOf(AnthropicApiError);
      expect((err as AnthropicApiError).statusCode).toBe(502);
      expect((err as AnthropicApiError).message).toContain('LLM returned invalid JSON');
    }
  });

  it('parses valid JSON from LLM response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"name":"Widget","price":29.99}' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });

    const result = await extractFromImage(baseReq);
    expect(result.data).toEqual({ name: 'Widget', price: 29.99 });
    expect(result.tokensUsed).toBe(150);
  });

  it('strips markdown code fences from JSON response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '```json\n{"count":5}\n```' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });

    const result = await extractFromImage(baseReq);
    expect(result.data).toEqual({ count: 5 });
  });

  it('throws AnthropicApiError on HTTP error response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    });

    await expect(extractFromImage(baseReq)).rejects.toThrow(AnthropicApiError);
  });
});
