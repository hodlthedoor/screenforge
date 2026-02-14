import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';

import { ScreenForge } from '@screenforge/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import type { McpServerConfig } from './config.js';
import { createToolRegistry, type ToolRegistrar } from './tools.js';

export function createScreenforgeMcpServer(config: McpServerConfig): McpServer {
  const client = new ScreenForge({
    apiKey: config.apiKey,
    baseUrl: config.apiUrl,
  });

  const server = new McpServer({
    name: '@screenforge/mcp-server',
    version: '0.1.0',
  });

  const registry = createToolRegistry({
    client,
    inlineDataLimitBytes: config.inlineDataLimitBytes,
    artifactDir: config.artifactDir,
    apiKey: config.apiKey,
  });

  const registrar: ToolRegistrar = {
    registerTool(name, description, inputSchema, handler) {
      (server as unknown as { registerTool: (toolName: string, config: Record<string, unknown>, cb: (args: unknown) => Promise<unknown>) => void }).registerTool(
        name,
        {
          title: name,
          description,
          inputSchema: inputSchema as never,
        },
        async (args: unknown) => {
          const result = await handler((args ?? {}) as Record<string, unknown>);
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

export async function startSseServer(config: McpServerConfig, options: SseServerOptions): Promise<void> {
  const server = createScreenforgeMcpServer(config);
  const ssePath = options.ssePath ?? '/sse';
  const messagesPath = options.messagesPath ?? '/messages';

  let transport: SSEServerTransport | null = null;

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (req.method === 'GET' && requestUrl.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'GET' && requestUrl.pathname === ssePath) {
        transport = new SSEServerTransport(messagesPath, res);
        await server.connect(transport);
        await transport.start();
        return;
      }

      if (req.method === 'POST' && requestUrl.pathname === messagesPath) {
        if (!transport) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'No active SSE session. Connect to SSE endpoint first.' }));
          return;
        }

        await transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(options.port, options.host ?? '0.0.0.0', () => resolve());
  });
}
