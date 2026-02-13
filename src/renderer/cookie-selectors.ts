/** Common CSS selectors for cookie consent banners and GDPR notices. */
export const COOKIE_SELECTORS: readonly string[] = [
  '#CookieConsent',
  '#CybotCookiebotDialog',
  '#CybotCookiebotDialogBodyUnderlay',
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  '.onetrust-pc-dark-filter',
  '#cookie-law-info-bar',
  '#cookie-law-info-again',
  '.cc-window',
  '.cc-banner',
  '#gdpr-cookie-notice',
  '#cookie-notice',
  '.cookie-notice',
  '#cookiescript_injected',
  '#hs-eu-cookie-confirmation',
  '.evidon-consent-button',
  '#truste-consent-track',
  '#consent-bump',
  '.js-consent-banner',
  '#cookie-banner',
  '.cookie-banner',
  '[data-cookieconsent]',
  '[aria-label="Cookie Consent"]',
  '.cc_container',
] as const;

/** Build a CSS stylesheet that hides all known cookie consent banners. */
export function buildCookieHidingCss(): string {
  return `${COOKIE_SELECTORS.join(',\n')} {\n  display: none !important;\n  visibility: hidden !important;\n}\n`;
}
