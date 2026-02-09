import type { BrowserPool } from './browser-pool.js';
import type { ScreenshotOptions, RenderResult } from './schemas.js';

const FORMAT_CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export async function takeScreenshot(pool: BrowserPool, options: ScreenshotOptions): Promise<RenderResult> {
  const start = performance.now();
  const context = await pool.acquire();

  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: options.viewport.width, height: options.viewport.height });

    if (options.darkMode) {
      await page.emulateMedia({ colorScheme: 'dark' });
    }

    await page.goto(options.url, { waitUntil: 'networkidle' });

    if (options.waitFor) {
      await page.waitForSelector(options.waitFor, { timeout: 10_000 });
    }

    const screenshotTarget = options.selector ? page.locator(options.selector) : page;

    const buffer = Buffer.from(
      await screenshotTarget.screenshot({
        type: options.format === 'webp' ? 'png' : options.format,
        quality: options.format === 'png' ? undefined : options.quality,
        fullPage: options.fullPage,
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
