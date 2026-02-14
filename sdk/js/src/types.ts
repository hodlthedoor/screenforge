export interface Viewport {
  width: number;
  height: number;
}

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export interface Action {
  type: 'click' | 'scroll' | 'type' | 'hover' | 'wait';
  selector?: string;
  value?: string;
  x?: number;
  y?: number;
}

export interface ScreenshotOptions {
  url?: string;
  html?: string;
  viewport?: Viewport;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  fullPage?: boolean;
  selector?: string;
  waitFor?: string;
  darkMode?: boolean;
  deviceScaleFactor?: number;
  callback_url?: string;
  headers?: Record<string, string>;
  cookies?: Cookie[];
  actions?: Action[];
  hide_selectors?: string[];
  remove_selectors?: string[];
  blur_selectors?: string[];
  blur_radius?: number;
  fail_if_contains?: string;
  fail_if_missing?: string;
  block_ads?: boolean;
}

export interface PdfMargins {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export interface PdfOptions {
  url?: string;
  html?: string;
  format?: 'a4' | 'letter' | 'legal';
  landscape?: boolean;
  margins?: PdfMargins;
  printBackground?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  scale?: number;
  callback_url?: string;
  headers?: Record<string, string>;
  cookies?: Cookie[];
  actions?: Action[];
  hide_selectors?: string[];
  remove_selectors?: string[];
  blur_selectors?: string[];
  blur_radius?: number;
  fail_if_contains?: string;
  fail_if_missing?: string;
  block_ads?: boolean;
}

export interface OgOptions {
  url?: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  theme?: 'light' | 'dark';
  template?: 'default' | 'article' | 'product';
  headers?: Record<string, string>;
  cookies?: Cookie[];
}

export interface BatchItem {
  type: 'screenshot' | 'pdf';
  url?: string;
  html?: string;
  options?: Record<string, unknown>;
  callbackUrl?: string;
}

export type RenderJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface RenderJob {
  id: string;
  type: 'screenshot' | 'pdf' | 'og';
  url: string;
  status: RenderJobStatus;
  error?: string;
  contentType?: string;
  durationMs?: number;
  createdAt: string;
  completedAt?: string;
  pollUrl: string;
}

export interface BatchJobItem {
  id: string;
  type: 'screenshot' | 'pdf' | 'og';
  url: string;
  status: RenderJobStatus;
  error?: string;
  durationMs?: number;
  pollUrl: string;
}

export interface BatchJob {
  id: string;
  total: number;
  completed: number;
  failed: number;
  status: RenderJobStatus;
  createdAt: string;
  completedAt?: string;
  jobs: BatchJobItem[];
}

export interface UsageStats {
  apiKeyId: string;
  tier: string;
  usage: {
    today: number;
    thisMonth: number;
    monthlyQuota: number;
    remaining: number;
  };
  rateLimit: {
    requestsPerMinute: number;
  };
}

export interface WebhookDelivery {
  id: string;
  jobId: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface ListWebhookDeliveriesOptions {
  page?: number;
  limit?: number;
}

export interface AnalyticsDailyEntry {
  date: string;
  count: number;
  avgDurationMs: number;
}

export interface AnalyticsTypeBreakdown {
  type: string;
  count: number;
}

export interface AnalyticsTopUrl {
  url: string;
  count: number;
  avgDurationMs: number;
}

export interface AnalyticsSummary {
  totalRendersThisMonth: number;
  avgDurationMs: number;
  quotaUsagePercent: number;
}

export interface AnalyticsData {
  daily: AnalyticsDailyEntry[];
  typeBreakdown: AnalyticsTypeBreakdown[];
  topUrls: AnalyticsTopUrl[];
  summary: AnalyticsSummary;
}

export interface AsyncRenderResponse {
  jobId: string;
  pollUrl: string;
}

export interface BatchRenderResponse {
  batchId: string;
  jobs: Array<{ jobId: string; pollUrl: string }>;
}
