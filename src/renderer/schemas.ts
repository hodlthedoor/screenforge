import { z } from 'zod';
import { getDevicePreset } from './devices.js';

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

export const BLOCKABLE_RESOURCE_TYPES = ['image', 'stylesheet', 'font', 'script', 'media', 'other'] as const;
export type BlockableResourceType = typeof BLOCKABLE_RESOURCE_TYPES[number];

const blockableResourceTypeSchema = z.enum(BLOCKABLE_RESOURCE_TYPES);

const contentFilterSchema = z.object({
  block_ads: z.boolean().default(false),
  hide_cookies: z.boolean().default(false),
  block_resources: z.array(blockableResourceTypeSchema).max(6).default([]),
  custom_css: z.string().refine(
    (s) => Buffer.byteLength(s, 'utf-8') <= MAX_CUSTOM_CSS_SIZE,
    { message: 'custom_css must not exceed 50KB' },
  ).optional(),
  custom_js: z.string().refine(
    (s) => Buffer.byteLength(s, 'utf-8') <= MAX_CUSTOM_JS_SIZE,
    { message: 'custom_js must not exceed 10KB' },
  ).optional(),
});

export const cookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().optional(),
  path: z.string().optional(),
});

export const geolocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional(),
});

// Get valid IANA timezone names
const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export const timezoneSchema = z.string().refine(
  (tz) => VALID_TIMEZONES.has(tz),
  { message: 'Invalid IANA timezone identifier' }
);

export const localeSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, {
  message: 'Locale must be in format like "en-US" or "fr-FR"',
});

const requestOverridesSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  cookies: z.array(cookieSchema).optional(),
});

const emulationSchema = z.object({
  geolocation: geolocationSchema.optional(),
  timezone: timezoneSchema.optional(),
  locale: localeSchema.optional(),
});

// Proxy configuration for render requests
export const proxySchema = z.object({
  server: z.string().refine((server) => {
    // Validate proxy URL format — must start with http://, https://, socks4://, or socks5://
    return /^(https?|socks[45]):\/\/.+/.test(server);
  }, {
    message: 'Proxy server must use http://, https://, socks4://, or socks5:// protocol',
  }),
  username: z.string().optional(),
  password: z.string().optional(),
}).optional();

export const viewportSchema = z.object({
  width: z.number().int().min(1).max(7680).default(1920),
  height: z.number().int().min(1).max(4320).default(1080),
});

const clipSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().min(1),
  height: z.number().min(1),
});

// Wait strategy union type for flexible waiting after navigation
export const waitStrategySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('networkidle') }),
  z.object({ type: z.literal('delay'), value: z.number().int().min(0).max(30_000) }),
  z.object({ type: z.literal('selector'), value: z.string() }),
  z.object({ type: z.literal('function'), value: z.string() }),
  z.object({ type: z.literal('hidden'), value: z.string() }),
]);

export type WaitStrategy = z.infer<typeof waitStrategySchema>;

// Pre-capture interaction actions
export const actionSchema = z.object({
  type: z.enum(['click', 'scroll', 'type', 'hover', 'wait']),
  selector: z.string().max(500).optional(),
  value: z.string().max(500).optional(),
  x: z.number().int().min(0).optional(),
  y: z.number().int().min(0).optional(),
});

export type Action = z.infer<typeof actionSchema>;

const screenshotBaseOptionsSchema = z.object({
  viewport: viewportSchema.default({ width: 1920, height: 1080 }),
  format: z.enum(['png', 'jpeg']).default('png'),
  quality: z.number().int().min(0).max(100).optional(),
  fullPage: z.boolean().default(false),
  selector: z.string().optional(),
  clip: clipSchema.optional(),
  waitFor: z.string().optional(),
  wait: waitStrategySchema.optional(),
  darkMode: z.boolean().default(false),
  deviceScaleFactor: z.number().min(0.5).max(4).default(1),
  device: z.string().optional(),
  userAgent: z.string().optional(),
  isMobile: z.boolean().optional(),
  hasTouch: z.boolean().optional(),
  cache_ttl: z.number().int().min(0).max(2592000).optional(),
  cache_key: z.string().max(128).optional(),
  actions: z.array(actionSchema).max(10).optional(),
});

export const screenshotOptionsSchema = z.object({
  url: httpUrlSchema.optional(),
  html: z.string().min(1).refine((html) => Buffer.byteLength(html, 'utf-8') <= MAX_HTML_SIZE, {
    message: `HTML content must not exceed ${MAX_HTML_SIZE / 1024 / 1024}MB`,
  }).optional(),
  ...screenshotBaseOptionsSchema.shape,
  ...contentFilterSchema.shape,
  ...requestOverridesSchema.shape,
  ...emulationSchema.shape,
  proxy: proxySchema,
}).refine((data) => (data.url && !data.html) || (!data.url && data.html), {
  message: 'Exactly one of url or html must be provided',
}).refine((data) => !(data.selector && data.clip), {
  message: 'clip and selector are mutually exclusive',
}).refine((data) => !(data.waitFor && data.wait), {
  message: 'waitFor and wait are mutually exclusive — use wait for new features, waitFor for backwards compatibility',
}).refine((data) => {
  // Validate device preset exists if specified
  if (data.device) {
    return getDevicePreset(data.device) !== undefined;
  }
  return true;
}, {
  message: 'Unknown device preset',
  path: ['device'],
}).transform((data) => {
  // Apply device preset if specified
  if (data.device) {
    const preset = getDevicePreset(data.device)!; // Safe because refine validates it exists
    // Device preset overrides viewport, deviceScaleFactor, userAgent, isMobile, and hasTouch
    return {
      ...data,
      viewport: { width: preset.width, height: preset.height },
      deviceScaleFactor: preset.deviceScaleFactor,
      userAgent: preset.userAgent,
      isMobile: preset.isMobile,
      hasTouch: preset.hasTouch,
    };
  }
  return data;
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
  waitFor: z.string().optional(),
  wait: waitStrategySchema.optional(),
  device: z.string().optional(),
  userAgent: z.string().optional(),
  isMobile: z.boolean().optional(),
  hasTouch: z.boolean().optional(),
  cache_ttl: z.number().int().min(0).max(2592000).optional(),
  cache_key: z.string().max(128).optional(),
  actions: z.array(actionSchema).max(10).optional(),
});

export const pdfOptionsSchema = z.object({
  url: httpUrlSchema.optional(),
  html: z.string().min(1).refine((html) => Buffer.byteLength(html, 'utf-8') <= MAX_HTML_SIZE, {
    message: `HTML content must not exceed ${MAX_HTML_SIZE / 1024 / 1024}MB`,
  }).optional(),
  ...pdfBaseOptionsSchema.shape,
  ...contentFilterSchema.shape,
  ...requestOverridesSchema.shape,
  ...emulationSchema.shape,
  proxy: proxySchema,
}).refine((data) => (data.url && !data.html) || (!data.url && data.html), {
  message: 'Exactly one of url or html must be provided',
}).refine((data) => !(data.waitFor && data.wait), {
  message: 'waitFor and wait are mutually exclusive — use wait for new features, waitFor for backwards compatibility',
}).refine((data) => {
  // Validate device preset exists if specified
  if (data.device) {
    return getDevicePreset(data.device) !== undefined;
  }
  return true;
}, {
  message: 'Unknown device preset',
  path: ['device'],
}).transform((data) => {
  // Apply device preset if specified
  if (data.device) {
    const preset = getDevicePreset(data.device)!; // Safe because refine validates it exists
    // Device preset sets userAgent, isMobile, and hasTouch for PDFs (UA can affect rendering)
    return {
      ...data,
      userAgent: preset.userAgent,
      isMobile: preset.isMobile,
      hasTouch: preset.hasTouch,
    };
  }
  return data;
});

export type PdfOptions = z.infer<typeof pdfOptionsSchema>;

export interface RenderMetadata {
  title: string;
  finalUrl: string;
  statusCode: number;
  width?: number;
  height?: number;
}

export interface RenderResult {
  buffer: Buffer;
  contentType: string;
  durationMs: number;
  metadata?: RenderMetadata;
}
