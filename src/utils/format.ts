/** Shared format/content-type utilities for screenshots and PDFs. */

/** Maps content-type strings to file extensions. */
export const FORMAT_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'image/gif': 'gif',
};

/** Maps a user-facing format name to a file extension. */
export function getExtFromFormat(format: string): string {
  switch (format) {
    case 'jpeg': return 'jpg';
    case 'webp': return 'webp';
    case 'avif': return 'avif';
    case 'pdf': return 'pdf';
    default: return 'png';
  }
}

/** Derives the canonical format name from a content-type header. */
export function getFormatFromContentType(contentType: string): 'png' | 'jpeg' | 'webp' | 'avif' | 'pdf' | 'gif' {
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('pdf')) return 'pdf';
  if (contentType.includes('avif')) return 'avif';
  if (contentType.includes('jpeg')) return 'jpeg';
  if (contentType.includes('webp')) return 'webp';
  return 'png';
}
