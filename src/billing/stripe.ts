import Stripe from 'stripe';
import { getConfig } from '../config/index.js';

let _stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (!_stripe) {
    const config = getConfig();
    if (!config.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    _stripe = new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: '2026-01-28.clover' });
  }
  return _stripe;
}

export function resetStripe(): void {
  _stripe = undefined;
}
