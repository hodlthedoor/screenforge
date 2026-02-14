/**
 * Enhanced metadata extraction from HTML documents
 * Extracts Open Graph tags, Twitter Cards, favicon, canonical URL, and language/locale
 */

export interface EnhancedMetadata {
  title: string;
  description: string;
  canonical: string | null;
  language: string | null;
  locale: string | null;
  favicon: string | null;
  og: {
    title?: string;
    description?: string;
    image?: string;
    type?: string;
    url?: string;
  };
  twitter: {
    card?: string;
    title?: string;
    description?: string;
    image?: string;
    site?: string;
  };
}

/**
 * Extract enhanced metadata from a Document object
 * This function is designed to be serializable and run in a browser context via page.evaluate()
 */
interface DocumentLike {
  querySelector(selector: string): { getAttribute(name: string): string | null } | null;
  title: string;
  documentElement: { getAttribute(name: string): string | null };
  location?: { href: string };
}

export async function extractEnhancedMetadata(document: DocumentLike): Promise<EnhancedMetadata> {
  // Helper to get meta content by property or name
  const getMetaContent = (selector: string): string | null => {
    const el = document.querySelector(selector);
    return el?.getAttribute('content') || null;
  };

  // Helper to resolve relative URLs
  const resolveUrl = (url: string | null, baseUrl: string): string | null => {
    if (!url) return null;
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return url;
    }
  };

  const baseUrl = document.location?.href || 'https://example.com';

  // Extract basic metadata
  const title = document.title || '';
  const description = getMetaContent('meta[name="description"]') || '';

  // Extract canonical URL
  const canonicalLink = document.querySelector('link[rel="canonical"]');
  const canonical = resolveUrl(canonicalLink?.getAttribute('href') || null, baseUrl);

  // Extract language and locale
  const language = document.documentElement.getAttribute('lang') || null;
  const locale = getMetaContent('meta[property="og:locale"]') || null;

  // Extract favicon (prioritize shortcut icon over regular icon)
  const shortcutIcon = document.querySelector('link[rel="shortcut icon"]');
  const regularIcon = document.querySelector('link[rel="icon"]');
  const faviconHref = shortcutIcon?.getAttribute('href') || regularIcon?.getAttribute('href') || null;
  const favicon = resolveUrl(faviconHref, baseUrl);

  // Extract Open Graph metadata
  const og: EnhancedMetadata['og'] = {};
  const ogTitle = getMetaContent('meta[property="og:title"]');
  const ogDescription = getMetaContent('meta[property="og:description"]');
  const ogImage = getMetaContent('meta[property="og:image"]');
  const ogType = getMetaContent('meta[property="og:type"]');
  const ogUrl = getMetaContent('meta[property="og:url"]');

  if (ogTitle) og.title = ogTitle;
  if (ogDescription) og.description = ogDescription;
  if (ogImage) og.image = ogImage;
  if (ogType) og.type = ogType;
  if (ogUrl) og.url = ogUrl;

  // Extract Twitter Card metadata
  const twitter: EnhancedMetadata['twitter'] = {};
  const twitterCard = getMetaContent('meta[name="twitter:card"]');
  const twitterTitle = getMetaContent('meta[name="twitter:title"]');
  const twitterDescription = getMetaContent('meta[name="twitter:description"]');
  const twitterImage = getMetaContent('meta[name="twitter:image"]');
  const twitterSite = getMetaContent('meta[name="twitter:site"]');

  if (twitterCard) twitter.card = twitterCard;
  if (twitterTitle) twitter.title = twitterTitle;
  if (twitterDescription) twitter.description = twitterDescription;
  if (twitterImage) twitter.image = twitterImage;
  if (twitterSite) twitter.site = twitterSite;

  return {
    title,
    description,
    canonical,
    language,
    locale,
    favicon,
    og,
    twitter,
  };
}

/**
 * Generate a serialized version of extractEnhancedMetadata for browser evaluation.
 * This avoids duplicating the extraction logic — it converts the real function to a string.
 */
function buildEvaluateScript(): string {
  // Serialize the real function and invoke it with the browser's document
  return `(${extractEnhancedMetadata.toString()})(document)`;
}

/**
 * Extract enhanced metadata from a Playwright page
 * This is a wrapper that can be called from the renderer
 */
export async function extractMetadataFromPage(page: { evaluate: (fn: string) => Promise<EnhancedMetadata> }): Promise<EnhancedMetadata> {
  return page.evaluate(buildEvaluateScript());
}
