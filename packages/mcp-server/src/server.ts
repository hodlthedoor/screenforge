import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';

import { ScreenForge } from '@screenforge/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type { McpServerConfig } from './config.js';
import { createToolRegistry, type ToolRegistrar } from './tools.js';

export function createScreenforgeMcpServer(config: McpServerConfig): McpServer {
  const client = new ScreenForge({
    apiKey: config.apiKey,
    baseUrl: config.apiUrl,
  });

  const server = new McpServer({
    name: '@screenforge/mcp-server',
    version: '0.1.1',
  });

  const registry = createToolRegistry({
    client,
    apiUrl: config.apiUrl,
    inlineDataLimitBytes: config.inlineDataLimitBytes,
    artifactDir: config.artifactDir,
    apiKey: config.apiKey,
    extractLlmApiKey: config.extractLlmApiKey,
  });

  const registrar: ToolRegistrar = {
    registerTool(name, description, inputSchema, handler) {
      (server as unknown as { registerTool: (toolName: string, config: Record<string, unknown>, cb: (args: unknown) => Promise<unknown>) => void }).registerTool(
        name,
        {
          title: name,
          description,
          inputSchema: jsonSchemaToZodSchema(inputSchema),
        },
        async (args: unknown) => {
          const normalizedArgs = normalizeToolArguments(args);
          const result = await handler(normalizedArgs);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
            structuredContent: result,
          };
        },
      );
    },
  };

  registry.registerAll(registrar);
  return server;
}

function normalizeToolArguments(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) {
    return {};
  }

  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Tool arguments must be an object');
  }

  return args as Record<string, unknown>;
}

type JsonSchemaNode = Record<string, unknown>;

function jsonSchemaToZodSchema(schema: JsonSchemaNode): z.ZodTypeAny {
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every((value) => typeof value === 'string')) {
    return z.enum(schema.enum as [string, ...string[]]);
  }

  const type = typeof schema.type === 'string' ? schema.type : undefined;
  if (type === 'string') {
    let s = z.string();
    const format = typeof schema.format === 'string' ? schema.format : undefined;
    if (format === 'uri' || format === 'url') s = s.url();
    else if (format === 'email') s = s.email();
    return s;
  }
  if (type === 'number' || type === 'integer') {
    return z.number();
  }
  if (type === 'boolean') {
    return z.boolean();
  }
  if (type === 'array') {
    const items = schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)
      ? jsonSchemaToZodSchema(schema.items as JsonSchemaNode)
      : z.any();
    return z.array(items);
  }

  if (type === 'object' || schema.properties || schema.additionalProperties !== undefined) {
    const properties =
      schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, unknown>)
        : {};

    const required = new Set(
      Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === 'string') : [],
    );

    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (propertySchema && typeof propertySchema === 'object' && !Array.isArray(propertySchema)) {
        const zodSchema = jsonSchemaToZodSchema(propertySchema as JsonSchemaNode);
        shape[key] = required.has(key) ? zodSchema : zodSchema.optional();
      } else {
        shape[key] = required.has(key) ? z.any() : z.any().optional();
      }
    }

    const objectSchema = z.object(shape);
    return schema.additionalProperties === true ? objectSchema.passthrough() : objectSchema;
  }

  return z.any();
}

export async function startStdioServer(config: McpServerConfig): Promise<void> {
  const server = createScreenforgeMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export interface SseServerOptions {
  port: number;
  host?: string;
  ssePath?: string;
  messagesPath?: string;
}

export interface SseServerHandle {
  port: number;
  host: string;
  ssePath: string;
  messagesPath: string;
  close: () => Promise<void>;
}

function writeJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  if (res.writableEnded) {
    return;
  }

  if (!res.headersSent) {
    res.writeHead(statusCode, { 'content-type': 'application/json' });
  }

  res.end(JSON.stringify(payload));
}

export async function startSseServer(config: McpServerConfig, options: SseServerOptions): Promise<SseServerHandle> {
  const server = createScreenforgeMcpServer(config);
  const host = options.host ?? '0.0.0.0';
  const ssePath = options.ssePath ?? '/sse';
  const messagesPath = options.messagesPath ?? '/messages';
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (req.method === 'GET' && requestUrl.pathname === '/health') {
        writeJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === ssePath) {
        if (transports.size > 0) {
          writeJson(res, 409, {
            error: 'SSE concurrency is not supported; close the active session first',
            code: 'SSE_CONCURRENCY_UNSUPPORTED',
          });
          return;
        }

        const transport = new SSEServerTransport(messagesPath, res);
        transports.set(transport.sessionId, transport);
        transport.onclose = () => {
          transports.delete(transport.sessionId);
        };

        if (typeof res.on === 'function') {
          res.on('close', () => {
            transports.delete(transport.sessionId);
          });
        }

        await server.connect(transport);
        return;
      }

      if (req.method === 'POST' && requestUrl.pathname === messagesPath) {
        const sessionId = requestUrl.searchParams.get('sessionId');
        if (!sessionId) {
          writeJson(res, 400, { error: 'Missing required query parameter: sessionId' });
          return;
        }

        const transport = transports.get(sessionId);
        if (!transport) {
          writeJson(res, 404, { error: 'SSE session not found' });
          return;
        }

        await transport.handlePostMessage(req, res);
        return;
      }

      writeJson(res, 404, { error: 'Not found' });
    } catch (error) {
      if (res.writableEnded) {
        return;
      }

      if (res.headersSent) {
        res.end();
        return;
      }

      writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(options.port, host, () => resolve());
  });

  const address =
    typeof (httpServer as unknown as { address?: () => string | { port: number } | null }).address === 'function'
      ? (httpServer as unknown as { address: () => string | { port: number } | null }).address()
      : null;
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  return {
    port,
    host,
    ssePath,
    messagesPath,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (typeof (httpServer as unknown as { close?: (cb: (error?: Error) => void) => void }).close !== 'function') {
          resolve();
          return;
        }

        (httpServer as unknown as { close: (cb: (error?: Error) => void) => void }).close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}
