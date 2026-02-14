import type { BrowserPool } from './browser-pool.js';
import type { GifOptions, RenderResult } from './schemas.js';
import { applyPreNavigationFilters, applyPostNavigationFilters } from './filters.js';
import { applyWaitStrategy } from './wait.js';
import { executeActions } from './actions.js';
import { toPlaywrightCookies } from '../security/sanitize.js';
import { getConfig } from '../config/index.js';
import sharp from 'sharp';
// @ts-expect-error gif-encoder-2 has no type declarations
import GIFEncoder from 'gif-encoder-2';

/**
 * Capture an animated GIF by recording sequential frames from a Playwright page.
 * Frames are piped to gif-encoder-2 in streaming fashion to avoid OOM.
 */
export async function captureGif(
  pool: BrowserPool,
  options: GifOptions,
  timeoutMs = 30_000,
): Promise<RenderResult> {
  const start = performance.now();

  // Clamp duration to GIF_MAX_DURATION_MS from config
  let maxDurationSec = 10;
  try {
    const cfg = getConfig();
    maxDurationSec = cfg.GIF_MAX_DURATION_MS / 1000;
  } catch {
    // Config not loaded (e.g., in tests) — use default
  }
  options = { ...options, duration: Math.min(options.duration, maxDurationSec) };

  // Merge per-request proxy over global default
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
      // Config not loaded (e.g., in tests)
    }
  }

  const context = await pool.acquire({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: options.deviceScaleFactor,
    userAgent: options.userAgent,
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

    await page.goto(options.url, { waitUntil: 'networkidle', timeout: timeoutMs });

    await applyPostNavigationFilters(page, options);

    await applyWaitStrategy(page, options.wait, options.waitFor, timeoutMs);

    // Execute pre-recording actions
    await executeActions(page, options.actions);

    // Wait the pre-recording delay
    if (options.delay > 0) {
      await page.waitForTimeout(options.delay);
    }

    // Set up GIF encoder in streaming fashion
    const encoder = new GIFEncoder(options.width, options.height);
    const frameDelayMs = Math.round(1000 / options.fps);
    encoder.setDelay(frameDelayMs);
    encoder.setRepeat(0); // 0 = loop forever
    encoder.setQuality(10); // Lower = better quality, slower encoding
    encoder.start();

    // Capture frames in a timed loop
    const totalFrames = Math.ceil(options.duration * options.fps);
    const frameDurationMs = 1000 / options.fps;

    for (let i = 0; i < totalFrames; i++) {
      const frameStart = performance.now();

      // Capture PNG screenshot, decode to raw RGBA with sharp
      const pngBuffer = await page.screenshot({ type: 'png' });
      const { data } = await sharp(Buffer.from(pngBuffer))
        .resize(options.width, options.height, { fit: 'fill' })
        .raw()
        .ensureAlpha()
        .toBuffer({ resolveWithObject: true });

      encoder.addFrame(data);

      // Sleep to maintain approximate frame timing (minus capture time)
      const elapsed = performance.now() - frameStart;
      const sleepMs = Math.max(0, frameDurationMs - elapsed);
      if (sleepMs > 0 && i < totalFrames - 1) {
        await page.waitForTimeout(Math.round(sleepMs));
      }
    }

    encoder.finish();

    const gifBuffer: Buffer = encoder.out.getData();
    const durationMs = Math.round(performance.now() - start);

    return {
      buffer: gifBuffer,
      contentType: 'image/gif',
      durationMs,
    };
  } finally {
    await context.close();
  }
}
