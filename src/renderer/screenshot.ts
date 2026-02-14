import type { BrowserPool } from './browser-pool.js';
import type { ScreenshotOptions, RenderResult } from './schemas.js';
import { applyPreNavigationFilters, applyPostNavigationFilters } from './filters.js';
import { applyWaitStrategy } from './wait.js';
import { executeActions } from './actions.js';
import { validateContent } from './content-validation.js';
import { toPlaywrightCookies } from '../security/sanitize.js';
import { imageSize } from 'image-size';
import { getConfig } from '../config/index.js';
import sharp from 'sharp';

const FORMAT_CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export async function takeScreenshot(pool: BrowserPool, options: ScreenshotOptions, timeoutMs = 30_000): Promise<RenderResult> {
  const start = performance.now();

  // Merge per-request proxy over global default proxy (if config is loaded)
  let proxy = options.proxy;
  if (!proxy) {
    try {
      const config = getConfig();
      if (config.PROXY_SERVER) {
        proxy = {
          server: config.PROXY_SERVER,
          username: config.PROXY_USERNAME,
          password: config.PROXY_PASSWORD,
        };
      }
    } catch {
      // Config not loaded (e.g., in tests), skip global proxy
    }
  }

  const context = await pool.acquire({
    viewport: { width: options.viewport.width, height: options.viewport.height },
    deviceScaleFactor: options.deviceScaleFactor,
    userAgent: options.userAgent,
    isMobile: options.isMobile,
    hasTouch: options.hasTouch,
    colorScheme: options.darkMode ? 'dark' : undefined,
    locale: options.locale,
    geolocation: options.geolocation,
    permissions: options.geolocation ? ['geolocation'] : undefined,
    timezoneId: options.timezone,
    proxy,
  });

  try {
    const page = await context.newPage();

    if (options.headers && Object.keys(options.headers).length > 0) {
      await page.setExtraHTTPHeaders(options.headers);
    }

    if (options.cookies && options.cookies.length > 0) {
      await context.addCookies(toPlaywrightCookies(options.cookies, options.url));
    }

    await applyPreNavigationFilters(page, options);

    let response;
    if ('html' in options && options.html) {
      await page.setContent(options.html, { waitUntil: 'networkidle', timeout: timeoutMs });
    } else if ('url' in options && options.url) {
      response = await page.goto(options.url, { waitUntil: 'networkidle', timeout: timeoutMs });
    }

    await applyPostNavigationFilters(page, options);

    await applyWaitStrategy(page, options.wait, options.waitFor, timeoutMs);

    await executeActions(page, options.actions);

    await validateContent(page, options.fail_if_contains, options.fail_if_missing);

    const screenshotTarget = options.selector ? page.locator(options.selector) : page;

    // Playwright doesn't support WebP natively, so capture as PNG first and convert
    const playwrightFormat = options.format === 'webp' ? 'png' : options.format;
    const playwrightQuality = options.format === 'jpeg' ? options.quality : undefined;

    let buffer = Buffer.from(
      await screenshotTarget.screenshot({
        type: playwrightFormat,
        quality: playwrightQuality,
        fullPage: options.fullPage,
        clip: options.clip,
      }),
    );

    // Convert to WebP if requested
    if (options.format === 'webp') {
      // Sharp requires quality 1-100, clamp 0 to 1
      const quality = options.quality !== undefined ? Math.max(1, options.quality) : 80;
      const webpBuffer = await sharp(buffer)
        .webp({ quality })
        .toBuffer();
      buffer = Buffer.from(webpBuffer);
    }

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
