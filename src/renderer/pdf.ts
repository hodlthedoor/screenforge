import type { BrowserPool } from './browser-pool.js';
import type { PdfOptions, RenderResult, WaitStrategy } from './schemas.js';
import { applyPreNavigationFilters, applyPostNavigationFilters } from './filters.js';
import { toPlaywrightCookies } from '../security/sanitize.js';
import type { Page } from 'playwright';

const FORMAT_SIZE: Record<string, { width: string; height: string }> = {
  a4: { width: '210mm', height: '297mm' },
  letter: { width: '8.5in', height: '11in' },
  legal: { width: '8.5in', height: '14in' },
};

async function applyWaitStrategy(page: Page, wait: WaitStrategy | undefined, legacyWaitFor: string | undefined, timeoutMs: number): Promise<void> {
  // New wait strategy takes precedence
  if (wait) {
    const waitTimeout = Math.min(timeoutMs, 30_000); // Cap wait at navigation timeout or 30s

    switch (wait.type) {
      case 'networkidle':
        // Already waited during navigation, no additional action needed
        break;

      case 'delay':
        await page.waitForTimeout(wait.value);
        break;

      case 'selector':
        await page.waitForSelector(wait.value, { timeout: waitTimeout });
        break;

      case 'function':
        // eslint-disable-next-line no-new-func
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

export async function renderPdf(pool: BrowserPool, options: PdfOptions, timeoutMs = 30_000): Promise<RenderResult> {
  const start = performance.now();
  const context = await pool.acquire({
    locale: options.locale,
    geolocation: options.geolocation,
    permissions: options.geolocation ? ['geolocation'] : undefined,
    timezoneId: options.timezone,
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

    const size = FORMAT_SIZE[options.format];

    const buffer = Buffer.from(
      await page.pdf({
        width: size.width,
        height: size.height,
        landscape: options.landscape,
        margin: {
          top: options.margins.top,
          right: options.margins.right,
          bottom: options.margins.bottom,
          left: options.margins.left,
        },
        printBackground: options.printBackground,
        headerTemplate: options.headerTemplate,
        footerTemplate: options.footerTemplate,
        displayHeaderFooter: !!(options.headerTemplate || options.footerTemplate),
        scale: options.scale,
      }),
    );

    const durationMs = Math.round(performance.now() - start);

    // Collect metadata
    const title = await page.title();
    const finalUrl = options.url ? (response?.url() ?? options.url) : '';
    const statusCode = response?.status() ?? 0;

    return {
      buffer,
      contentType: 'application/pdf',
      durationMs,
      metadata: {
        title,
        finalUrl,
        statusCode,
      },
    };
  } finally {
    await context.close();
  }
}
