import { z } from 'zod';

export const viewportSchema = z.object({
  width: z.number().int().min(1).max(7680).default(1920),
  height: z.number().int().min(1).max(4320).default(1080),
});

export const screenshotOptionsSchema = z.object({
  url: z.string().url(),
  viewport: viewportSchema.default({ width: 1920, height: 1080 }),
  format: z.enum(['png', 'jpeg', 'webp']).default('png'),
  quality: z.number().int().min(0).max(100).optional(),
  fullPage: z.boolean().default(false),
  selector: z.string().optional(),
  waitFor: z.string().optional(),
  darkMode: z.boolean().default(false),
  deviceScaleFactor: z.number().min(0.5).max(4).default(1),
});

export type ScreenshotOptions = z.infer<typeof screenshotOptionsSchema>;

export const marginsSchema = z.object({
  top: z.string().default('0'),
  right: z.string().default('0'),
  bottom: z.string().default('0'),
  left: z.string().default('0'),
});

export const pdfOptionsSchema = z.object({
  url: z.string().url(),
  format: z.enum(['a4', 'letter', 'legal']).default('a4'),
  landscape: z.boolean().default(false),
  margins: marginsSchema.default({ top: '0', right: '0', bottom: '0', left: '0' }),
  printBackground: z.boolean().default(true),
  headerTemplate: z.string().optional(),
  footerTemplate: z.string().optional(),
  scale: z.number().min(0.1).max(2).default(1),
});

export type PdfOptions = z.infer<typeof pdfOptionsSchema>;

export interface RenderResult {
  buffer: Buffer;
  contentType: string;
  durationMs: number;
}
