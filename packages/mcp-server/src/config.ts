export interface McpServerConfig {
  apiUrl: string;
  apiKey: string;
  inlineDataLimitBytes: number;
  artifactDir?: string;
}

const DEFAULT_API_URL = 'http://localhost:3100';
const DEFAULT_INLINE_DATA_LIMIT_BYTES = 512 * 1024;

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  const apiUrl = (env.SCREENFORGE_API_URL ?? DEFAULT_API_URL).replace(/\/$/, '');
  const apiKey = env.SCREENFORGE_API_KEY?.trim() ?? '';

  if (!apiKey) {
    throw new Error('SCREENFORGE_API_KEY is required');
  }

  const inlineFromEnv = env.SCREENFORGE_MCP_INLINE_LIMIT_BYTES
    ? Number(env.SCREENFORGE_MCP_INLINE_LIMIT_BYTES)
    : undefined;

  const inlineDataLimitBytes = Number.isFinite(inlineFromEnv) && (inlineFromEnv as number) > 0
    ? Math.floor(inlineFromEnv as number)
    : DEFAULT_INLINE_DATA_LIMIT_BYTES;

  const artifactDir = env.SCREENFORGE_MCP_ARTIFACT_DIR?.trim() || undefined;

  return {
    apiUrl,
    apiKey,
    inlineDataLimitBytes,
    artifactDir,
  };
}
