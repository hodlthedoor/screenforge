import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ScreenForge } from '@screenforge/sdk';
import type { Command } from 'commander';
import ora from 'ora';
import type { CliConfig } from '../config.js';
import { formatError, type OutputOptions } from '../output.js';

export function registerOg(program: Command, getConfig: () => Promise<CliConfig>, getOutput: () => OutputOptions): void {
  program
    .command('og <url>')
    .description('Generate an Open Graph card image')
    .option('-o, --output <path>', 'Output file path', './og.png')
    .option('--title <text>', 'Custom title')
    .option('--description <text>', 'Custom description')
    .option('--theme <theme>', 'Theme (light, dark)', 'light')
    .option('--template <name>', 'Template (default, article, product)', 'default')
    .action(async (url: string, opts: Record<string, string | boolean | undefined>) => {
      const config = await getConfig();
      const output = getOutput();
      const spinner = output.json ? null : ora('Generating OG card…').start();

      try {
        const client = new ScreenForge({ apiKey: config.apiKey, baseUrl: config.server });

        const buffer = await client.og(url, {
          ...(opts['title'] ? { title: String(opts['title']) } : {}),
          ...(opts['description'] ? { description: String(opts['description']) } : {}),
          theme: (opts['theme'] as 'light' | 'dark') ?? 'light',
          template: (opts['template'] as 'default' | 'article' | 'product') ?? 'default',
        });

        const outPath = resolve(String(opts['output']));
        await writeFile(outPath, buffer);

        spinner?.succeed(`OG card saved to ${outPath}`);
        if (output.json) {
          console.log(JSON.stringify({ status: 'success', path: outPath, size: buffer.length }));
        }
      } catch (err) {
        spinner?.fail('OG card generation failed');
        console.error(formatError(err, output));
        process.exitCode = 1;
      }
    });
}
