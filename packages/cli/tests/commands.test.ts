import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgram } from '../src/program.js';

const mockScreenshot = vi.fn().mockResolvedValue(Buffer.from('png-data'));
const mockPdf = vi.fn().mockResolvedValue(Buffer.from('pdf-data'));
const mockOg = vi.fn().mockResolvedValue(Buffer.from('og-data'));
const mockBatchRender = vi.fn().mockResolvedValue({ batchId: 'batch-123' });
const mockPollBatch = vi.fn().mockResolvedValue({
  status: 'completed',
  total: 1,
  completed: 1,
  failed: 0,
  jobs: [{ id: 'j1', type: 'screenshot', url: 'https://example.com', status: 'completed' }],
});

// Mock the SDK with a real class so `new ScreenForge()` works
vi.mock('@screenforge/sdk', () => {
  class MockScreenForge {
    constructor(public opts: Record<string, unknown>) {}
    screenshot = mockScreenshot;
    pdf = mockPdf;
    og = mockOg;
    batchRender = mockBatchRender;
    pollBatch = mockPollBatch;
  }
  return { ScreenForge: MockScreenForge };
});

// Mock fs operations
vi.mock('node:fs/promises', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...orig,
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockImplementation(async (path: string, encoding?: string) => {
      if (String(path).endsWith('.screenforge.json')) {
        throw new Error('ENOENT');
      }
      if (String(path).endsWith('.json') && encoding === 'utf-8') {
        return JSON.stringify([{ type: 'screenshot', url: 'https://example.com' }]);
      }
      return orig.readFile(path, encoding as BufferEncoding);
    }),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
});

describe('screenshot command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['SCREENFORGE_API_KEY'];
    delete process.env['SCREENFORGE_SERVER'];
  });

  it('passes width, height, and format options to the SDK', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node', 'screenforge',
      '--api-key', 'test-key',
      '--json',
      'screenshot', 'https://example.com',
      '-W', '1920',
      '-H', '1080',
      '-f', 'jpeg',
      '-o', '/tmp/test-shot.jpeg',
    ]);

    expect(mockScreenshot).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        viewport: { width: 1920, height: 1080 },
        format: 'jpeg',
      }),
    );
  });

  it('passes delay and selector options to the SDK', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node', 'screenforge',
      '--api-key', 'k',
      '--json',
      'screenshot', 'https://example.com',
      '--delay', '500',
      '--selector', '.main',
    ]);

    expect(mockScreenshot).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        waitFor: 'delay:500',
        selector: '.main',
      }),
    );
  });

  it('rejects non-numeric width', async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'screenforge', 'screenshot', 'https://x.com', '-W', 'abc']),
    ).rejects.toThrow();
  });

  it('rejects negative height', async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'screenforge', 'screenshot', 'https://x.com', '-H', '-5']),
    ).rejects.toThrow();
  });
});

describe('pdf command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['SCREENFORGE_API_KEY'];
    delete process.env['SCREENFORGE_SERVER'];
  });

  it('passes format and landscape options to the SDK', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node', 'screenforge',
      '--api-key', 'k',
      '--json',
      'pdf', 'https://example.com',
      '-f', 'letter',
      '--landscape',
      '-o', '/tmp/test.pdf',
    ]);

    expect(mockPdf).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        format: 'letter',
        landscape: true,
      }),
    );
  });

  it('passes delay option to the SDK', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node', 'screenforge',
      '--api-key', 'k',
      '--json',
      'pdf', 'https://example.com',
      '--delay', '1000',
    ]);

    expect(mockPdf).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        waitFor: 'delay:1000',
      }),
    );
  });
});

describe('og command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['SCREENFORGE_API_KEY'];
    delete process.env['SCREENFORGE_SERVER'];
  });

  it('passes title, theme, and template options to the SDK', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node', 'screenforge',
      '--api-key', 'k',
      '--json',
      'og', 'https://example.com',
      '--title', 'My Title',
      '--theme', 'dark',
      '--template', 'article',
      '-o', '/tmp/test-og.png',
    ]);

    expect(mockOg).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        title: 'My Title',
        theme: 'dark',
        template: 'article',
      }),
    );
  });
});

describe('health command', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['SCREENFORGE_API_KEY'];
    delete process.env['SCREENFORGE_SERVER'];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('detects redirect responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: new Headers({ location: 'https://other.example.com/login' }),
    });

    const program = createProgram();
    program.exitOverride();

    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(msg);

    await program.parseAsync(['node', 'screenforge', '--json', 'health']);

    console.error = origError;

    expect(errors.some((e) => e.includes('redirected'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('detects non-JSON responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      json: vi.fn(),
    });

    const program = createProgram();
    program.exitOverride();

    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(msg);

    await program.parseAsync(['node', 'screenforge', '--json', 'health']);

    console.error = origError;

    expect(errors.some((e) => e.includes('Expected JSON'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('succeeds with valid JSON health response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: vi.fn().mockResolvedValue({ status: 'ok', version: '1.0.0' }),
    });

    const program = createProgram();
    program.exitOverride();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    await program.parseAsync(['node', 'screenforge', '--json', 'health']);

    console.log = origLog;

    const output = JSON.parse(logs[0]);
    expect(output.status).toBe('success');
    expect(output.health.status).toBe('ok');
  });
});

describe('screenshot command error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['SCREENFORGE_API_KEY'];
    delete process.env['SCREENFORGE_SERVER'];
    process.exitCode = 0;
  });

  it('sets exitCode 1 when SDK throws', async () => {
    mockScreenshot.mockRejectedValueOnce(new Error('Connection refused'));

    const program = createProgram();
    program.exitOverride();

    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(msg);

    await program.parseAsync([
      'node', 'screenforge',
      '--api-key', 'k',
      '--json',
      'screenshot', 'https://example.com',
    ]);

    console.error = origError;

    expect(errors.some((e) => e.includes('Connection refused'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe('pdf command error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['SCREENFORGE_API_KEY'];
    delete process.env['SCREENFORGE_SERVER'];
    process.exitCode = 0;
  });

  it('sets exitCode 1 when SDK throws', async () => {
    mockPdf.mockRejectedValueOnce(new Error('Timeout'));

    const program = createProgram();
    program.exitOverride();

    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(msg);

    await program.parseAsync([
      'node', 'screenforge',
      '--api-key', 'k',
      '--json',
      'pdf', 'https://example.com',
    ]);

    console.error = origError;

    expect(errors.some((e) => e.includes('Timeout'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe('batch command error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['SCREENFORGE_API_KEY'];
    delete process.env['SCREENFORGE_SERVER'];
    process.exitCode = 0;
  });

  it('rejects empty array batch file', async () => {
    const fs = await import('node:fs/promises');
    (fs.readFile as ReturnType<typeof vi.fn>).mockImplementation(
      async (path: string, encoding?: string) => {
        if (String(path).endsWith('.screenforge.json')) throw new Error('ENOENT');
        if (encoding === 'utf-8') return '[]';
        return Buffer.from('[]');
      },
    );

    const program = createProgram();
    program.exitOverride();

    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(msg);

    await program.parseAsync([
      'node', 'screenforge',
      '--api-key', 'k',
      '--json',
      'batch', 'empty.json',
    ]);

    console.error = origError;

    expect(errors.some((e) => e.includes('non-empty'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('rejects invalid JSON batch file', async () => {
    const fs = await import('node:fs/promises');
    (fs.readFile as ReturnType<typeof vi.fn>).mockImplementation(
      async (path: string, encoding?: string) => {
        if (String(path).endsWith('.screenforge.json')) throw new Error('ENOENT');
        if (encoding === 'utf-8') return 'not json at all';
        return Buffer.from('not json');
      },
    );

    const program = createProgram();
    program.exitOverride();

    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(msg);

    await program.parseAsync([
      'node', 'screenforge',
      '--api-key', 'k',
      '--json',
      'batch', 'bad.json',
    ]);

    console.error = origError;

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe('parsePositiveInt validation', () => {
  it('rejects zero delay', async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'screenforge', 'screenshot', 'https://x.com', '--delay', '0']),
    ).rejects.toThrow();
  });

  it('rejects float width', async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(
      program.parseAsync(['node', 'screenforge', 'screenshot', 'https://x.com', '-W', '12.5']),
    ).rejects.toThrow();
  });
});
