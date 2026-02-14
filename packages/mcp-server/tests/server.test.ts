import type { IncomingMessage, ServerResponse } from 'node:http';

import { beforeEach, describe, expect, it, vi } from 'vitest';

let requestHandler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null = null;

interface MockHttpServer {
  listen: (port: number, host: string, cb: () => void) => void;
}

class MockSSETransport {
  static nextId = 1;
  static throwAfterSend = false;
  static instances: MockSSETransport[] = [];

  readonly sessionId: string;
  readonly endpoint: string;
  readonly res: MockResponse;
  handledPostMessages = 0;

  constructor(endpoint: string, res: ServerResponse) {
    this.sessionId = `session-${MockSSETransport.nextId++}`;
    this.endpoint = endpoint;
    this.res = res as unknown as MockResponse;
    MockSSETransport.instances.push(this);
  }

  async start(): Promise<void> {
    this.res.writeHead(200, { 'content-type': 'text/event-stream' });
    this.res.end(`event: endpoint\ndata: ${this.endpoint}?sessionId=${this.sessionId}\n\n`);
  }

  async handlePostMessage(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.handledPostMessages += 1;
    if (MockSSETransport.throwAfterSend) {
      (res as unknown as MockResponse).writeHead(202, { 'content-type': 'application/json' });
      (res as unknown as MockResponse).end(JSON.stringify({ ok: true }));
      throw new Error('late failure');
    }

    (res as unknown as MockResponse).writeHead(200, { 'content-type': 'application/json' });
    (res as unknown as MockResponse).end(JSON.stringify({ ok: true }));
  }
}

class MockMcpServer {
  registerTool(): void {}
  async connect(): Promise<void> {}
}

class MockScreenForge {
  constructor(_opts: unknown) {}
}

class MockResponse {
  statusCode: number | undefined;
  headersSent = false;
  writableEnded = false;
  body = '';

  writeHead(statusCode: number): this {
    if (this.headersSent) {
      throw new Error('ERR_HTTP_HEADERS_SENT');
    }
    this.statusCode = statusCode;
    this.headersSent = true;
    return this;
  }

  end(chunk?: string): this {
    if (typeof chunk === 'string') {
      this.body += chunk;
    }
    this.writableEnded = true;
    return this;
  }
}

vi.mock('node:http', () => ({
  createServer: (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): MockHttpServer => {
    requestHandler = handler;
    return {
      listen: (_port: number, _host: string, cb: () => void) => cb(),
    };
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: MockSSETransport,
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: MockMcpServer,
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}));

vi.mock('@screenforge/sdk', () => ({
  ScreenForge: MockScreenForge,
}));

describe('startSseServer', () => {
  beforeEach(() => {
    requestHandler = null;
    MockSSETransport.nextId = 1;
    MockSSETransport.throwAfterSend = false;
    MockSSETransport.instances = [];
    vi.resetModules();
  });

  it('routes POST messages by sessionId', async () => {
    const { startSseServer } = await import('../src/server');
    await startSseServer(
      { apiKey: 'sk_test', apiUrl: 'http://localhost:3100', inlineDataLimitBytes: 1024 },
      { port: 3333, host: '127.0.0.1', ssePath: '/sse', messagesPath: '/messages' },
    );

    const handler = requestHandler;
    expect(handler).toBeTruthy();

    const sseRes = new MockResponse();
    await handler!(
      { method: 'GET', url: '/sse', headers: { host: 'localhost:3333' } } as IncomingMessage,
      sseRes as unknown as ServerResponse,
    );
    expect(MockSSETransport.instances).toHaveLength(1);
    const sessionId = MockSSETransport.instances[0]!.sessionId;

    const postRes = new MockResponse();
    await handler!(
      { method: 'POST', url: `/messages?sessionId=${sessionId}`, headers: { host: 'localhost:3333' } } as IncomingMessage,
      postRes as unknown as ServerResponse,
    );
    expect(MockSSETransport.instances[0]!.handledPostMessages).toBe(1);

    const missingSessionRes = new MockResponse();
    await handler!(
      { method: 'POST', url: '/messages', headers: { host: 'localhost:3333' } } as IncomingMessage,
      missingSessionRes as unknown as ServerResponse,
    );
    expect(missingSessionRes.statusCode).toBe(400);

    const unknownSessionRes = new MockResponse();
    await handler!(
      { method: 'POST', url: '/messages?sessionId=does-not-exist', headers: { host: 'localhost:3333' } } as IncomingMessage,
      unknownSessionRes as unknown as ServerResponse,
    );
    expect(unknownSessionRes.statusCode).toBe(404);
  });

  it('does not crash when an error occurs after response headers were sent', async () => {
    MockSSETransport.throwAfterSend = true;
    const { startSseServer } = await import('../src/server');
    await startSseServer(
      { apiKey: 'sk_test', apiUrl: 'http://localhost:3100', inlineDataLimitBytes: 1024 },
      { port: 3333, host: '127.0.0.1', ssePath: '/sse', messagesPath: '/messages' },
    );

    const handler = requestHandler;
    expect(handler).toBeTruthy();

    await handler!(
      { method: 'GET', url: '/sse', headers: { host: 'localhost:3333' } } as IncomingMessage,
      new MockResponse() as unknown as ServerResponse,
    );

    const postRes = new MockResponse();
    await expect(
      handler!(
        { method: 'POST', url: '/messages?sessionId=session-1', headers: { host: 'localhost:3333' } } as IncomingMessage,
        postRes as unknown as ServerResponse,
      ),
    ).resolves.toBeUndefined();
    expect(postRes.statusCode).toBe(202);
  });
});
