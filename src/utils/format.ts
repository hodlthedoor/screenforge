/** Shared format/content-type utilities for screenshots and PDFs. */

/** Maps content-type strings to file extensions. */
export const FORMAT_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Maps a user-facing format name to a file extension. */
export function getExtFromFormat(format: string): string {
  switch (format) {
    case 'jpeg': return 'jpg';
    case 'webp': return 'webp';
    case 'pdf': return 'pdf';
    default: return 'png';
  }
}

/** Derives the canonical format name from a content-type header. */
export function getFormatFromContentType(contentType: string): 'png' | 'jpeg' | 'webp' | 'pdf' {
  if (contentType.includes('pdf')) return 'pdf';
  if (contentType.includes('jpeg')) return 'jpeg';
  if (contentType.includes('webp')) return 'webp';
  return 'png';
}
