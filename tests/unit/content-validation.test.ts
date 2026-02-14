import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BrowserPool } from '../../src/renderer/browser-pool.js';
import { validateContent, ContentValidationError } from '../../src/renderer/content-validation.js';
import type { Page } from 'playwright';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FIXTURE_DIR = resolve(__dirname, '../fixtures');

describe('ContentValidationError', () => {
  it('has correct name and properties', () => {
    const err = new ContentValidationError('Test failed', 'Error 404', 'fail_if_contains');
    expect(err.name).toBe('ContentValidationError');
    expect(err.message).toBe('Test failed');
    expect(err.matchedText).toBe('Error 404');
    expect(err.validationType).toBe('fail_if_contains');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('validateContent', { timeout: 60_000 }, () => {
  let pool: BrowserPool;
  let page: Page;

  beforeAll(async () => {
    pool = new BrowserPool(1, 100);
    await pool.init();
    const context = await pool.acquire({});
    page = await context.newPage();
  });

  afterAll(async () => {
    await pool.close();
  });

  describe('fail_if_contains', () => {
    it('throws when page contains the specified text', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-error-page.html');
      await writeFile(
        testFile,
        '<html><body><h1>Error 404</h1><p>Page not found</p></body></html>',
        'utf-8'
      );

      try {
        await page.goto(pathToFileURL(testFile).toString());
        await expect(async () => {
          await validateContent(page, 'Error 404', undefined);
        }).rejects.toThrow(ContentValidationError);

        await expect(async () => {
          await validateContent(page, 'Error 404', undefined);
        }).rejects.toThrow('Content validation failed: page contains "Error 404"');
      } finally {
        await unlink(testFile);
      }
    });

    it('does not throw when page does not contain the text', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-success-page.html');
      await writeFile(
        testFile,
        '<html><body><h1>Welcome</h1><p>Everything is fine</p></body></html>',
        'utf-8'
      );

      try {
        await page.goto(pathToFileURL(testFile).toString());
        await expect(
          validateContent(page, 'Error 404', undefined)
        ).resolves.toBeUndefined();
      } finally {
        await unlink(testFile);
      }
    });

    it('is case-sensitive', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-case-page.html');
      await writeFile(
        testFile,
        '<html><body><h1>error 404</h1></body></html>',
        'utf-8'
      );

      try {
        await page.goto(pathToFileURL(testFile).toString());
        // Should NOT throw - case doesn't match
        await expect(
          validateContent(page, 'Error 404', undefined)
        ).resolves.toBeUndefined();

        // Should throw - case matches
        await expect(async () => {
          await validateContent(page, 'error 404', undefined);
        }).rejects.toThrow(ContentValidationError);
      } finally {
        await unlink(testFile);
      }
    });

    it('includes truncated match context in error', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-context-page.html');
      const longText = 'A'.repeat(200) + 'Error 404' + 'B'.repeat(200);
      await writeFile(
        testFile,
        `<html><body><p>${longText}</p></body></html>`,
        'utf-8'
      );

      try {
        await page.goto(pathToFileURL(testFile).toString());
        try {
          await validateContent(page, 'Error 404', undefined);
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(ContentValidationError);
          const valErr = err as ContentValidationError;
          // Match context should be truncated to max 100 chars
          expect(valErr.matchedText.length).toBeLessThanOrEqual(100);
          expect(valErr.matchedText).toContain('Error 404');
        }
      } finally {
        await unlink(testFile);
      }
    });
  });

  describe('fail_if_missing', () => {
    it('throws when page is missing the specified text', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-missing-page.html');
      await writeFile(
        testFile,
        '<html><body><h1>Error 404</h1><p>Not found</p></body></html>',
        'utf-8'
      );

      try {
        await page.goto(pathToFileURL(testFile).toString());
        await expect(async () => {
          await validateContent(page, undefined, 'Welcome');
        }).rejects.toThrow(ContentValidationError);

        await expect(async () => {
          await validateContent(page, undefined, 'Welcome');
        }).rejects.toThrow('Content validation failed: page missing "Welcome"');
      } finally {
        await unlink(testFile);
      }
    });

    it('does not throw when page contains the required text', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-present-page.html');
      await writeFile(
        testFile,
        '<html><body><h1>Welcome</h1><p>Everything is fine</p></body></html>',
        'utf-8'
      );

      try {
        await page.goto(pathToFileURL(testFile).toString());
        await expect(
          validateContent(page, undefined, 'Welcome')
        ).resolves.toBeUndefined();
      } finally {
        await unlink(testFile);
      }
    });

    it('is case-sensitive', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-missing-case-page.html');
      await writeFile(
        testFile,
        '<html><body><h1>welcome</h1></body></html>',
        'utf-8'
      );

      try {
        await page.goto(pathToFileURL(testFile).toString());
        // Should throw - "Welcome" (capital W) is missing
        await expect(async () => {
          await validateContent(page, undefined, 'Welcome');
        }).rejects.toThrow(ContentValidationError);

        // Should NOT throw - "welcome" (lowercase w) is present
        await expect(
          validateContent(page, undefined, 'welcome')
        ).resolves.toBeUndefined();
      } finally {
        await unlink(testFile);
      }
    });
  });

  describe('both validations', () => {
    it('can use both fail_if_contains and fail_if_missing together', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-both-page.html');
      await writeFile(
        testFile,
        '<html><body><h1>Welcome</h1><p>Status: OK</p></body></html>',
        'utf-8'
      );

      try {
        await page.goto(pathToFileURL(testFile).toString());
        // Should pass - has "Welcome", doesn't have "Error"
        await expect(
          validateContent(page, 'Error', 'Welcome')
        ).resolves.toBeUndefined();

        // Should fail - contains "Welcome" which we don't want
        await expect(async () => {
          await validateContent(page, 'Welcome', 'Status');
        }).rejects.toThrow(ContentValidationError);
      } finally {
        await unlink(testFile);
      }
    });

    it('checks fail_if_contains before fail_if_missing', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-order-page.html');
      await writeFile(
        testFile,
        '<html><body><h1>Error 500</h1></body></html>',
        'utf-8'
      );

      try {
        await page.goto(pathToFileURL(testFile).toString());
        // Both would fail, but fail_if_contains should take precedence
        try {
          await validateContent(page, 'Error 500', 'Welcome');
          expect.fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(ContentValidationError);
          const valErr = err as ContentValidationError;
          expect(valErr.validationType).toBe('fail_if_contains');
          expect(valErr.message).toContain('contains');
        }
      } finally {
        await unlink(testFile);
      }
    });
  });

  describe('edge cases', () => {
    it('does nothing when both parameters are undefined', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-noop-page.html');
      await writeFile(
        testFile,
        '<html><body><h1>Anything</h1></body></html>',
        'utf-8'
      );

      try {
        await page.goto(pathToFileURL(testFile).toString());
        await expect(
          validateContent(page, undefined, undefined)
        ).resolves.toBeUndefined();
      } finally {
        await unlink(testFile);
      }
    });

    it('handles empty page content', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-empty-page.html');
      await writeFile(testFile, '<html><body></body></html>', 'utf-8');

      try {
        await page.goto(pathToFileURL(testFile).toString());

        // Empty page should not contain "Error"
        await expect(
          validateContent(page, 'Error', undefined)
        ).resolves.toBeUndefined();

        // Empty page is missing "Welcome"
        await expect(async () => {
          await validateContent(page, undefined, 'Welcome');
        }).rejects.toThrow(ContentValidationError);
      } finally {
        await unlink(testFile);
      }
    });

    it('handles special characters in search text', async () => {
      const testFile = resolve(FIXTURE_DIR, 'validation-special-page.html');
      await writeFile(
        testFile,
        '<html><body><p>Price: $99.99 (10% off!)</p></body></html>',
        'utf-8'
      );

      try {
        await page.goto(pathToFileURL(testFile).toString());

        await expect(
          validateContent(page, undefined, '$99.99')
        ).resolves.toBeUndefined();

        await expect(
          validateContent(page, undefined, '(10% off!)')
        ).resolves.toBeUndefined();
      } finally {
        await unlink(testFile);
      }
    });
  });
});
