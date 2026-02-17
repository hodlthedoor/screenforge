import type { FastifyRequest } from 'fastify';

export type AbVariant = 'A' | 'B';

/** Parse the ab_variant cookie from a request, returning 'A' | 'B' | undefined */
export function getAbVariantFromCookie(req: FastifyRequest): AbVariant | undefined {
  const cookie = (req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('ab_variant='));
  const value = cookie?.split('=')?.[1]?.trim();
  if (value === 'A' || value === 'B') return value;
  return undefined;
}
