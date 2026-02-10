import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PLANS, getPlanByTier, getPlanByPriceId } from '../../src/billing/plans.js';

describe('billing plans', () => {
  describe('PLANS', () => {
    it('defines 4 plans: free, starter, pro, business', () => {
      expect(Object.keys(PLANS)).toEqual(['free', 'starter', 'pro', 'business']);
    });

    it('free plan has no Stripe price ID', () => {
      expect(PLANS.free.stripePriceId).toBeNull();
      expect(PLANS.free.priceMonthly).toBe(0);
    });

    it('paid plans have Stripe price IDs', () => {
      expect(PLANS.starter.stripePriceId).toBe('price_starter');
      expect(PLANS.pro.stripePriceId).toBe('price_pro');
      expect(PLANS.business.stripePriceId).toBe('price_business');
    });

    it('plans have correct pricing', () => {
      expect(PLANS.starter.priceMonthly).toBe(9);
      expect(PLANS.pro.priceMonthly).toBe(29);
      expect(PLANS.business.priceMonthly).toBe(99);
    });

    it('plans have increasing quotas', () => {
      expect(PLANS.free.monthlyQuota).toBeLessThan(PLANS.starter.monthlyQuota);
      expect(PLANS.starter.monthlyQuota).toBeLessThan(PLANS.pro.monthlyQuota);
      expect(PLANS.pro.monthlyQuota).toBeLessThan(PLANS.business.monthlyQuota);
    });

    it('plans have increasing rate limits', () => {
      expect(PLANS.free.rateLimit).toBeLessThan(PLANS.starter.rateLimit);
      expect(PLANS.starter.rateLimit).toBeLessThan(PLANS.pro.rateLimit);
      expect(PLANS.pro.rateLimit).toBeLessThan(PLANS.business.rateLimit);
    });
  });

  describe('getPlanByTier', () => {
    it('returns plan for valid tier', () => {
      const plan = getPlanByTier('pro');
      expect(plan).toBeDefined();
      expect(plan!.tier).toBe('pro');
      expect(plan!.priceMonthly).toBe(29);
    });

    it('returns undefined for invalid tier', () => {
      expect(getPlanByTier('enterprise')).toBeUndefined();
    });
  });

  describe('getPlanByPriceId', () => {
    it('returns plan for valid price ID', () => {
      const plan = getPlanByPriceId('price_pro');
      expect(plan).toBeDefined();
      expect(plan!.tier).toBe('pro');
    });

    it('returns undefined for unknown price ID', () => {
      expect(getPlanByPriceId('price_unknown')).toBeUndefined();
    });

    it('returns undefined for null price ID', () => {
      expect(getPlanByPriceId('')).toBeUndefined();
    });
  });
});

describe('stripe initialization', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getStripe throws when STRIPE_SECRET_KEY is not set', async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    delete process.env.STRIPE_SECRET_KEY;

    const { loadConfig } = await import('../../src/config/index.js');
    loadConfig();

    const { getStripe, resetStripe } = await import('../../src/billing/stripe.js');
    resetStripe();
    expect(() => getStripe()).toThrow('STRIPE_SECRET_KEY is not configured');
  });
});
