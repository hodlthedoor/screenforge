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
        });

        if (!response.ok) {
          throw new Error(`Server returned ${response.status} ${response.statusText}`);
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
