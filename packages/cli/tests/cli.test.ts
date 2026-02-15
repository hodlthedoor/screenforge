import { describe, it, expect } from 'vitest';
import { createProgram } from '../src/program.js';

describe('createProgram', () => {
  it('creates a program with correct name and version', () => {
    const program = createProgram();
    expect(program.name()).toBe('screenforge');
    expect(program.version()).toBe('1.0.0');
  });

  it('registers all expected commands', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain('screenshot');
    expect(commandNames).toContain('pdf');
    expect(commandNames).toContain('og');
    expect(commandNames).toContain('batch');
    expect(commandNames).toContain('health');
  });

  it('has global options', () => {
    const program = createProgram();
    const optionNames = program.options.map((o) => o.long);

    expect(optionNames).toContain('--api-key');
    expect(optionNames).toContain('--server');
    expect(optionNames).toContain('--json');
    expect(optionNames).toContain('--verbose');
  });

  it('screenshot command has expected options', () => {
    const program = createProgram();
    const screenshot = program.commands.find((c) => c.name() === 'screenshot');
    expect(screenshot).toBeDefined();

    const opts = screenshot!.options.map((o) => o.long);
    expect(opts).toContain('--output');
    expect(opts).toContain('--width');
    expect(opts).toContain('--height');
    expect(opts).toContain('--format');
    expect(opts).toContain('--full-page');
    expect(opts).toContain('--dark-mode');
    expect(opts).toContain('--delay');
    expect(opts).toContain('--selector');
  });

  it('pdf command has expected options', () => {
    const program = createProgram();
    const pdf = program.commands.find((c) => c.name() === 'pdf');
    expect(pdf).toBeDefined();

    const opts = pdf!.options.map((o) => o.long);
    expect(opts).toContain('--output');
    expect(opts).toContain('--format');
    expect(opts).toContain('--landscape');
  });

  it('og command has expected options', () => {
    const program = createProgram();
    const og = program.commands.find((c) => c.name() === 'og');
    expect(og).toBeDefined();

    const opts = og!.options.map((o) => o.long);
    expect(opts).toContain('--output');
    expect(opts).toContain('--title');
    expect(opts).toContain('--description');
    expect(opts).toContain('--theme');
    expect(opts).toContain('--template');
  });

  it('batch command has output-dir option', () => {
    const program = createProgram();
    const batch = program.commands.find((c) => c.name() === 'batch');
    expect(batch).toBeDefined();

    const opts = batch!.options.map((o) => o.long);
    expect(opts).toContain('--output-dir');
  });
});
