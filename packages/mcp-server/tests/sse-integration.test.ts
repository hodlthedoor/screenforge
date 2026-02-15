import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

import { startSseServer, type SseServerHandle } from '../src/server.js';

interface ApiRequestRecord {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

interface MockApiHandle {
  port: number;
  requests: ApiRequestRecord[];
  close: () => Promise<void>;
}

async function startMockApiServer(): Promise<MockApiHandle> {
  const requests: ApiRequestRecord[] = [];

  const apiServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const parsedBody = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
    requests.push({
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      headers: req.headers,
      body: parsedBody,
    });

    if (req.method === 'POST' && req.url === '/v1/screenshot') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from('png-mock'));
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/accessibility') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          auditId: 'audit_abc',
          url: 'https://example.com',
          standard: 'WCAG2AA',
          violations: [{ id: 'color-contrast', impact: 'serious', description: 'contrast issue', helpUrl: 'https://example.com/help', nodes: [] }],
          passesCount: 11,
          violationsCount: 1,
          incompleteCount: 0,
          durationMs: 98,
          timestamp: '2026-02-15T00:00:00.000Z',
          screenshotPath: 'https://cdn.example.com/a11y.png',
        }),
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise<void>((resolve) => {
    apiServer.listen(0, '127.0.0.1', () => resolve());
  });

  const address = apiServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start mock API server');
  }

  return {
    port: address.port,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        apiServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function parseStructuredToolContent(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent)) {
    return result.structuredContent as Record<string, unknown>;
  }

  const firstText = result.content.find((item) => item.type === 'text');
  if (!firstText) {
    throw new Error('Missing text content in tool result');
  }

  return JSON.parse(firstText.text) as Record<string, unknown>;
}

function assertToolCompleted(structured: Record<string, unknown>): void {
  if (structured.status === 'error') {
    throw new Error(`Tool returned error: ${String(structured.error)}`);
  }
}

describe('SSE transport integration', () => {
  const openServers: SseServerHandle[] = [];
  const openApiServers: MockApiHandle[] = [];

  afterEach(async () => {
    for (const server of openServers.splice(0)) {
      await server.close();
    }
    for (const apiServer of openApiServers.splice(0)) {
      await apiServer.close();
    }
  });

  it('connects over real HTTP/SSE and lists tools via MCP client', async () => {
    const server = await startSseServer(
      {
        apiKey: 'sk_test',
        apiUrl: 'http://127.0.0.1:3999',
        inlineDataLimitBytes: 1024,
      },
      {
        port: 0,
        host: '127.0.0.1',
        ssePath: '/sse',
        messagesPath: '/messages',
      },
    );

    openServers.push(server);

    const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${server.port}/sse`));
    const client = new Client({ name: 'mcp-integration-test', version: '0.0.0' });

    await client.connect(transport);
    const result = await client.listTools();

    const toolNames = result.tools.map((tool) => tool.name);
    expect(toolNames).toContain('screenshot');
    expect(toolNames).toContain('gif');
    expect(toolNames).toContain('diff');

    await client.close();
  });

  it('enforces sequential-session contract with full MCP calls after reconnect', async () => {
    const server = await startSseServer(
      {
        apiKey: 'sk_test',
        apiUrl: 'http://127.0.0.1:3999',
        inlineDataLimitBytes: 1024,
      },
      {
        port: 0,
        host: '127.0.0.1',
        ssePath: '/sse',
        messagesPath: '/messages',
      },
    );

    openServers.push(server);

    const firstTransport = new SSEClientTransport(new URL(`http://127.0.0.1:${server.port}/sse`));
    const firstClient = new Client({ name: 'mcp-integration-test-concurrency', version: '0.0.0' });

    await firstClient.connect(firstTransport);
    try {
      const secondResponse = await fetch(`http://127.0.0.1:${server.port}/sse`);
      expect(secondResponse.status).toBe(409);
      const secondPayload = (await secondResponse.json()) as { error?: string; code?: string };
      expect(secondPayload.error).toBe('SSE concurrency is not supported; close the active session first');
      expect(secondPayload.code).toBe('SSE_CONCURRENCY_UNSUPPORTED');
    } finally {
      await firstClient.close();
    }

    let reconnectSucceeded = false;
    let reconnectClient: Client | null = null;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${server.port}/sse`));
      const client = new Client({ name: 'mcp-integration-test-reconnect', version: '0.0.0' });
      try {
        await client.connect(transport);
        const result = await client.listTools();
        expect(result.tools.length).toBeGreaterThan(0);
        reconnectSucceeded = true;
        reconnectClient = client;
        break;
      } catch (error) {
        await client.close().catch(() => undefined);
        const isReconnectRace409 =
          error instanceof Error &&
          (error.message.includes('HTTP 409') || error.message.includes('status code (409)'));

        if (!isReconnectRace409) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    expect(reconnectSucceeded).toBe(true);
    await reconnectClient?.close();
  });

  it('still allows MCP tool listing after a rejected concurrent connect attempt', async () => {
    const server = await startSseServer(
      {
        apiKey: 'sk_test',
        apiUrl: 'http://127.0.0.1:3999',
        inlineDataLimitBytes: 1024,
      },
      {
        port: 0,
        host: '127.0.0.1',
        ssePath: '/sse',
        messagesPath: '/messages',
      },
    );

    openServers.push(server);

    const firstTransport = new SSEClientTransport(new URL(`http://127.0.0.1:${server.port}/sse`));
    const firstClient = new Client({ name: 'mcp-integration-test-after-reject', version: '0.0.0' });

    await firstClient.connect(firstTransport);
    try {
      const secondResponse = await fetch(`http://127.0.0.1:${server.port}/sse`);
      expect(secondResponse.status).toBe(409);

      const result = await firstClient.listTools();
      expect(result.tools.length).toBeGreaterThan(0);
    } finally {
      await firstClient.close();
    }
  });

  it('invokes screenshot via callTool and returns completed payload', async () => {
    const apiServer = await startMockApiServer();
    openApiServers.push(apiServer);

    const server = await startSseServer(
      {
        apiKey: 'sk_test',
        apiUrl: `http://127.0.0.1:${apiServer.port}`,
        inlineDataLimitBytes: 1024,
      },
      {
        port: 0,
        host: '127.0.0.1',
        ssePath: '/sse',
        messagesPath: '/messages',
      },
    );

    openServers.push(server);

    const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${server.port}/sse`));
    const client = new Client({ name: 'mcp-integration-test-calltool-screenshot', version: '0.0.0' });
    await client.connect(transport);

    try {
      const result = await client.callTool({
        name: 'screenshot',
        arguments: {
          url: 'https://example.com',
          opts: { format: 'png' },
        },
      });

      const structured = parseStructuredToolContent(result);
      assertToolCompleted(structured);
      expect(structured.status).toBe('completed');
      expect(structured.dataMode).toBe('inline');
      expect(structured.contentType).toBe('image/png');
      expect(structured.base64).toBe(Buffer.from('png-mock').toString('base64'));

      const screenshotCall = apiServer.requests.find((request) => request.path === '/v1/screenshot');
      expect(screenshotCall).toBeTruthy();
      expect(screenshotCall?.headers.authorization).toBe('Bearer sk_test');
      expect(screenshotCall?.body).toMatchObject({
        url: 'https://example.com',
        format: 'png',
      });
    } finally {
      await client.close();
    }
  });

  it('invokes accessibility via callTool and returns mapped audit fields', async () => {
    const apiServer = await startMockApiServer();
    openApiServers.push(apiServer);

    const server = await startSseServer(
      {
        apiKey: 'sk_test',
        apiUrl: `http://127.0.0.1:${apiServer.port}`,
        inlineDataLimitBytes: 1024,
      },
      {
        port: 0,
        host: '127.0.0.1',
        ssePath: '/sse',
        messagesPath: '/messages',
      },
    );

    openServers.push(server);

    const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${server.port}/sse`));
    const client = new Client({ name: 'mcp-integration-test-calltool-a11y', version: '0.0.0' });
    await client.connect(transport);

    try {
      const result = await client.callTool({
        name: 'accessibility',
        arguments: {
          url: 'https://example.com',
          include_screenshot: true,
        },
      });

      const structured = parseStructuredToolContent(result);
      assertToolCompleted(structured);
      expect(structured.status).toBe('completed');
      expect(structured.standard).toBe('WCAG2AA');
      expect(structured.passes).toBe(11);
      expect(structured.violationsCount).toBe(1);
      expect(structured.screenshotUrl).toBe('https://cdn.example.com/a11y.png');

      const accessibilityCall = apiServer.requests.find((request) => request.path === '/v1/accessibility');
      expect(accessibilityCall).toBeTruthy();
      expect(accessibilityCall?.headers.authorization).toBe('Bearer sk_test');
      expect(accessibilityCall?.body).toMatchObject({
        url: 'https://example.com',
        include_screenshot: true,
        standard: 'WCAG2AA',
      });
    } finally {
      await client.close();
    }
  });
});
