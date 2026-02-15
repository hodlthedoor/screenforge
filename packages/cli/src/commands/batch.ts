import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { ScreenForge } from '@screenforge/sdk';
import type { BatchItem } from '@screenforge/sdk';
import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import type { CliConfig } from '../config.js';
import { formatError, type OutputOptions } from '../output.js';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150; // 5 minutes

export function registerBatch(program: Command, getConfig: () => Promise<CliConfig>, getOutput: () => OutputOptions): void {
  program
    .command('batch <file>')
    .description('Submit a batch of render jobs from a JSON file')
    .option('-o, --output-dir <dir>', 'Output directory for results', './batch-output')
    .action(async (file: string, opts: Record<string, string>) => {
      const config = await getConfig();
      const output = getOutput();
      const spinner = output.json ? null : ora('Reading batch file…').start();

      try {
        const filePath = resolve(file);
        const raw = await readFile(filePath, 'utf-8');
        const items: BatchItem[] = JSON.parse(raw);

        if (!Array.isArray(items) || items.length === 0) {
          throw new Error('Batch file must contain a non-empty JSON array of render jobs');
        }

        const client = new ScreenForge({ apiKey: config.apiKey, baseUrl: config.server });

        if (spinner) spinner.text = `Submitting ${items.length} jobs…`;
        const batch = await client.batchRender(items);

        if (spinner) spinner.text = `Batch ${batch.batchId} submitted — polling for results…`;

        let attempts = 0;
        let completed = false;

        while (!completed && attempts < MAX_POLL_ATTEMPTS) {
          await sleep(POLL_INTERVAL_MS);
          const status = await client.pollBatch(batch.batchId);

          if (spinner) spinner.text = `Batch ${batch.batchId}: ${status.completed}/${status.total} complete, ${status.failed} failed`;

          if (status.status === 'completed' || status.status === 'failed') {
            completed = true;

            const outDir = resolve(String(opts['outputDir']));
            await mkdir(outDir, { recursive: true });

            const results = status.jobs.map((job) => ({
              id: job.id,
              type: job.type,
              url: job.url,
              status: job.status,
              error: job.error,
            }));

            await writeFile(join(outDir, 'results.json'), JSON.stringify(results, null, 2));

            if (status.failed > 0) {
              spinner?.warn(`Batch complete: ${status.completed} succeeded, ${status.failed} failed`);
            } else {
              spinner?.succeed(`Batch complete: all ${status.total} jobs succeeded`);
            }

            if (output.json) {
              console.log(JSON.stringify({
                status: 'success',
                batchId: batch.batchId,
                total: status.total,
                completed: status.completed,
                failed: status.failed,
                outputDir: outDir,
              }));
            } else {
              console.log(`  Results saved to ${chalk.cyan(join(outDir, 'results.json'))}`);
            }
            return;
          }

          attempts++;
        }

        if (!completed) {
          spinner?.fail('Batch polling timed out');
          process.exitCode = 1;
        }
      } catch (err) {
        spinner?.fail('Batch processing failed');
        console.error(formatError(err, output));
        process.exitCode = 1;
      }
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
