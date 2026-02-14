import type { BrowserPool } from './browser-pool.js';
import type { ScreenshotOptions, RenderResult } from './schemas.js';
import { applyPreNavigationFilters, applyPostNavigationFilters } from './filters.js';

const FORMAT_CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
};

export async function takeScreenshot(pool: BrowserPool, options: ScreenshotOptions, timeoutMs = 30_000): Promise<RenderResult> {
  const start = performance.now();
  const context = await pool.acquire({
    viewport: { width: options.viewport.width, height: options.viewport.height },
    deviceScaleFactor: options.deviceScaleFactor,
    colorScheme: options.darkMode ? 'dark' : undefined,
  });

  try {
    const page = await context.newPage();

    await applyPreNavigationFilters(page, options);

    if ('html' in options && options.html) {
      await page.setContent(options.html, { waitUntil: 'networkidle', timeout: timeoutMs });
    } else if ('url' in options && options.url) {
      await page.goto(options.url, { waitUntil: 'networkidle', timeout: timeoutMs });
    }

    await applyPostNavigationFilters(page, options);

    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: 10_000 });
    }

    const screenshotTarget = options.selector ? page.locator(options.selector) : page;

    const buffer = Buffer.from(
      await screenshotTarget.screenshot({
        type: options.format,
        quality: options.format === 'png' ? undefined : options.quality,
        fullPage: options.fullPage,
        clip: options.clip,
      }),
    );

    return {
      buffer,
      contentType: FORMAT_CONTENT_TYPE[options.format],
      durationMs: Math.round(performance.now() - start),
    };
  } finally {
    await context.close();
  }
}
