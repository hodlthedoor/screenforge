import { Command } from 'commander';
import { resolveConfig, type CliConfig } from './config.js';
import type { OutputOptions } from './output.js';
import { registerScreenshot } from './commands/screenshot.js';
import { registerPdf } from './commands/pdf.js';
import { registerOg } from './commands/og.js';
import { registerBatch } from './commands/batch.js';
import { registerHealth } from './commands/health.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('screenforge')
    .description('CLI tool for ScreenForge — screenshots, PDFs, and OG cards from the terminal')
    .version('1.0.0')
    .option('--api-key <key>', 'API key (or set SCREENFORGE_API_KEY)')
    .option('--server <url>', 'Server URL (default: http://localhost:3000)')
    .option('--json', 'Output in JSON format')
    .option('--verbose', 'Enable verbose/debug output');

  let cachedConfig: CliConfig | null = null;

  const getConfig = async (): Promise<CliConfig> => {
    if (cachedConfig) return cachedConfig;
    const opts = program.opts();
    cachedConfig = await resolveConfig({
      apiKey: opts['apiKey'] as string | undefined,
      server: opts['server'] as string | undefined,
    });
    return cachedConfig;
  };

  const getOutput = (): OutputOptions => {
    const opts = program.opts();
    return {
      json: opts['json'] === true,
      verbose: opts['verbose'] === true,
    };
  };

  registerScreenshot(program, getConfig, getOutput);
  registerPdf(program, getConfig, getOutput);
  registerOg(program, getConfig, getOutput);
  registerBatch(program, getConfig, getOutput);
  registerHealth(program, getConfig, getOutput);

  return program;
}
