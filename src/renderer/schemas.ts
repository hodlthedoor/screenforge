import { z } from 'zod';

const httpUrlSchema = z.string().url().refine((url) => {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}, { message: 'URL must use http or https protocol' });

// Comprehensive SSRF protection: blocks all private/internal IP ranges
// IPv4: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 0.0.0.0
// IPv6: ::1 (loopback), ::ffff:0:0/96 (IPv4-mapped), fd00::/8 (unique local), fe80::/10 (link-local)
const PRIVATE_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0|\[::1\]|\[::ffff:|\[fd[0-9a-f]{2}:|\[fe[89ab][0-9a-f]:)/i;

export function isPrivateUrl(url: string): boolean {
  try {
    return PRIVATE_HOSTS.test(new URL(url).hostname);
  } catch {
    return true;
  }
}

const MAX_HTML_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_CUSTOM_CSS_SIZE = 50 * 1024; // 50KB
const MAX_CUSTOM_JS_SIZE = 10 * 1024; // 10KB

const contentFilterSchema = z.object({
  block_ads: z.boolean().default(false),
  hide_cookies: z.boolean().default(false),
  custom_css: z.string().refine(
    (s) => Buffer.byteLength(s, 'utf-8') <= MAX_CUSTOM_CSS_SIZE,
    { message: 'custom_css must not exceed 50KB' },
  ).optional(),
  custom_js: z.string().refine(
    (s) => Buffer.byteLength(s, 'utf-8') <= MAX_CUSTOM_JS_SIZE,
    { message: 'custom_js must not exceed 10KB' },
  ).optional(),
});

export const viewportSchema = z.object({
  width: z.number().int().min(1).max(7680).default(1920),
  height: z.number().int().min(1).max(4320).default(1080),
});

const screenshotBaseOptionsSchema = z.object({
  viewport: viewportSchema.default({ width: 1920, height: 1080 }),
  format: z.enum(['png', 'jpeg']).default('png'),
  quality: z.number().int().min(0).max(100).optional(),
  fullPage: z.boolean().default(false),
  selector: z.string().optional(),
  waitFor: z.string().optional(),
  darkMode: z.boolean().default(false),
  deviceScaleFactor: z.number().min(0.5).max(4).default(1),
});

export const screenshotOptionsSchema = z.object({
  url: httpUrlSchema.optional(),
  html: z.string().min(1).refine((html) => Buffer.byteLength(html, 'utf-8') <= MAX_HTML_SIZE, {
    message: `HTML content must not exceed ${MAX_HTML_SIZE / 1024 / 1024}MB`,
  }).optional(),
  ...screenshotBaseOptionsSchema.shape,
  ...contentFilterSchema.shape,
}).refine((data) => (data.url && !data.html) || (!data.url && data.html), {
  message: 'Exactly one of url or html must be provided',
});

export type ScreenshotOptions = z.infer<typeof screenshotOptionsSchema>;

export const marginsSchema = z.object({
  top: z.string().default('0'),
  right: z.string().default('0'),
  bottom: z.string().default('0'),
  left: z.string().default('0'),
});

const pdfBaseOptionsSchema = z.object({
  format: z.enum(['a4', 'letter', 'legal']).default('a4'),
  landscape: z.boolean().default(false),
  margins: marginsSchema.default({ top: '0', right: '0', bottom: '0', left: '0' }),
  printBackground: z.boolean().default(true),
  headerTemplate: z.string().optional(),
  footerTemplate: z.string().optional(),
  scale: z.number().min(0.1).max(2).default(1),
});

export const pdfOptionsSchema = z.object({
  url: httpUrlSchema.optional(),
  html: z.string().min(1).refine((html) => Buffer.byteLength(html, 'utf-8') <= MAX_HTML_SIZE, {
    message: `HTML content must not exceed ${MAX_HTML_SIZE / 1024 / 1024}MB`,
  }).optional(),
  ...pdfBaseOptionsSchema.shape,
  ...contentFilterSchema.shape,
}).refine((data) => (data.url && !data.html) || (!data.url && data.html), {
  message: 'Exactly one of url or html must be provided',
});

export type PdfOptions = z.infer<typeof pdfOptionsSchema>;

export interface RenderResult {
  buffer: Buffer;
  contentType: string;
  durationMs: number;
}
