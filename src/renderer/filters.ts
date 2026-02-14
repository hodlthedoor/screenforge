import type { Page } from 'playwright';
import { isAdDomain } from './ad-domains.js';
import { buildCookieHidingCss } from './cookie-selectors.js';
import { sanitizeCustomCss, sanitizeCustomJs } from '../security/sanitize.js';

export interface ContentFilterOptions {
  block_ads?: boolean;
  hide_cookies?: boolean;
  custom_css?: string;
  custom_js?: string;
}

/** Set up request-level filters (ad blocking) — must be called BEFORE navigation. */
export async function applyPreNavigationFilters(page: Page, options: ContentFilterOptions): Promise<void> {
  if (options.block_ads) {
    await page.route('**/*', (route) => {
      try {
        const hostname = new URL(route.request().url()).hostname;
        if (isAdDomain(hostname)) {
          return route.abort();
        }
      } catch {
        // Invalid URL — let it through
      }
      return route.continue();
    });
  }
}

/** Inject CSS/JS filters — must be called AFTER navigation. */
export async function applyPostNavigationFilters(page: Page, options: ContentFilterOptions): Promise<void> {
  if (options.hide_cookies) {
    await page.addStyleTag({ content: buildCookieHidingCss() });
  }

  if (options.custom_css) {
    const css = sanitizeCustomCss(options.custom_css);
    await page.addStyleTag({ content: css });
  }

  if (options.custom_js) {
    const js = sanitizeCustomJs(options.custom_js);
    await page.addScriptTag({ content: js });
  }
}
