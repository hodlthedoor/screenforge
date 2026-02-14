#!/usr/bin/env node

import { loadConfigFromEnv } from './config.js';
import { startSseServer, startStdioServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfigFromEnv(process.env);
  const transport = process.env.MCP_TRANSPORT?.toLowerCase() ?? 'stdio';

  if (transport === 'sse') {
    const port = process.env.PORT ? Number(process.env.PORT) : 3333;
    await startSseServer(config, {
      port: Number.isFinite(port) ? port : 3333,
      host: process.env.HOST ?? '0.0.0.0',
      ssePath: process.env.MCP_SSE_PATH ?? '/sse',
      messagesPath: process.env.MCP_MESSAGES_PATH ?? '/messages',
    });
    return;
  }

  await startStdioServer(config);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
