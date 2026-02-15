import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CliConfig {
  server: string;
  apiKey: string;
  defaults?: {
    width?: number;
    height?: number;
    format?: string;
    fullPage?: boolean;
  };
}

interface ConfigFileShape {
  server?: string;
  apiKey?: string;
  defaults?: {
    width?: number;
    height?: number;
    format?: string;
    fullPage?: boolean;
  };
}

const CONFIG_FILE_NAME = '.screenforge.json';
const DEFAULT_SERVER = 'http://localhost:3000';

export function getConfigFilePath(): string {
  return join(homedir(), CONFIG_FILE_NAME);
}

export async function loadConfigFile(path?: string): Promise<ConfigFileShape> {
  const filePath = path ?? getConfigFilePath();
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ConfigFileShape;
  } catch {
    return {};
  }
}

export interface ResolveConfigInput {
  apiKey?: string;
  server?: string;
  configFilePath?: string;
}

export async function resolveConfig(input: ResolveConfigInput): Promise<CliConfig> {
  const fileConfig = await loadConfigFile(input.configFilePath);

  const apiKey =
    input.apiKey ??
    process.env['SCREENFORGE_API_KEY'] ??
    fileConfig.apiKey ??
    '';

  const server =
    input.server ??
    process.env['SCREENFORGE_SERVER'] ??
    fileConfig.server ??
    DEFAULT_SERVER;

  return {
    server: server.replace(/\/$/, ''),
    apiKey,
    defaults: fileConfig.defaults,
  };
}
