import { randomBytes } from 'node:crypto';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}
