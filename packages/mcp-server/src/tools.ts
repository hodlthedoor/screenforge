import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import type {
  CreateScheduleOptions,
  DiffOptions,
  GifOptions,
  OgOptions,
  PdfOptions,
  Schedule,
  ScreenshotOptions,
  UpdateScheduleOptions,
} from '@screenforge/sdk';

export interface ScreenForgeClientLike {
  screenshot(url: string, options?: ScreenshotOptions): Promise<Buffer>;
  pdf(url: string, options?: PdfOptions): Promise<Buffer>;
  og(url: string, options?: OgOptions): Promise<Buffer>;
  gif(options: GifOptions): Promise<Buffer>;
  diff(options: DiffOptions): Promise<Buffer>;
  createSchedule(options: CreateScheduleOptions): Promise<Schedule>;
  listSchedules(): Promise<Schedule[]>;
  getSchedule(id: string): Promise<Schedule>;
  updateSchedule(id: string, options: UpdateScheduleOptions): Promise<Schedule>;
  deleteSchedule(id: string): Promise<void>;
  pollJob(id: string): Promise<unknown>;
}

export interface ToolRegistrar {
  registerTool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): void;
}

export interface ToolRegistryOptions {
  client: ScreenForgeClientLike;
  inlineDataLimitBytes: number;
  artifactDir?: string;
  apiKey: string;
}

interface EncodedBinary {
  dataMode: 'inline' | 'url';
  contentType: string;
  sizeBytes: number;
  base64?: string;
  url?: string;
  filePath?: string;
}

interface PollJobResponse {
  status?: string;
  downloadUrl?: string;
  contentType?: string;
  [key: string]: unknown;
}

const DEFAULT_ARTIFACT_DIR = join(tmpdir(), 'screenforge-mcp-artifacts');

export function createToolRegistry(options: ToolRegistryOptions) {
  const artifactDir = options.artifactDir ?? DEFAULT_ARTIFACT_DIR;
  mkdirSync(artifactDir, { recursive: true });

  const tool = (fn: (args: Record<string, unknown>) => Promise<Record<string, unknown>>) => {
    return async (args: Record<string, unknown>) => {
      try {
        return await fn(args);
      } catch (error) {
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };
  };

  const registerAll = (registrar: ToolRegistrar) => {
    registrar.registerTool(
      'screenshot',
      'Capture a webpage screenshot.',
      {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
          opts: {
            type: 'object',
            additionalProperties: true,
            properties: {
              format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
              fullPage: { type: 'boolean' },
              viewport: {
                type: 'object',
                properties: {
                  width: { type: 'number' },
                  height: { type: 'number' },
                },
              },
            },
          },
        },
      },
      tool(async (args) => {
        const url = requireString(args.url, 'url');
        const opts = asObject(args.opts);
        const buffer = await options.client.screenshot(url, opts as ScreenshotOptions);
        const contentType = formatToImageContentType((opts as { format?: string }).format);
        const encoded = encodeBinary(buffer, contentType, artifactDir, options.inlineDataLimitBytes);
        return { status: 'completed', ...encoded };
      }),
    );

    registrar.registerTool(
      'pdf',
      'Generate a PDF from a webpage.',
      {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
          opts: {
            type: 'object',
            additionalProperties: true,
            properties: {
              format: { type: 'string', enum: ['a4', 'letter', 'legal'] },
              landscape: { type: 'boolean' },
              margins: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
      },
      tool(async (args) => {
        const url = requireString(args.url, 'url');
        const opts = asObject(args.opts);
        const buffer = await options.client.pdf(url, opts as PdfOptions);
        const encoded = encodeBinary(buffer, 'application/pdf', artifactDir, options.inlineDataLimitBytes);
        return { status: 'completed', ...encoded };
      }),
    );

    registrar.registerTool(
      'og',
      'Generate an Open Graph image.',
      {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
          opts: { type: 'object', additionalProperties: true },
        },
      },
      tool(async (args) => {
        const url = requireString(args.url, 'url');
        const opts = asObject(args.opts);
        const buffer = await options.client.og(url, opts as OgOptions);
        const encoded = encodeBinary(buffer, 'image/png', artifactDir, options.inlineDataLimitBytes);
        return { status: 'completed', ...encoded };
      }),
    );

    registrar.registerTool(
      'gif',
      'Record an animated GIF from a webpage.',
      {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
          opts: {
            type: 'object',
            additionalProperties: true,
            properties: {
              duration: { type: 'number' },
              fps: { type: 'number' },
              viewport: {
                type: 'object',
                properties: {
                  width: { type: 'number' },
                  height: { type: 'number' },
                },
              },
            },
          },
        },
      },
      tool(async (args) => {
        const url = requireString(args.url, 'url');
        const opts = asObject(args.opts);
        const buffer = await options.client.gif({ url, ...(opts as GifOptions) });
        const encoded = encodeBinary(buffer, 'image/gif', artifactDir, options.inlineDataLimitBytes);
        return { status: 'completed', ...encoded };
      }),
    );

    registrar.registerTool(
      'diff',
      'Generate a visual diff between two URLs.',
      {
        type: 'object',
        required: ['url_a', 'url_b'],
        properties: {
          url_a: { type: 'string', format: 'uri' },
          url_b: { type: 'string', format: 'uri' },
          opts: { type: 'object', additionalProperties: true },
        },
      },
      tool(async (args) => {
        const urlA = requireString(args.url_a, 'url_a');
        const urlB = requireString(args.url_b, 'url_b');
        const opts = asObject(args.opts);
        const buffer = await options.client.diff({ url_a: urlA, url_b: urlB, ...(opts as DiffOptions) });
        const encoded = encodeBinary(buffer, 'image/png', artifactDir, options.inlineDataLimitBytes);
        return { status: 'completed', ...encoded };
      }),
    );

    registrar.registerTool(
      'create_schedule',
      'Create a recurring schedule for renders.',
      {
        type: 'object',
        required: ['opts'],
        properties: {
          opts: { type: 'object', additionalProperties: true },
        },
      },
      tool(async (args) => {
        const opts = asObject(args.opts);
        const schedule = await options.client.createSchedule(opts as unknown as CreateScheduleOptions);
        return { status: 'completed', schedule };
      }),
    );

    registrar.registerTool(
      'list_schedules',
      'List schedules for the API key.',
      { type: 'object', properties: {} },
      tool(async () => {
        const schedules = await options.client.listSchedules();
        return { status: 'completed', schedules };
      }),
    );

    registrar.registerTool(
      'get_schedule',
      'Get a schedule by ID.',
      {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      tool(async (args) => {
        const id = requireString(args.id, 'id');
        const schedule = await options.client.getSchedule(id);
        return { status: 'completed', schedule };
      }),
    );

    registrar.registerTool(
      'update_schedule',
      'Update a schedule by ID.',
      {
        type: 'object',
        required: ['id', 'opts'],
        properties: {
          id: { type: 'string' },
          opts: { type: 'object', additionalProperties: true },
        },
      },
      tool(async (args) => {
        const id = requireString(args.id, 'id');
        const opts = asObject(args.opts);
        const schedule = await options.client.updateSchedule(id, opts as UpdateScheduleOptions);
        return { status: 'completed', schedule };
      }),
    );

    registrar.registerTool(
      'delete_schedule',
      'Delete a schedule by ID.',
      {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      tool(async (args) => {
        const id = requireString(args.id, 'id');
        await options.client.deleteSchedule(id);
        return { status: 'completed', deleted: true, id };
      }),
    );

    registrar.registerTool(
      'poll_job',
      'Check async render job status.',
      {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      tool(async (args) => {
        const id = requireString(args.id, 'id');
        const job = (await options.client.pollJob(id)) as PollJobResponse;
        const status = typeof job.status === 'string' ? job.status : 'unknown';

        if (status !== 'completed') {
          return { status, job };
        }

        const downloadUrl = typeof job.downloadUrl === 'string' ? job.downloadUrl : undefined;
        if (!downloadUrl) {
          return { status, job };
        }

        const response = await fetch(downloadUrl, {
          headers: {
            authorization: `Bearer ${options.apiKey}`,
          },
        });
        if (!response.ok) {
          return {
            status,
            job,
            artifactFetchError: `Failed to download artifact: HTTP ${response.status}`,
          };
        }

        const arrayBuffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') ?? (typeof job.contentType === 'string' ? job.contentType : 'application/octet-stream');
        const encoded = encodeBinary(Buffer.from(arrayBuffer), contentType, artifactDir, options.inlineDataLimitBytes);

        return {
          status,
          job,
          ...encoded,
        };
      }),
    );
  };

  return { registerAll };
}

function requireString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function formatToImageContentType(format: string | undefined): string {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

function encodeBinary(
  buffer: Buffer,
  contentType: string,
  artifactDir: string,
  inlineDataLimitBytes: number,
): EncodedBinary {
  const sizeBytes = buffer.byteLength;

  if (sizeBytes <= inlineDataLimitBytes) {
    return {
      dataMode: 'inline',
      contentType,
      sizeBytes,
      base64: buffer.toString('base64'),
    };
  }

  const ext = extensionFromContentType(contentType);
  const filePath = join(artifactDir, `${randomUUID()}.${ext}`);
  writeFileSync(filePath, buffer);

  return {
    dataMode: 'url',
    contentType,
    sizeBytes,
    url: `file://${filePath}`,
    filePath,
  };
}

function extensionFromContentType(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('pdf')) return 'pdf';
  return 'bin';
}
