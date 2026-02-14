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
});
