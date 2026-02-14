import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserPool } from '../../src/renderer/browser-pool.js';
import { executeActions, ActionError } from '../../src/renderer/actions.js';
import { screenshotOptionsSchema } from '../../src/renderer/schemas.js';
import type { Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const FIXTURE_URL = pathToFileURL(resolve(__dirname, '../fixtures/test-page.html')).toString();

describe('executeActions', { timeout: 60_000 }, () => {
  let pool: BrowserPool;
  let page: Page;

  beforeAll(async () => {
    pool = new BrowserPool(1, 100);
    await pool.init();
    const context = await pool.acquire({});
    page = await context.newPage();
    await page.goto(FIXTURE_URL);
  });

  afterAll(async () => {
    await pool.close();
  });

  it('executes click action successfully', async () => {
    const actions = [
      { type: 'click' as const, selector: '#test-button' },
    ];

    await executeActions(page, actions);

    // Should not throw
    expect(true).toBe(true);
  });

  it('executes scroll action successfully', async () => {
    const actions = [
      { type: 'scroll' as const, selector: 'h1' },
    ];

    await executeActions(page, actions);

    // Should not throw
    expect(true).toBe(true);
  });

  it('executes type action successfully', async () => {
    const actions = [
      { type: 'type' as const, selector: '#test-input', value: 'test text' },
    ];

    await executeActions(page, actions);

    // Should not throw
    expect(true).toBe(true);
  });

  it('executes hover action successfully', async () => {
    const actions = [
      { type: 'hover' as const, selector: '#test-button' },
    ];

    await executeActions(page, actions);

    // Should not throw
    expect(true).toBe(true);
  });

  it('executes wait action with max 5000ms cap', async () => {
    const start = Date.now();
    const actions = [
      { type: 'wait' as const, value: '10000' }, // Should cap at 5000
    ];

    await executeActions(page, actions);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(6000); // Should be ~5000ms, not 10000ms
  });

  it('throws ActionError with actionIndex on selector not found', async () => {
    const actions = [
      { type: 'click' as const, selector: '#test-button' },
      { type: 'click' as const, selector: '.nonexistent-selector' },
    ];

    await expect(executeActions(page, actions)).rejects.toThrow(ActionError);

    try {
      await executeActions(page, actions);
    } catch (error) {
      if (error instanceof ActionError) {
        expect(error.actionIndex).toBe(1);
        expect(error.message).toContain('Action 1 (click) failed');
      }
    }
  });

  it('throws ActionError on timeout', async () => {
    const actions = [
      { type: 'click' as const, selector: '.will-timeout' },
    ];

    await expect(executeActions(page, actions, 100)).rejects.toThrow(ActionError);
  });

  it('executes multiple actions sequentially', async () => {
    const actions = [
      { type: 'click' as const, selector: '#test-button' },
      { type: 'wait' as const, value: '100' },
      { type: 'hover' as const, selector: 'h1' },
    ];

    await executeActions(page, actions);

    // Should not throw
    expect(true).toBe(true);
  });

  it('scrolls to coordinates when x and y provided', async () => {
    const actions = [
      { type: 'scroll' as const, x: 0, y: 500 },
    ];

    await executeActions(page, actions);

    const scrollY = await page.evaluate(() => {
        return window.scrollY; // eslint-disable-line no-undef
    });
    expect(scrollY).toBeGreaterThan(0);
  });

  it('throws error when type action missing value', async () => {
    const actions = [
      { type: 'type' as const, selector: '#test-input' }, // Missing value
    ];

    await expect(executeActions(page, actions)).rejects.toThrow(ActionError);
  });

  it('throws error when click action missing selector', async () => {
    const actions = [
      { type: 'click' as const }, // Missing selector
    ];

    await expect(executeActions(page, actions)).rejects.toThrow(ActionError);
  });
});

describe('actions schema validation', () => {
  it('enforces max 10 actions', () => {

    const actions = Array(11).fill({ type: 'wait', value: '100' });

    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      actions,
    });

    expect(result.success).toBe(false);
  });

  it('accepts valid actions array', () => {

    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      actions: [
        { type: 'click', selector: 'button' },
        { type: 'scroll', x: 0, y: 500 },
        { type: 'type', selector: 'input', value: 'text' },
        { type: 'hover', selector: 'div' },
        { type: 'wait', value: '1000' },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid action type', () => {

    const result = screenshotOptionsSchema.safeParse({
      url: 'https://example.com',
      actions: [
        { type: 'invalid', selector: 'button' },
      ],
    });

    expect(result.success).toBe(false);
  });
});
