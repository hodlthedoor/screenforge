import { afterEach, describe, expect, it } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

import { startSseServer, type SseServerHandle } from '../src/server.js';

describe('SSE transport integration', () => {
  const openServers: SseServerHandle[] = [];

  afterEach(async () => {
    for (const server of openServers.splice(0)) {
      await server.close();
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
});
