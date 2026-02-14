import type { Page } from 'playwright';
import type { Action } from './schemas.js';

const MAX_WAIT_MS = 5000;

export class ActionError extends Error {
  constructor(
    message: string,
    public actionIndex: number,
    public actionType: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

/**
 * Execute a sequence of pre-capture interaction actions on a page.
 * Actions are executed sequentially in the order provided.
 *
 * @param page - Playwright page instance
 * @param actions - Array of actions to execute
 * @param perActionTimeoutMs - Timeout for each individual action (default: 5000ms)
 * @throws {ActionError} If any action fails, with actionIndex and actionType
 */
export async function executeActions(
  page: Page,
  actions: Action[] | undefined,
  perActionTimeoutMs = 5000,
): Promise<void> {
  if (!actions || actions.length === 0) {
    return;
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const actionDesc = `Action ${i} (${action.type})`;

    try {
      switch (action.type) {
        case 'click':
          if (!action.selector) {
            throw new Error('click action requires selector');
          }
          await page.click(action.selector, { timeout: perActionTimeoutMs });
          break;

        case 'scroll': {
          if (action.x !== undefined && action.y !== undefined) {
            // Scroll to coordinates
            await page.evaluate(
              ({ x, y }) => {
                // eslint-disable-next-line no-undef
                // @ts-expect-error - window is available in browser context
                window.scrollTo(x, y);
              },
              { x: action.x, y: action.y },
            );
          } else if (action.selector) {
            // Scroll to element
            await page.locator(action.selector).scrollIntoViewIfNeeded({ timeout: perActionTimeoutMs });
          } else {
            throw new Error('scroll action requires either selector or x,y coordinates');
          }
          break;
        }

        case 'type':
          if (!action.selector) {
            throw new Error('type action requires selector');
          }
          if (!action.value) {
            throw new Error('type action requires value');
          }
          await page.type(action.selector, action.value, { timeout: perActionTimeoutMs });
          break;

        case 'hover':
          if (!action.selector) {
            throw new Error('hover action requires selector');
          }
          await page.hover(action.selector, { timeout: perActionTimeoutMs });
          break;

        case 'wait': {
          if (!action.value) {
            throw new Error('wait action requires value (ms as string)');
          }
          // Cap wait time at MAX_WAIT_MS
          const waitMs = Math.min(parseInt(action.value, 10), MAX_WAIT_MS);
          await page.waitForTimeout(waitMs);
          break;
        }

        default:
          // TypeScript should ensure this is unreachable, but handle it anyway
          throw new Error(`Unknown action type: ${(action as Action).type}`);
      }
    } catch (error) {
      // Wrap all errors in ActionError with context
      const message = error instanceof Error ? error.message : String(error);
      throw new ActionError(
        `${actionDesc} failed: ${message}`,
        i,
        action.type,
        error,
      );
    }
  }
}
