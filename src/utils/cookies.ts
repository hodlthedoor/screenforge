import type { FastifyRequest } from 'fastify';

const AB_VARIANTS = ['A', 'B'] as const;
export type AbVariant = (typeof AB_VARIANTS)[number];

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
