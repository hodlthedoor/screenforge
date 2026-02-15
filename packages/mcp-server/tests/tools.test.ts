import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createToolRegistry, type ToolRegistrar } from '../src/tools';

interface MockClient {
  screenshot: ReturnType<typeof vi.fn>;
  pdf: ReturnType<typeof vi.fn>;
  og: ReturnType<typeof vi.fn>;
  gif: ReturnType<typeof vi.fn>;
  diff: ReturnType<typeof vi.fn>;
  extract: ReturnType<typeof vi.fn>;
  accessibility: ReturnType<typeof vi.fn>;
  createSchedule: ReturnType<typeof vi.fn>;
  listSchedules: ReturnType<typeof vi.fn>;
  getSchedule: ReturnType<typeof vi.fn>;
  updateSchedule: ReturnType<typeof vi.fn>;
  deleteSchedule: ReturnType<typeof vi.fn>;
  pollJob: ReturnType<typeof vi.fn>;
}

function makeClient(): MockClient {
  return {
    screenshot: vi.fn(),
    pdf: vi.fn(),
    og: vi.fn(),
    gif: vi.fn(),
    diff: vi.fn(),
    extract: vi.fn(),
    accessibility: vi.fn(),
    createSchedule: vi.fn(),
    listSchedules: vi.fn(),
    getSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    pollJob: vi.fn(),
  };
}

class FakeRegistrar implements ToolRegistrar {
  tools = new Map<string, { inputSchema: Record<string, unknown>; handler: (args: Record<string, unknown>) => Promise<unknown> }>();

  registerTool(
    name: string,
    _description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.tools.set(name, { inputSchema, handler });
  }
}

describe('createToolRegistry', () => {
  let client: MockClient;
  let tempDir: string;

  beforeEach(() => {
    client = makeClient();
    tempDir = mkdtempSync(join(tmpdir(), 'screenforge-mcp-test-'));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('registers all required tools', () => {
    const registrar = new FakeRegistrar();
    const registry = createToolRegistry({ client: client as any, inlineDataLimitBytes: 16_384, artifactDir: tempDir, apiKey: 'k' });

    registry.registerAll(registrar);

    expect([...registrar.tools.keys()].sort()).toEqual([
      'accessibility',
      'create_schedule',
      'delete_schedule',
      'diff',
      'extract',
      'get_schedule',
      'gif',
      'list_schedules',
      'og',
      'pdf',
      'poll_job',
      'screenshot',
      'update_schedule',
    ]);
  });

  it('executes screenshot and returns inline base64 for small payloads', async () => {
    client.screenshot.mockResolvedValue(Buffer.from('abc'));

    const registrar = new FakeRegistrar();
    const registry = createToolRegistry({ client: client as any, inlineDataLimitBytes: 10, artifactDir: tempDir, apiKey: 'k' });
    registry.registerAll(registrar);

    const result = await registrar.tools.get('screenshot')!.handler({
      url: 'https://example.com',
      opts: { format: 'png', fullPage: true, viewport: { width: 1280, height: 720 } },
    }) as Record<string, unknown>;

    expect(client.screenshot).toHaveBeenCalledWith('https://example.com', {
      format: 'png',
      fullPage: true,
      viewport: { width: 1280, height: 720 },
    });
    expect(result.status).toBe('completed');
    expect(result.dataMode).toBe('inline');
    expect(result.base64).toBe(Buffer.from('abc').toString('base64'));
    expect(result.contentType).toBe('image/png');
  });

  it('returns file URL for larger payloads', async () => {
    client.pdf.mockResolvedValue(Buffer.alloc(64, 1));

    const registrar = new FakeRegistrar();
    const registry = createToolRegistry({ client: client as any, inlineDataLimitBytes: 8, artifactDir: tempDir, apiKey: 'k' });
    registry.registerAll(registrar);

    const result = await registrar.tools.get('pdf')!.handler({
      url: 'https://example.com',
      opts: { format: 'letter' },
    }) as Record<string, unknown>;

    expect(client.pdf).toHaveBeenCalledWith('https://example.com', { format: 'letter' });
    expect(result.dataMode).toBe('url');
    expect(String(result.url)).toMatch(/^file:\/\//);
    expect(result.contentType).toBe('application/pdf');
  });

  it('passes through schedule CRUD operations', async () => {
    client.createSchedule.mockResolvedValue({ id: 'sched_1' });
    client.listSchedules.mockResolvedValue([{ id: 'sched_1' }]);
    client.getSchedule.mockResolvedValue({ id: 'sched_1' });
    client.updateSchedule.mockResolvedValue({ id: 'sched_1', enabled: false });
    client.deleteSchedule.mockResolvedValue(undefined);

    const registrar = new FakeRegistrar();
    const registry = createToolRegistry({ client: client as any, inlineDataLimitBytes: 8, artifactDir: tempDir, apiKey: 'k' });
    registry.registerAll(registrar);

    const createResult = await registrar.tools.get('create_schedule')!.handler({
      opts: {
        name: 'Daily',
        cron_expression: '0 9 * * *',
        render_type: 'screenshot',
        render_config: { url: 'https://example.com' },
      },
    }) as Record<string, unknown>;
    expect(createResult.schedule).toEqual({ id: 'sched_1' });

    const listResult = await registrar.tools.get('list_schedules')!.handler({}) as Record<string, unknown>;
    expect(listResult.schedules).toEqual([{ id: 'sched_1' }]);

    const getResult = await registrar.tools.get('get_schedule')!.handler({ id: 'sched_1' }) as Record<string, unknown>;
    expect(getResult.schedule).toEqual({ id: 'sched_1' });

    const updateResult = await registrar.tools.get('update_schedule')!.handler({
      id: 'sched_1',
      opts: { enabled: false },
    }) as Record<string, unknown>;
    expect(updateResult.schedule).toEqual({ id: 'sched_1', enabled: false });

    const deleteResult = await registrar.tools.get('delete_schedule')!.handler({ id: 'sched_1' }) as Record<string, unknown>;
    expect(deleteResult.deleted).toBe(true);

    expect(client.createSchedule).toHaveBeenCalledTimes(1);
    expect(client.listSchedules).toHaveBeenCalledTimes(1);
    expect(client.getSchedule).toHaveBeenCalledWith('sched_1');
    expect(client.updateSchedule).toHaveBeenCalledWith('sched_1', { enabled: false });
    expect(client.deleteSchedule).toHaveBeenCalledWith('sched_1');
  });

  it('poll_job fetches completed artifact and returns inline data when small', async () => {
    client.pollJob.mockResolvedValue({
      id: 'job_1',
      status: 'completed',
      type: 'screenshot',
      pollUrl: 'http://localhost:3200/v1/render/job_1',
      downloadUrl: 'http://localhost:3200/v1/render/job_1',
      contentType: 'image/png',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(Buffer.from('img')));

    const registrar = new FakeRegistrar();
    const registry = createToolRegistry({ client: client as any, inlineDataLimitBytes: 1024, artifactDir: tempDir, apiKey: 'abc123' });
    registry.registerAll(registrar);

    const result = await registrar.tools.get('poll_job')!.handler({ id: 'job_1' }) as Record<string, unknown>;

    expect(client.pollJob).toHaveBeenCalledWith('job_1');
    expect(globalThis.fetch).toHaveBeenCalledWith('http://localhost:3200/v1/render/job_1', {
      headers: {
        authorization: 'Bearer abc123',
      },
    });
    expect(result.status).toBe('completed');
    expect(result.dataMode).toBe('inline');
    expect(result.base64).toBe(Buffer.from('img').toString('base64'));
  });

  it('returns structured tool errors', async () => {
    client.og.mockRejectedValue(new Error('boom'));

    const registrar = new FakeRegistrar();
    const registry = createToolRegistry({ client: client as any, inlineDataLimitBytes: 1024, artifactDir: tempDir, apiKey: 'k' });
    registry.registerAll(registrar);

    const result = await registrar.tools.get('og')!.handler({
      url: 'https://example.com',
      opts: {},
    }) as Record<string, unknown>;

    expect(result.status).toBe('error');
    expect(result.error).toBe('boom');
  });

  it('extract validates required args and maps SDK response', async () => {
    client.extract.mockResolvedValue({
      extractionId: 'ext_123',
      data: { title: 'Example' },
      modelUsed: 'sonnet',
      tokensUsed: 128,
      screenshotPath: 'https://cdn.example.com/extract.png',
      durationMs: 321,
    });

    const registrar = new FakeRegistrar();
    const registry = createToolRegistry({ client: client as any, inlineDataLimitBytes: 1024, artifactDir: tempDir, apiKey: 'k' });
    registry.registerAll(registrar);

    const missingPrompt = await registrar.tools.get('extract')!.handler({
      url: 'https://example.com',
    }) as Record<string, unknown>;
    expect(missingPrompt.status).toBe('error');
    expect(missingPrompt.error).toBe('prompt is required');

    const result = await registrar.tools.get('extract')!.handler({
      url: 'https://example.com',
      prompt: 'Extract key metadata',
      schema: { type: 'object' },
      model: 'sonnet',
      screenshot_options: { viewport_width: 1200, viewport_height: 800, format: 'png' },
    }) as Record<string, unknown>;

    expect(client.extract).toHaveBeenCalledWith({
      url: 'https://example.com',
      prompt: 'Extract key metadata',
      schema: { type: 'object' },
      model: 'sonnet',
      screenshot_options: { viewport_width: 1200, viewport_height: 800, format: 'png' },
    });
    expect(result).toMatchObject({
      status: 'completed',
      extractionId: 'ext_123',
      data: { title: 'Example' },
      modelUsed: 'sonnet',
      tokensUsed: 128,
      screenshotUrl: 'https://cdn.example.com/extract.png',
    });
  });

  it('accessibility defaults standard, validates args, and maps SDK response', async () => {
    client.accessibility.mockResolvedValue({
      auditId: 'audit_123',
      url: 'https://example.com',
      standard: 'WCAG2AA',
      violations: [{ id: 'color-contrast', impact: 'serious' }],
      passesCount: 17,
      violationsCount: 1,
      incompleteCount: 0,
      durationMs: 222,
      timestamp: '2026-02-14T00:00:00.000Z',
      screenshotPath: 'https://cdn.example.com/accessibility.png',
    });

    const registrar = new FakeRegistrar();
    const registry = createToolRegistry({ client: client as any, inlineDataLimitBytes: 1024, artifactDir: tempDir, apiKey: 'k' });
    registry.registerAll(registrar);

    const missingUrl = await registrar.tools.get('accessibility')!.handler({}) as Record<string, unknown>;
    expect(missingUrl.status).toBe('error');
    expect(missingUrl.error).toBe('url is required');

    const result = await registrar.tools.get('accessibility')!.handler({
      url: 'https://example.com',
      include_screenshot: true,
    }) as Record<string, unknown>;

    expect(client.accessibility).toHaveBeenCalledWith('https://example.com', {
      standard: 'WCAG2AA',
      include_screenshot: true,
    });
    expect(result).toMatchObject({
      status: 'completed',
      url: 'https://example.com',
      standard: 'WCAG2AA',
      violations: [{ id: 'color-contrast', impact: 'serious' }],
      passes: 17,
      violationsCount: 1,
      screenshotUrl: 'https://cdn.example.com/accessibility.png',
    });
  });

  it('returns accessibility SDK errors through structured error response', async () => {
    client.accessibility.mockRejectedValue(new Error('a11y failed'));

    const registrar = new FakeRegistrar();
    const registry = createToolRegistry({ client: client as any, inlineDataLimitBytes: 1024, artifactDir: tempDir, apiKey: 'k' });
    registry.registerAll(registrar);

    const result = await registrar.tools.get('accessibility')!.handler({
      url: 'https://example.com',
    }) as Record<string, unknown>;

    expect(result.status).toBe('error');
    expect(result.error).toBe('a11y failed');
  });
});
