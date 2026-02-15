import { InvalidArgumentError } from 'commander';
import chalk from 'chalk';

export interface OutputOptions {
  json: boolean;
  verbose: boolean;
}

export function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new InvalidArgumentError(`must be a positive integer, got "${value}"`);
  }
  return n;
}

export function formatError(error: unknown, opts: OutputOptions): string {
  const message = error instanceof Error ? error.message : String(error);
  if (opts.json) {
    return JSON.stringify({ status: 'error', message });
  }
  return `${chalk.red('✗')} ${message}`;
}
