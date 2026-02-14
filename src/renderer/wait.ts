import type { Page } from 'playwright';
import type { WaitStrategy } from './schemas.js';

export async function applyWaitStrategy(page: Page, wait: WaitStrategy | undefined, legacyWaitFor: string | undefined, timeoutMs: number): Promise<void> {
  // New wait strategy takes precedence
  if (wait) {
    const waitTimeout = Math.min(timeoutMs, 30_000); // Cap wait at navigation timeout or 30s

    switch (wait.type) {
      case 'networkidle':
        await page.waitForLoadState('networkidle', { timeout: waitTimeout });
        break;

      case 'delay':
        await page.waitForTimeout(wait.value);
        break;

      case 'selector':
        await page.waitForSelector(wait.value, { timeout: waitTimeout });
        break;

      case 'function':
        await page.waitForFunction(wait.value, { timeout: waitTimeout });
        break;

      case 'hidden':
        await page.waitForSelector(wait.value, { state: 'hidden', timeout: waitTimeout });
        break;
    }
  } else if (legacyWaitFor) {
    // Backwards compatibility: treat legacy waitFor as selector wait
    await page.waitForSelector(legacyWaitFor, { timeout: 10_000 });
  }
}
