import type { BrowserPool } from './browser-pool.js';
import type { ScreenshotOptions, RenderResult } from './schemas.js';
import { applyPreNavigationFilters, applyPostNavigationFilters } from './filters.js';
import { imageSize } from 'image-size';

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

    // Apply custom headers if provided
    if (options.headers && Object.keys(options.headers).length > 0) {
      await page.setExtraHTTPHeaders(options.headers);
    }

    // Apply custom cookies if provided
    if (options.cookies && options.cookies.length > 0) {
      await context.addCookies(options.cookies.map(cookie => {
        // Playwright requires either url or domain to be set
        const cookieConfig: {
          name: string;
          value: string;
          domain?: string;
          path?: string;
          url?: string;
        } = {
          name: cookie.name,
          value: cookie.value,
          path: cookie.path,
        };

        // If domain is provided, use it; otherwise derive from URL if available
        if (cookie.domain) {
          cookieConfig.domain = cookie.domain;
        } else if (options.url) {
          // Playwright requires url or domain; use url when domain not provided
          cookieConfig.url = options.url;
        }

        return cookieConfig;
      }));
    }

    await applyPreNavigationFilters(page, options);

    let response;
    if ('html' in options && options.html) {
      await page.setContent(options.html, { waitUntil: 'networkidle', timeout: timeoutMs });
    } else if ('url' in options && options.url) {
      response = await page.goto(options.url, { waitUntil: 'networkidle', timeout: timeoutMs });
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

    // Extract image dimensions
    const dimensions = imageSize(buffer);

    const durationMs = Math.round(performance.now() - start);

    // Collect metadata
    const title = await page.title();
    const finalUrl = options.url ? (response?.url() ?? options.url) : '';
    const statusCode = response?.status() ?? 0;

    return {
      buffer,
      contentType: FORMAT_CONTENT_TYPE[options.format],
      durationMs,
      metadata: {
        title,
        finalUrl,
        statusCode,
        width: dimensions.width ?? 0,
        height: dimensions.height ?? 0,
      },
    };
  } finally {
    await context.close();
  }
}
