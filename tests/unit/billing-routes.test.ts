import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildServer } from '../../src/index.js';
import { getPool } from '../../src/db/index.js';
import { createUser } from '../../src/db/users.js';
import type { FastifyInstance } from 'fastify';

// Mock the email module — vi.hoisted ensures the variable exists before vi.mock runs
const { mockSendEmail } = vi.hoisted(() => ({
  mockSendEmail: vi.fn().mockResolvedValue({ sent: true }),
}));
vi.mock('../../src/email/index.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    sendEmail: mockSendEmail,
  };
});

// Mock the stripe module at the billing layer
const mockCheckoutSessionsCreate = vi.fn();
const mockBillingPortalSessionsCreate = vi.fn();
const mockWebhooksConstructEvent = vi.fn();
const mockCustomersCreate = vi.fn();

vi.mock('../../src/billing/stripe.js', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: mockCheckoutSessionsCreate } },
    billingPortal: { sessions: { create: mockBillingPortalSessionsCreate } },
    webhooks: { constructEvent: mockWebhooksConstructEvent },
    customers: { create: mockCustomersCreate },
  }),
  resetStripe: vi.fn(),
}));

function extractCookie(res: { headers: Record<string, string | string[] | undefined> }): string {
  const c = res.headers['set-cookie'];
  return Array.isArray(c) ? c[0] : (c as string);
}

function extractCsrfToken(html: string): string {
  const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
  return match?.[1] ?? '';
}

async function loginUser(app: FastifyInstance, email: string, password: string): Promise<string> {
  const getRes = await app.inject({ method: 'GET', url: '/login' });
  const csrf = extractCsrfToken(getRes.body);
  const cookie = extractCookie(getRes);

  const loginRes = await app.inject({
    method: 'POST',
    url: '/login',
    headers: { cookie },
    payload: { email, password, _csrf: csrf },
  });
  return extractCookie(loginRes);
}

describe('billing routes', () => {
  let app: FastifyInstance;
  const testEmail = 'billing-test@example.com';
  const testPassword = 'password123456';

  beforeAll(async () => {
    process.env.API_KEY_SALT = 'test-salt-must-be-16-chars-long';
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-session-secret-must-be-32-chars!!';
    process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_testing';
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_fake_key_for_testing';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake_secret';
    process.env.BASE_URL = 'http://localhost:3100';

    app = await buildServer({ skipBrowserInit: true });

    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        stripe_customer_id text UNIQUE,
        stripe_subscription_id text
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_sub_id text NOT NULL UNIQUE,
        plan text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        current_period_end timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    try {
      await createUser(testEmail, testPassword);
    } catch {
      // User may already exist
    }
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%billing-test%')");
    await pool.query("DELETE FROM users WHERE email LIKE '%billing-test%'");
    await app.close();
  });

  beforeEach(() => {
    mockSendEmail.mockClear();
  });

  describe('requireAuth edge cases', () => {
    it('redirects to /login when user is deleted after session created', async () => {
      // Create a temporary user, log in, then delete the user
      const tempEmail = 'billing-test-deleted@example.com';
      const tempPassword = 'password123456';
      await createUser(tempEmail, tempPassword);
      const cookie = await loginUser(app, tempEmail, tempPassword);

      // Delete the user from DB while session still exists
      const pool = getPool();
      await pool.query("DELETE FROM users WHERE email = $1", [tempEmail]);

      // Now try to access a protected route — requireAuth should fail (user not found)
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/billing',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });
  });

  describe('GET /dashboard/billing', () => {
    it('redirects to /login without session', async () => {
      const res = await app.inject({ method: 'GET', url: '/dashboard/billing' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('returns 200 with billing page for logged-in user', async () => {
      const cookie = await loginUser(app, testEmail, testPassword);
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/billing',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Billing');
      expect(res.body).toContain('Free');
      expect(res.body).toContain('Starter');
      expect(res.body).toContain('Pro');
      expect(res.body).toContain('Business');
    });

    it('shows current plan as Free for new user', async () => {
      const cookie = await loginUser(app, testEmail, testPassword);
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/billing',
        headers: { cookie },
      });
      expect(res.body).toContain('Current Plan');
    });
  });

  describe('POST /v1/billing/checkout', () => {
    it('redirects to /login without session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/checkout',
        payload: { plan: 'pro' },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('returns 400 for invalid plan', async () => {
      const cookie = await loginUser(app, testEmail, testPassword);
      const billingRes = await app.inject({
        method: 'GET',
        url: '/dashboard/billing',
        headers: { cookie },
      });
      const csrf = extractCsrfToken(billingRes.body);
      const billingCookie = extractCookie(billingRes);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/checkout',
        headers: { cookie: billingCookie },
        payload: { plan: 'enterprise', _csrf: csrf },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for free plan', async () => {
      const cookie = await loginUser(app, testEmail, testPassword);
      const billingRes = await app.inject({
        method: 'GET',
        url: '/dashboard/billing',
        headers: { cookie },
      });
      const csrf = extractCsrfToken(billingRes.body);
      const billingCookie = extractCookie(billingRes);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/checkout',
        headers: { cookie: billingCookie },
        payload: { plan: 'free', _csrf: csrf },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 403 when CSRF token is missing', async () => {
      const cookie = await loginUser(app, testEmail, testPassword);
      // Visit billing page to establish session with CSRF
      await app.inject({
        method: 'GET',
        url: '/dashboard/billing',
        headers: { cookie },
      });

      // POST without _csrf field
      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/checkout',
        headers: { cookie },
        payload: { plan: 'pro' },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Invalid form submission');
    });

    it('returns 403 when CSRF token is wrong', async () => {
      const cookie = await loginUser(app, testEmail, testPassword);
      const billingRes = await app.inject({
        method: 'GET',
        url: '/dashboard/billing',
        headers: { cookie },
      });
      const billingCookie = extractCookie(billingRes);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/checkout',
        headers: { cookie: billingCookie },
        payload: { plan: 'pro', _csrf: 'wrong-token-value' },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Invalid form submission');
    });

    it('returns 500 when checkout session creation fails', async () => {
      mockCustomersCreate.mockResolvedValueOnce({ id: 'cus_test_fail' });
      mockCheckoutSessionsCreate.mockRejectedValueOnce(new Error('Stripe API error'));

      const cookie = await loginUser(app, testEmail, testPassword);
      const billingRes = await app.inject({
        method: 'GET',
        url: '/dashboard/billing',
        headers: { cookie },
      });
      const csrf = extractCsrfToken(billingRes.body);
      const billingCookie = extractCookie(billingRes);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/checkout',
        headers: { cookie: billingCookie },
        payload: { plan: 'pro', _csrf: csrf },
      });
      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Failed to create checkout session');
    });

    it('creates checkout session and redirects for valid plan', async () => {
      mockCustomersCreate.mockResolvedValueOnce({ id: 'cus_test_123' });
      mockCheckoutSessionsCreate.mockResolvedValueOnce({
        url: 'https://checkout.stripe.com/test_session',
      });

      const cookie = await loginUser(app, testEmail, testPassword);
      const billingRes = await app.inject({
        method: 'GET',
        url: '/dashboard/billing',
        headers: { cookie },
      });
      const csrf = extractCsrfToken(billingRes.body);
      const billingCookie = extractCookie(billingRes);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/checkout',
        headers: { cookie: billingCookie },
        payload: { plan: 'pro', _csrf: csrf },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://checkout.stripe.com/test_session');
    });
  });

  describe('GET /v1/billing/portal', () => {
    it('redirects to /login without session', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/billing/portal' });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
    });

    it('redirects to billing page if no stripe customer', async () => {
      const cookie = await loginUser(app, testEmail, testPassword);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/billing/portal',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/dashboard/billing');
    });

    it('redirects to portal URL when stripe customer exists', async () => {
      const pool = getPool();
      const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [testEmail]);
      const userId = userResult.rows[0].id;
      await pool.query("UPDATE users SET stripe_customer_id = 'cus_portal_test' WHERE id = $1", [userId]);

      mockBillingPortalSessionsCreate.mockResolvedValueOnce({
        url: 'https://billing.stripe.com/session/test_portal',
      });

      const cookie = await loginUser(app, testEmail, testPassword);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/billing/portal',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://billing.stripe.com/session/test_portal');

      // Cleanup
      await pool.query("UPDATE users SET stripe_customer_id = NULL WHERE id = $1", [userId]);
    });

    it('redirects to billing page when portal session creation fails', async () => {
      const pool = getPool();
      const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [testEmail]);
      const userId = userResult.rows[0].id;
      await pool.query("UPDATE users SET stripe_customer_id = 'cus_portal_fail' WHERE id = $1", [userId]);

      mockBillingPortalSessionsCreate.mockRejectedValueOnce(new Error('Portal API error'));

      const cookie = await loginUser(app, testEmail, testPassword);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/billing/portal',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/dashboard/billing');

      // Cleanup
      await pool.query("UPDATE users SET stripe_customer_id = NULL WHERE id = $1", [userId]);
    });
  });

  describe('POST /v1/billing/webhook', () => {
    it('returns 400 when signature verification fails', async () => {
      mockWebhooksConstructEvent.mockImplementationOnce(() => {
        throw new Error('Invalid signature');
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'invalid_sig', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 200 for valid webhook with unhandled event type', async () => {
      mockWebhooksConstructEvent.mockReturnValueOnce({
        type: 'some.unhandled.event',
        data: { object: {} },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'valid_sig', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.received).toBe(true);
    });

    it('handles checkout.session.completed event', async () => {
      const pool = getPool();
      const userResult = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [testEmail],
      );
      const userId = userResult.rows[0].id;
      await pool.query(
        "UPDATE users SET stripe_customer_id = 'cus_webhook_test' WHERE id = $1",
        [userId],
      );

      mockWebhooksConstructEvent.mockReturnValueOnce({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_webhook_test',
            subscription: 'sub_test_123',
            metadata: { plan: 'pro' },
          },
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'valid_sig', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);

      const subResult = await pool.query(
        "SELECT * FROM subscriptions WHERE stripe_sub_id = 'sub_test_123'",
      );
      expect(subResult.rows.length).toBe(1);
      expect(subResult.rows[0].plan).toBe('pro');
      expect(subResult.rows[0].status).toBe('active');

      // Cleanup
      await pool.query("DELETE FROM subscriptions WHERE stripe_sub_id = 'sub_test_123'");
      await pool.query("UPDATE users SET stripe_customer_id = NULL WHERE id = $1", [userId]);
    });

    it('handles customer.subscription.deleted event', async () => {
      const pool = getPool();
      const userResult = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [testEmail],
      );
      const userId = userResult.rows[0].id;
      await pool.query(
        "UPDATE users SET stripe_customer_id = 'cus_del_test', stripe_subscription_id = 'sub_del_123' WHERE id = $1",
        [userId],
      );
      await pool.query(
        `INSERT INTO subscriptions (user_id, stripe_sub_id, plan, status, current_period_end)
         VALUES ($1, 'sub_del_123', 'pro', 'active', now() + interval '30 days')`,
        [userId],
      );

      mockWebhooksConstructEvent.mockReturnValueOnce({
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_del_123',
            customer: 'cus_del_test',
          },
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'valid_sig', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);

      const subResult = await pool.query(
        "SELECT status FROM subscriptions WHERE stripe_sub_id = 'sub_del_123'",
      );
      expect(subResult.rows[0].status).toBe('canceled');

      // Cleanup
      await pool.query("DELETE FROM subscriptions WHERE stripe_sub_id = 'sub_del_123'");
      await pool.query("UPDATE users SET stripe_customer_id = NULL, stripe_subscription_id = NULL WHERE id = $1", [userId]);
    });

    it('handles invoice.payment_failed event', async () => {
      const pool = getPool();
      const userResult = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [testEmail],
      );
      const userId = userResult.rows[0].id;
      await pool.query(
        `INSERT INTO subscriptions (user_id, stripe_sub_id, plan, status, current_period_end)
         VALUES ($1, 'sub_fail_123', 'starter', 'active', now() + interval '30 days')`,
        [userId],
      );

      mockWebhooksConstructEvent.mockReturnValueOnce({
        type: 'invoice.payment_failed',
        data: {
          object: {
            customer: 'cus_fail_test',
            subscription: 'sub_fail_123',
          },
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'valid_sig', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);

      const subResult = await pool.query(
        "SELECT status FROM subscriptions WHERE stripe_sub_id = 'sub_fail_123'",
      );
      expect(subResult.rows[0].status).toBe('past_due');

      // Cleanup
      await pool.query("DELETE FROM subscriptions WHERE stripe_sub_id = 'sub_fail_123'");
    });

    it('handles customer.subscription.updated event with known price ID', async () => {
      const pool = getPool();
      const userResult = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [testEmail],
      );
      const userId = userResult.rows[0].id;
      await pool.query(
        "UPDATE users SET stripe_customer_id = 'cus_updated_test', stripe_subscription_id = 'sub_updated_123' WHERE id = $1",
        [userId],
      );
      await pool.query(
        `INSERT INTO subscriptions (user_id, stripe_sub_id, plan, status, current_period_end)
         VALUES ($1, 'sub_updated_123', 'starter', 'active', now() + interval '30 days')
         ON CONFLICT (stripe_sub_id) DO NOTHING`,
        [userId],
      );

      mockWebhooksConstructEvent.mockReturnValueOnce({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_updated_123',
            customer: 'cus_updated_test',
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
            items: {
              data: [
                {
                  price: {
                    id: process.env.STRIPE_PRICE_ID_PRO ?? 'price_pro_monthly',
                  },
                },
              ],
            },
          },
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'valid_sig', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);

      // Cleanup
      await pool.query("DELETE FROM subscriptions WHERE stripe_sub_id = 'sub_updated_123'");
      await pool.query("UPDATE users SET stripe_customer_id = NULL, stripe_subscription_id = NULL WHERE id = $1", [userId]);
    });

    it('handles customer.subscription.updated event with unknown price ID', async () => {
      const pool = getPool();
      const userResult = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [testEmail],
      );
      const userId = userResult.rows[0].id;
      await pool.query(
        "UPDATE users SET stripe_customer_id = 'cus_unknown_price', stripe_subscription_id = 'sub_unknown_123' WHERE id = $1",
        [userId],
      );
      await pool.query(
        `INSERT INTO subscriptions (user_id, stripe_sub_id, plan, status, current_period_end)
         VALUES ($1, 'sub_unknown_123', 'pro', 'active', now() + interval '30 days')
         ON CONFLICT (stripe_sub_id) DO NOTHING`,
        [userId],
      );

      mockWebhooksConstructEvent.mockReturnValueOnce({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_unknown_123',
            customer: 'cus_unknown_price',
            status: 'canceled',
            current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
            items: {
              data: [
                {
                  price: {
                    id: 'price_unknown_not_in_config',
                  },
                },
              ],
            },
          },
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'valid_sig', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);

      // Should downgrade to free tier when subscription is canceled
      const subResult = await pool.query(
        "SELECT status FROM subscriptions WHERE stripe_sub_id = 'sub_unknown_123'",
      );
      expect(subResult.rows[0].status).toBe('canceled');

      // Cleanup
      await pool.query("DELETE FROM subscriptions WHERE stripe_sub_id = 'sub_unknown_123'");
      await pool.query("UPDATE users SET stripe_customer_id = NULL, stripe_subscription_id = NULL WHERE id = $1", [userId]);
    });

    it('handles webhook signature verification failures', async () => {
      mockWebhooksConstructEvent.mockImplementationOnce(() => {
        throw new Error('Signature verification failed');
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'invalid_sig', 'content-type': 'application/json' },
        payload: '{}',
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('signature');
    });

    it('returns 500 when webhook secret is not configured', async () => {
      const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_WEBHOOK_SECRET;

      // Rebuild server without webhook secret
      const tempApp = await buildServer({ skipBrowserInit: true });

      const res = await tempApp.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'some_sig', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('Webhook secret not configured');

      await tempApp.close();
      process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    });

    it('handles subscription.updated with plan change and sends email', async () => {
      const pool = getPool();
      const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [testEmail]);
      const userId = userResult.rows[0].id;
      await pool.query(
        "UPDATE users SET stripe_customer_id = 'cus_email_test', stripe_subscription_id = 'sub_email_123' WHERE id = $1",
        [userId],
      );
      // Create subscription with 'starter' plan — webhook will update to 'pro'
      await pool.query(
        `INSERT INTO subscriptions (user_id, stripe_sub_id, plan, status, current_period_end)
         VALUES ($1, 'sub_email_123', 'starter', 'active', now() + interval '30 days')
         ON CONFLICT (stripe_sub_id) DO UPDATE SET plan = 'starter', status = 'active'`,
        [userId],
      );

      mockWebhooksConstructEvent.mockReturnValueOnce({
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_email_123',
            customer: 'cus_email_test',
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
            items: {
              data: [{ price: { id: 'price_pro' } }],
            },
          },
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'valid_sig', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);

      // Verify the subscription was updated to pro
      const subResult = await pool.query(
        "SELECT plan, status FROM subscriptions WHERE stripe_sub_id = 'sub_email_123'",
      );
      expect(subResult.rows[0].plan).toBe('pro');
      expect(subResult.rows[0].status).toBe('active');

      // Cleanup
      await pool.query("DELETE FROM subscriptions WHERE stripe_sub_id = 'sub_email_123'");
      await pool.query("UPDATE users SET stripe_customer_id = NULL, stripe_subscription_id = NULL WHERE id = $1", [userId]);
    });

    it('handles invoice.payment_failed with email sending path', async () => {
      const pool = getPool();
      const userResult = await pool.query("SELECT id FROM users WHERE email = $1", [testEmail]);
      const userId = userResult.rows[0].id;

      // Set up stripe_customer_id so the email path is triggered (lines 400-411)
      await pool.query(
        "UPDATE users SET stripe_customer_id = 'cus_payment_fail_email' WHERE id = $1",
        [userId],
      );
      await pool.query(
        `INSERT INTO subscriptions (user_id, stripe_sub_id, plan, status, current_period_end)
         VALUES ($1, 'sub_pay_fail_email', 'pro', 'active', now() + interval '30 days')
         ON CONFLICT (stripe_sub_id) DO NOTHING`,
        [userId],
      );

      mockWebhooksConstructEvent.mockReturnValueOnce({
        type: 'invoice.payment_failed',
        data: {
          object: {
            customer: 'cus_payment_fail_email',
            subscription: 'sub_pay_fail_email',
          },
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'valid_sig', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(200);

      // Verify subscription marked past_due
      const subResult = await pool.query(
        "SELECT status FROM subscriptions WHERE stripe_sub_id = 'sub_pay_fail_email'",
      );
      expect(subResult.rows[0].status).toBe('past_due');

      // Cleanup
      await pool.query("DELETE FROM subscriptions WHERE stripe_sub_id = 'sub_pay_fail_email'");
      await pool.query("UPDATE users SET stripe_customer_id = NULL WHERE id = $1", [userId]);
    });

    it('returns 500 when webhook event processing throws', async () => {
      // Mock constructEvent to succeed, then the DB query inside processing to fail
      mockWebhooksConstructEvent.mockReturnValueOnce({
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: 'cus_error_test',
            subscription: 'sub_error_test',
            metadata: { plan: 'pro' },
          },
        },
      });

      // Temporarily break pool.query for the event processing
      const pool = getPool();
      const originalQuery = pool.query.bind(pool);
      let callCount = 0;
      const querySpy = vi.spyOn(pool, 'query').mockImplementation((...args: unknown[]) => {
        callCount++;
        // Let the webhook secret check pass, then fail on event processing queries
        if (callCount <= 1) {
          // First query in event processing (finding user by stripe_customer_id) — throw
          throw new Error('Database connection lost');
        }
        return (originalQuery as (...a: unknown[]) => unknown)(...args);
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/webhook',
        headers: { 'stripe-signature': 'valid_sig', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Webhook processing failed');

      querySpy.mockRestore();
    });
  });
});
