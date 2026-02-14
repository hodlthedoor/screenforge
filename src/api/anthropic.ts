const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

const MODEL_MAP = {
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

export type ModelChoice = keyof typeof MODEL_MAP;

export interface ExtractionRequest {
  imageBase64: string;
  imageMediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  prompt: string;
  schema?: Record<string, unknown>;
  model: ModelChoice;
  apiKey: string;
}

export interface ExtractionResponse {
  data: unknown;
  modelUsed: string;
  tokensUsed: number;
  rawText: string;
}

export async function extractFromImage(req: ExtractionRequest): Promise<ExtractionResponse> {
  const modelId = MODEL_MAP[req.model];

  const systemPrompt = buildSystemPrompt(req.prompt, req.schema);

  const body = {
    model: modelId,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: req.imageMediaType,
              data: req.imageBase64,
            },
          },
          {
            type: 'text',
            text: 'Extract the requested data from this screenshot. Return ONLY valid JSON, no markdown fences or explanation.',
          },
        ],
      },
    ],
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new AnthropicApiError(
      `Anthropic API error ${response.status}: ${errorBody}`,
      response.status,
    );
  }

  const result = await response.json() as AnthropicResponse;

  const textBlock = result.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new AnthropicApiError('No text content in Anthropic response', 500);
  }

  const rawText = textBlock.text;
  const data = parseJsonResponse(rawText);

  const tokensUsed =
    (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);

  return {
    data,
    modelUsed: modelId,
    tokensUsed,
    rawText,
  };
}

function buildSystemPrompt(userPrompt: string, schema?: Record<string, unknown>): string {
  let prompt = `You are a structured data extraction assistant. Your task: ${userPrompt}\n\nReturn ONLY valid JSON. No markdown, no explanation, no code fences.`;

  if (schema) {
    prompt += `\n\nThe output must conform to this JSON Schema:\n${JSON.stringify(schema, null, 2)}`;
  }

  return prompt;
}

function parseJsonResponse(text: string): unknown {
  // Strip markdown code fences if the model includes them despite instructions
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    const firstNewline = cleaned.indexOf('\n');
    cleaned = cleaned.slice(firstNewline + 1);
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3).trim();
    }
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AnthropicApiError(
      `LLM returned invalid JSON: ${cleaned.slice(0, 200)}`,
      502,
    );
  }
}

export class AnthropicApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AnthropicApiError';
  }
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}
