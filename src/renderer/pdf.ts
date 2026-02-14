import type { BrowserPool } from './browser-pool.js';
import type { PdfOptions, RenderResult } from './schemas.js';
import { applyPreNavigationFilters, applyPostNavigationFilters } from './filters.js';
import { applyWaitStrategy } from './wait.js';
import { executeActions } from './actions.js';
import { validateContent } from './content-validation.js';
import { toPlaywrightCookies } from '../security/sanitize.js';
import { getConfig } from '../config/index.js';
import { extractMetadataFromPage } from './metadata.js';

const FORMAT_SIZE: Record<string, { width: string; height: string }> = {
  a4: { width: '210mm', height: '297mm' },
  letter: { width: '8.5in', height: '11in' },
  legal: { width: '8.5in', height: '14in' },
};

export async function renderPdf(pool: BrowserPool, options: PdfOptions, timeoutMs = 30_000): Promise<RenderResult> {
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
    userAgent: options.userAgent,
    isMobile: options.isMobile,
    hasTouch: options.hasTouch,
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

    let metadata: RenderResult['metadata'] = {
      title,
      finalUrl,
      statusCode,
    };

    // Extract enhanced metadata if requested
    if (options.extract_metadata) {
      const enhanced = await extractMetadataFromPage(page);
      metadata = {
        ...metadata,
        description: enhanced.description,
        canonical: enhanced.canonical,
        language: enhanced.language,
        locale: enhanced.locale,
        favicon: enhanced.favicon,
        og: enhanced.og,
        twitter: enhanced.twitter,
      };
    }

    return {
      buffer,
      contentType: 'application/pdf',
      durationMs,
      metadata,
    };
  } finally {
    await context.close();
  }
}
