export interface Plan {
  name: string;
  tier: 'free' | 'starter' | 'pro' | 'business';
  priceMonthly: number;
  stripePriceId: string | null;
  rateLimit: number;
  monthlyQuota: number;
}

export const PLANS: Record<string, Plan> = {
  free: {
    name: 'Free',
    tier: 'free',
    priceMonthly: 0,
    stripePriceId: null,
    rateLimit: 10,
    monthlyQuota: 1_000,
  },
  starter: {
    name: 'Starter',
    tier: 'starter',
    priceMonthly: 9,
    stripePriceId: 'price_starter',
    rateLimit: 50,
    monthlyQuota: 10_000,
  },
  pro: {
    name: 'Pro',
    tier: 'pro',
    priceMonthly: 29,
    stripePriceId: 'price_pro',
    rateLimit: 200,
    monthlyQuota: 100_000,
  },
  business: {
    name: 'Business',
    tier: 'business',
    priceMonthly: 99,
    stripePriceId: 'price_business',
    rateLimit: 1_000,
    monthlyQuota: 1_000_000,
  },
};

export function getPlanByTier(tier: string): Plan | undefined {
  return PLANS[tier];
}

export function getPlanByPriceId(priceId: string): Plan | undefined {
  return Object.values(PLANS).find((p) => p.stripePriceId === priceId);
}
