import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import type { CliConfig } from '../config.js';
import { formatError, type OutputOptions } from '../output.js';

export function registerHealth(program: Command, getConfig: () => Promise<CliConfig>, getOutput: () => OutputOptions): void {
  program
    .command('health')
    .description('Check the ScreenForge API server status')
    .action(async () => {
      const config = await getConfig();
      const output = getOutput();
      const spinner = output.json ? null : ora('Checking server health…').start();

      try {
        const response = await fetch(`${config.server}/v1/health`, {
          headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
          signal: AbortSignal.timeout(10_000),
          redirect: 'manual',
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location') ?? 'unknown';
          throw new Error(`Server redirected to ${location} — is the URL correct?`);
        }

        if (!response.ok) {
          throw new Error(`Server returned ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          throw new Error(`Expected JSON response but got ${contentType || 'no content-type'}`);
        }

        const data = await response.json();

        spinner?.succeed(`Server is healthy at ${chalk.cyan(config.server)}`);
        if (output.json) {
          console.log(JSON.stringify({ status: 'success', server: config.server, health: data }));
        } else if (output.verbose) {
          console.log(JSON.stringify(data, null, 2));
        }
      } catch (err) {
        spinner?.fail('Server health check failed');
        console.error(formatError(err, output));
        process.exitCode = 1;
      }
    });
}
