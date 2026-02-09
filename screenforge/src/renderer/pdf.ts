import type { BrowserPool } from './browser-pool.js';
import type { PdfOptions, RenderResult } from './schemas.js';

const FORMAT_SIZE: Record<string, { width: string; height: string }> = {
  a4: { width: '210mm', height: '297mm' },
  letter: { width: '8.5in', height: '11in' },
  legal: { width: '8.5in', height: '14in' },
};

export async function renderPdf(pool: BrowserPool, options: PdfOptions, timeoutMs = 30_000): Promise<RenderResult> {
  const start = performance.now();
  const context = await pool.acquire();

  try {
    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: 'networkidle', timeout: timeoutMs });

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

    return {
      buffer,
      contentType: 'application/pdf',
      durationMs: Math.round(performance.now() - start),
    };
  } finally {
    await context.close();
  }
}
