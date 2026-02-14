import type { Page } from 'playwright';
import type { BlockableResourceType } from './schemas.js';
import { isAdDomain } from './ad-domains.js';
import { buildCookieHidingCss } from './cookie-selectors.js';
import { sanitizeCustomCss, sanitizeCustomJs } from '../security/sanitize.js';

export interface ContentFilterOptions {
  block_ads?: boolean;
  hide_cookies?: boolean;
  block_resources?: BlockableResourceType[];
  custom_css?: string;
  custom_js?: string;
  hide_selectors?: string[];
  remove_selectors?: string[];
}

/** Set up request-level filters (ad blocking, resource blocking) — must be called BEFORE navigation. */
export async function applyPreNavigationFilters(page: Page, options: ContentFilterOptions): Promise<void> {
  const shouldBlockAds = options.block_ads ?? false;
  const blockResourceTypes = options.block_resources ?? [];

  // Only set up route if we have filters to apply
  if (shouldBlockAds || blockResourceTypes.length > 0) {
    await page.route('**/*', (route) => {
      // Check resource type blocking first
      if (blockResourceTypes.length > 0) {
        const resourceType = route.request().resourceType();
        if ((blockResourceTypes as readonly string[]).includes(resourceType)) {
          return route.abort();
        }
      }

      // Check ad blocking
      if (shouldBlockAds) {
        try {
          const hostname = new URL(route.request().url()).hostname;
          if (isAdDomain(hostname)) {
            return route.abort();
          }
        } catch {
          // Invalid URL — let it through
        }
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

  if (options.hide_selectors && options.hide_selectors.length > 0) {
    const hideRule = `${options.hide_selectors.join(', ')} { display: none !important; }`;
    await page.addStyleTag({ content: hideRule });
  }

  if (options.remove_selectors && options.remove_selectors.length > 0) {
    for (const selector of options.remove_selectors) {
      await page.$$eval(selector, (els) => els.forEach((el) => el.remove())).catch(() => {
        // Invalid selector — skip silently
      });
    }
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
