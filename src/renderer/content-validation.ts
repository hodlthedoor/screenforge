import type { Page } from 'playwright';

/**
 * Error thrown when content validation fails.
 * Used to signal that a page contains unwanted text (fail_if_contains)
 * or is missing required text (fail_if_missing).
 */
export class ContentValidationError extends Error {
  constructor(
    message: string,
    public matchedText: string,
    public validationType: 'fail_if_contains' | 'fail_if_missing',
  ) {
    super(message);
    this.name = 'ContentValidationError';
  }
}

/**
 * Validates page content against fail_if_contains and fail_if_missing rules.
 * Extracts text from document.body.innerText and performs plain text search.
 *
 * @param page - Playwright page instance
 * @param failIfContains - Optional text that should NOT be present on the page
 * @param failIfMissing - Optional text that MUST be present on the page
 * @throws {ContentValidationError} If validation fails
 */
export async function validateContent(
  page: Page,
  failIfContains?: string,
  failIfMissing?: string,
): Promise<void> {
  // No-op if both are undefined
  if (!failIfContains && !failIfMissing) {
    return;
  }

  // Extract page text content
  const pageText = await page.evaluate(() => {
    // @ts-expect-error - document is available in browser context
    return document.body.innerText; // eslint-disable-line no-undef
  });

  // Check fail_if_contains first (takes precedence)
  if (failIfContains) {
    const index = pageText.indexOf(failIfContains);
    if (index !== -1) {
      // Extract context around the match (max 100 chars)
      const start = Math.max(0, index - 25);
      const end = Math.min(pageText.length, index + failIfContains.length + 25);
      const context = pageText.slice(start, end);
      const truncatedContext = context.length > 100 ? context.slice(0, 100) : context;

      throw new ContentValidationError(
        `Content validation failed: page contains "${failIfContains}"`,
        truncatedContext,
        'fail_if_contains',
      );
    }
  }

  // Check fail_if_missing
  if (failIfMissing) {
    if (!pageText.includes(failIfMissing)) {
      throw new ContentValidationError(
        `Content validation failed: page missing "${failIfMissing}"`,
        '', // No matched text for missing validation
        'fail_if_missing',
      );
    }
  }
}
