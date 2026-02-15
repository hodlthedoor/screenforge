import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ScreenForge } from '@screenforge/sdk';
import type { Command } from 'commander';
import ora from 'ora';
import type { CliConfig } from '../config.js';
import { formatError, parsePositiveInt, type OutputOptions } from '../output.js';

export function registerPdf(program: Command, getConfig: () => Promise<CliConfig>, getOutput: () => OutputOptions): void {
  program
    .command('pdf <url>')
    .description('Generate a PDF from a URL')
    .option('-o, --output <path>', 'Output file path', './output.pdf')
    .option('-W, --width <number>', 'Viewport width', parsePositiveInt, 1280)
    .option('-H, --height <number>', 'Viewport height', parsePositiveInt, 800)
    .option('-f, --format <format>', 'Page format (a4, letter, legal)', 'a4')
    .option('--landscape', 'Landscape orientation')
    .option('--dark-mode', 'Use dark color scheme')
    .option('--delay <ms>', 'Wait before capture (ms)', parsePositiveInt)
    .action(async (url: string, opts: Record<string, string | boolean | undefined>) => {
      const config = await getConfig();
      const output = getOutput();
      const spinner = output.json ? null : ora('Generating PDF…').start();

      try {
        const client = new ScreenForge({ apiKey: config.apiKey, baseUrl: config.server });
        const format = (opts['format'] as 'a4' | 'letter' | 'legal') ?? 'a4';

        const buffer = await client.pdf(url, {
          format,
          landscape: opts['landscape'] === true,
          ...(opts['delay'] ? { waitFor: `delay:${opts['delay']}` } : {}),
        });

        const outPath = resolve(String(opts['output']));
        await writeFile(outPath, buffer);

        spinner?.succeed(`PDF saved to ${outPath}`);
        if (output.json) {
          console.log(JSON.stringify({ status: 'success', path: outPath, size: buffer.length }));
        }
      } catch (err) {
        spinner?.fail('PDF generation failed');
        console.error(formatError(err, output));
        process.exitCode = 1;
      }
    });
}
