import type { Page } from 'playwright';
import type { FontSpec } from './schemas.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const FONT_CACHE_DIR = '/tmp/screenforge-fonts';
const FONT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FONT_LOADING_TIMEOUT_MS = 5000;

// Allowlisted font CDN domains
const ALLOWED_FONT_DOMAINS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
]);

/**
 * Validates that a font URL is from an allowed domain and uses HTTPS
 * @throws Error if URL is not allowed
 */
export function validateFontUrl(fontUrl: string): void {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(fontUrl);
  } catch {
    throw new Error(`Invalid font URL: ${fontUrl}`);
  }

  // Must use HTTPS
  if (parsedUrl.protocol !== 'https:') {
    throw new Error(`Font URLs must use HTTPS protocol. Rejected: ${fontUrl}`);
  }

  // Must be from an allowed domain
  if (!ALLOWED_FONT_DOMAINS.has(parsedUrl.hostname)) {
    throw new Error(
      `Font URL domain not allowed. Allowed domains: ${Array.from(ALLOWED_FONT_DOMAINS).join(', ')}. Rejected: ${fontUrl}`
    );
  }
}

/**
 * Builds a Google Fonts CSS URL from family name and optional weights
 */
export function buildGoogleFontUrl(family: string, weights?: number[]): string {
  const encodedFamily = family.replace(/ /g, '+');
  const baseUrl = `https://fonts.googleapis.com/css2?family=${encodedFamily}`;

  if (weights && weights.length > 0) {
    const weightString = weights.join(';');
    return `${baseUrl}:wght@${weightString}&display=swap`;
  }

  return `${baseUrl}&display=swap`;
}

/**
 * Resolves a FontSpec to a CSS URL
 */
function resolveFontUrl(font: FontSpec): string {
  if (font.type === 'url') {
    validateFontUrl(font.url);
    return font.url;
  } else {
    // type === 'google'
    return buildGoogleFontUrl(font.family, font.weights);
  }
}

/**
 * Gets a cached font CSS file path, or downloads and caches it
 */
async function getCachedFontCss(fontUrl: string): Promise<string> {
  // Create cache directory if it doesn't exist
  await fs.mkdir(FONT_CACHE_DIR, { recursive: true });

  // Generate cache key from URL
  const hash = crypto.createHash('sha256').update(fontUrl).digest('hex').slice(0, 16);
  const cacheFilePath = path.join(FONT_CACHE_DIR, `${hash}.css`);

  // Check if cached file exists and is fresh
  try {
    const stats = await fs.stat(cacheFilePath);
    const age = Date.now() - stats.mtimeMs;
    if (age < FONT_CACHE_TTL_MS) {
      // Cache hit
      return cacheFilePath;
    }
  } catch {
    // Cache miss, will download below
  }

  // Download font CSS
  const response = await fetch(fontUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch font CSS from ${fontUrl}: ${response.statusText}`);
  }
  const cssContent = await response.text();

  // Write to cache
  await fs.writeFile(cacheFilePath, cssContent, 'utf-8');

  return cacheFilePath;
}

/**
 * Loads custom fonts into a Playwright page before navigation
 */
export async function loadFonts(page: Page, fonts?: FontSpec[]): Promise<void> {
  if (!fonts || fonts.length === 0) {
    return;
  }

  // Resolve all font URLs
  const fontUrls = fonts.map(resolveFontUrl);

  // Load font stylesheets via local cache
  for (const fontUrl of fontUrls) {
    const cachedPath = await getCachedFontCss(fontUrl);
    const cssContent = await fs.readFile(cachedPath, 'utf-8');
    await page.addStyleTag({ content: cssContent });
  }

  // Wait for fonts to load with timeout
  try {
    await page.evaluate(
      `(async (timeoutMs) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (document.fonts.status === 'loaded') {
            return;
          }
          await document.fonts.ready;
          return;
        }
        // Timeout — continue anyway (fonts may still load in background)
      })(${FONT_LOADING_TIMEOUT_MS})`
    );
  } catch {
    // If fonts.ready fails or times out, continue rendering anyway
  }
}
