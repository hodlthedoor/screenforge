export interface Plan {
  name: string;
  tier: 'free' | 'starter' | 'pro' | 'business';
  priceMonthly: number;
  stripePriceId: string | null;
  rateLimit: number;
  monthlyQuota: number;
  maxSchedules: number;
  maxExtractionsDaily: number;
  maxAccessibilityDaily: number;
  // Token bucket configuration
  burstCapacity: number;
  refillRatePerMin: number;
}

export const PLANS: Record<string, Plan> = {
  free: {
    name: 'Free',
    tier: 'free',
    priceMonthly: 0,
    stripePriceId: null,
    rateLimit: 10,
    monthlyQuota: 100,
    maxSchedules: 3,
    maxExtractionsDaily: 10,
    maxAccessibilityDaily: 5,
    burstCapacity: 10,
    refillRatePerMin: 5,
  },
  starter: {
    name: 'Starter',
    tier: 'starter',
    priceMonthly: 29,
    stripePriceId: 'price_starter',
    rateLimit: 50,
    monthlyQuota: 5_000,
    maxSchedules: 10,
    maxExtractionsDaily: 50,
    maxAccessibilityDaily: 25,
    burstCapacity: 30,
    refillRatePerMin: 60,
  },
  pro: {
    name: 'Pro',
    tier: 'pro',
    priceMonthly: 79,
    stripePriceId: 'price_pro',
    rateLimit: 200,
    monthlyQuota: 25_000,
    maxSchedules: 50,
    maxExtractionsDaily: 100,
    maxAccessibilityDaily: 50,
    burstCapacity: 100,
    refillRatePerMin: 300,
  },
  business: {
    name: 'Business',
    tier: 'business',
    priceMonthly: 199,
    stripePriceId: 'price_business',
    rateLimit: 1_000,
    monthlyQuota: 999_999_999,
    maxSchedules: 999,
    maxExtractionsDaily: 1_000,
    maxAccessibilityDaily: 500,
    burstCapacity: 500,
    refillRatePerMin: 1500,
  },
};

export function getPlanByTier(tier: string): Plan | undefined {
  return PLANS[tier];
}

export function getPlanByPriceId(priceId: string): Plan | undefined {
  return Object.values(PLANS).find((p) => p.stripePriceId === priceId);
}
