import chalk from 'chalk';

export interface OutputOptions {
  json: boolean;
  verbose: boolean;
}

export function formatSuccess(message: string, opts: OutputOptions): string {
  if (opts.json) {
    return JSON.stringify({ status: 'success', message });
  }
  return `${chalk.green('✓')} ${message}`;
}

export function formatError(error: unknown, opts: OutputOptions): string {
  const message = error instanceof Error ? error.message : String(error);
  if (opts.json) {
    return JSON.stringify({ status: 'error', message });
  }
  return `${chalk.red('✗')} ${message}`;
}

export function formatInfo(message: string, opts: OutputOptions): string {
  if (opts.json) {
    return JSON.stringify({ status: 'info', message });
  }
  return `${chalk.blue('ℹ')} ${message}`;
}

export function formatData(data: unknown, opts: OutputOptions): string {
  if (opts.json) {
    return JSON.stringify(data, null, 2);
  }
  if (typeof data === 'string') {
    return data;
  }
  return JSON.stringify(data, null, 2);
}
