import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ScreenForge } from '@screenforge/sdk';
import type { Command } from 'commander';
import ora from 'ora';
import type { CliConfig } from '../config.js';
import { formatError, parsePositiveInt, type OutputOptions } from '../output.js';

export function registerScreenshot(program: Command, getConfig: () => Promise<CliConfig>, getOutput: () => OutputOptions): void {
  program
    .command('screenshot <url>')
    .description('Take a screenshot of a URL')
    .option('-o, --output <path>', 'Output file path', './screenshot.png')
    .option('-W, --width <number>', 'Viewport width', parsePositiveInt, 1280)
    .option('-H, --height <number>', 'Viewport height', parsePositiveInt, 800)
    .option('-f, --format <format>', 'Image format (png, jpeg, webp, avif)', 'png')
    .option('--full-page', 'Capture full page')
    .option('--dark-mode', 'Use dark color scheme')
    .option('--delay <ms>', 'Wait before capture (ms)', parsePositiveInt)
    .option('--selector <css>', 'CSS selector to capture')
    .action(async (url: string, opts: Record<string, string | number | boolean | undefined>) => {
      const config = await getConfig();
      const output = getOutput();
      const spinner = output.json ? null : ora('Taking screenshot…').start();

      try {
        const client = new ScreenForge({ apiKey: config.apiKey, baseUrl: config.server });
        const width = config.defaults?.width ?? (opts['width'] as number);
        const height = config.defaults?.height ?? (opts['height'] as number);
        const format = (opts['format'] ?? config.defaults?.format ?? 'png') as 'png' | 'jpeg' | 'webp' | 'avif';

        const buffer = await client.screenshot(url, {
          viewport: { width, height },
          format,
          fullPage: opts['fullPage'] === true || config.defaults?.fullPage,
          darkMode: opts['darkMode'] === true,
          ...(opts['delay'] ? { waitFor: `delay:${opts['delay']}` } : {}),
          ...(opts['selector'] ? { selector: String(opts['selector']) } : {}),
        });

        const outPath = resolve(String(opts['output']));
        await writeFile(outPath, buffer);

        spinner?.succeed(`Screenshot saved to ${outPath}`);
        if (output.json) {
          console.log(JSON.stringify({ status: 'success', path: outPath, size: buffer.length }));
        }
      } catch (err) {
        spinner?.fail('Screenshot failed');
        console.error(formatError(err, output));
        process.exitCode = 1;
      }
    });
}
