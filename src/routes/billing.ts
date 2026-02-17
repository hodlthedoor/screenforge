import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../db/index.js';
import { getConfig } from '../config/index.js';
import { getStripe } from '../billing/stripe.js';
import { PLANS, getPlanByPriceId } from '../billing/plans.js';
import { getUserById } from '../db/users.js';
import { escapeHtml, generateCsrfToken } from '../utils/html.js';
import { sendEmail, getSmtpConfig } from '../email/index.js';
import { renderSubscriptionChanged, renderPaymentFailed } from '../email/templates.js';

async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    return reply.redirect('/login');
  }
  const user = await getUserById(userId);
  if (!user) {
    req.session.destroy();
    return reply.redirect('/login');
  }
  req.dashboardUser = user;
}

function ensureCsrfToken(req: FastifyRequest): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  return req.session.csrfToken;
}

function verifyCsrf(req: FastifyRequest): boolean {
  const body = req.body as Record<string, string> | undefined;
  const token = body?._csrf;
  const expected = req.session.csrfToken;
  return !!token && !!expected && token === expected;
}

async function getUserCurrentPlan(userId: string): Promise<string> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT s.plan FROM subscriptions s
     WHERE s.user_id = $1 AND s.status IN ('active', 'trialing')
     ORDER BY s.created_at DESC LIMIT 1`,
    [userId],
  );
  return result.rows[0]?.plan ?? 'free';
}

async function getOrCreateStripeCustomer(userId: string, email: string): Promise<string> {
  const pool = getPool();
  const result = await pool.query(
    'SELECT stripe_customer_id FROM users WHERE id = $1',
    [userId],
  );

  if (result.rows[0]?.stripe_customer_id) {
    return result.rows[0].stripe_customer_id;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({ email, metadata: { userId } });
  await pool.query(
    'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
    [customer.id, userId],
  );
  return customer.id;
}

async function updateUserTier(userId: string, tier: string): Promise<void> {
  const pool = getPool();
  const plan = PLANS[tier];
  if (!plan) return;

  await pool.query(
    `UPDATE api_keys SET tier = $1, rate_limit = $2, monthly_quota = $3
     FROM user_api_keys
     WHERE api_keys.id = user_api_keys.api_key_id
       AND user_api_keys.user_id = $4
       AND api_keys.active = true`,
    [plan.tier, plan.rateLimit, plan.monthlyQuota, userId],
  );
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  // Dashboard billing page
  app.get('/dashboard/billing', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.dashboardUser!;
    const csrfToken = ensureCsrfToken(req);
    const query = req.query as Record<string, string>;
    const currentPlan = await getUserCurrentPlan(user.id);
    const plan = PLANS[currentPlan] ?? PLANS.free;

    // Get usage stats
    const pool = getPool();
    const usageResult = await pool.query(
      `SELECT COALESCE(SUM(ud.count), 0) as total
       FROM usage_daily ud
       JOIN user_api_keys uak ON uak.api_key_id = ud.api_key_id
       WHERE uak.user_id = $1 AND ud.date >= date_trunc('month', CURRENT_DATE)`,
      [user.id],
    );
    const monthlyUsage = Number(usageResult.rows[0]?.total ?? 0);

    const usagePercent = plan.monthlyQuota > 0 ? Math.min(100, Math.round((monthlyUsage / plan.monthlyQuota) * 100)) : 0;

    const planCards = Object.values(PLANS).map((p) => {
      const isCurrent = p.tier === currentPlan;
      const isUpgrade = p.priceMonthly > plan.priceMonthly;
      const isDowngrade = p.priceMonthly < plan.priceMonthly && p.tier !== 'free';

      let button: string;
      if (isCurrent) {
        button = '<span class="badge badge-active">Current Plan</span>';
      } else if (p.tier === 'free') {
        button = currentPlan !== 'free'
          ? `<a href="/v1/billing/portal" class="btn btn-sm" style="background:var(--border);color:var(--text)">Manage</a>`
          : '';
      } else {
        button = `<form method="POST" action="/v1/billing/checkout" style="display:inline">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <input type="hidden" name="plan" value="${p.tier}">
          <button type="submit" class="btn btn-primary btn-sm">${isUpgrade ? 'Upgrade' : isDowngrade ? 'Change' : 'Subscribe'}</button>
        </form>`;
      }

      return `<div class="card" style="text-align:center;${isCurrent ? 'border-color:var(--accent);' : ''}">
        <h3 style="margin-bottom:8px">${escapeHtml(p.name)}</h3>
        <div style="font-size:2rem;font-weight:700;margin-bottom:4px">$${p.priceMonthly}<span style="font-size:.9rem;color:var(--muted)">/mo</span></div>
        <div style="color:var(--muted);font-size:.85rem;margin-bottom:16px">
          ${p.monthlyQuota.toLocaleString()} renders/mo<br>
          ${p.rateLimit} req/min
        </div>
        ${button}
      </div>`;
    }).join('');

    const html = `
      <h1>Billing</h1>
      <div class="card" style="margin-bottom:24px">
        <h2 style="margin-bottom:16px">Current Plan</h2>
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
          <span style="font-size:1.4rem;font-weight:700">${escapeHtml(plan.name)}</span>
          <span class="badge badge-active">${currentPlan === 'free' ? 'Free' : 'Active'}</span>
        </div>
        <div style="margin-bottom:8px;color:var(--muted);font-size:.9rem">
          Usage this month: ${monthlyUsage.toLocaleString()} / ${plan.monthlyQuota.toLocaleString()} renders (${usagePercent}%)
        </div>
        <div style="background:var(--bg);border-radius:6px;height:8px;overflow:hidden">
          <div style="background:${usagePercent > 90 ? 'var(--err)' : usagePercent > 70 ? 'var(--warn)' : 'var(--accent)'};height:100%;width:${usagePercent}%;transition:width .3s"></div>
        </div>
        ${currentPlan !== 'free' ? `<div style="margin-top:16px"><a href="/v1/billing/portal" class="btn btn-sm" style="background:var(--border);color:var(--text)">Manage Subscription</a></div>` : ''}
      </div>
      ${query.success ? `<div style="background:#d1fae5;color:#065f46;border:1px solid #6ee7b7;border-radius:8px;padding:12px 16px;margin-bottom:16px">Subscription activated! Your plan has been upgraded.</div>` : ''}
      ${query.canceled ? `<div style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:8px;padding:12px 16px;margin-bottom:16px">Checkout canceled. No changes were made.</div>` : ''}
      ${query.error === 'checkout_failed' ? `<div style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:8px;padding:12px 16px;margin-bottom:16px">Billing is not configured on this instance. Contact the administrator to enable Stripe.</div>` : ''}
      <h2 style="margin-bottom:16px">Plans</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px">
        ${planCards}
      </div>`;

    await req.session.save();
    return reply.type('text/html').send(billingLayout('Billing', html, csrfToken));
  });

  // GET /v1/billing/checkout — redirect to login (landing page links use GET)
  app.get('/v1/billing/checkout', async (req, reply) => {
    const userId = req.session.userId;
    if (!userId) {
      return reply.redirect('/register');
    }
    return reply.redirect('/dashboard/billing');
  });

  // Create Stripe Checkout session
  app.post('/v1/billing/checkout', { preHandler: requireAuth }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).type('application/json').send({ error: 'Invalid form submission' });
    }

    const { plan: planTier } = req.body as { plan: string; _csrf: string };
    const targetPlan = PLANS[planTier];

    if (!targetPlan || !targetPlan.stripePriceId) {
      return reply.status(400).type('application/json').send({ error: 'Invalid plan. Choose starter, pro, or business.' });
    }

    const user = req.dashboardUser!;

    try {
      const customerId = await getOrCreateStripeCustomer(user.id, user.email);
      const stripe = getStripe();

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: targetPlan.stripePriceId, quantity: 1 }],
        success_url: `${config.BASE_URL}/dashboard/billing?success=true`,
        cancel_url: `${config.BASE_URL}/dashboard/billing?canceled=true`,
        metadata: { userId: user.id, plan: targetPlan.tier },
      });

      req.session.csrfToken = generateCsrfToken();
      await req.session.save();
      return reply.redirect(session.url!);
    } catch (err) {
      app.log.error(err, 'Failed to create checkout session');
      return reply.redirect('/dashboard/billing?error=checkout_failed');
    }
  });

  // Stripe Customer Portal redirect
  app.get('/v1/billing/portal', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.dashboardUser!;
    const pool = getPool();

    const result = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE id = $1',
      [user.id],
    );

    const customerId = result.rows[0]?.stripe_customer_id;
    if (!customerId) {
      return reply.redirect('/dashboard/billing');
    }

    try {
      const stripe = getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${config.BASE_URL}/dashboard/billing`,
      });
      return reply.redirect(session.url);
    } catch (err) {
      app.log.error(err, 'Failed to create portal session');
      return reply.redirect('/dashboard/billing');
    }
  });

  // Stripe webhook handler
  app.post('/v1/billing/webhook', {
    schema: {
      tags: ['billing'],
      summary: 'Stripe webhook',
      description: 'Handle Stripe webhook events for subscription management.',
    },
    config: { rawBody: true },
  }, async (req, reply) => {
    const webhookSecret = config.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return reply.status(500).send({ error: 'Webhook secret not configured' });
    }

    const sig = req.headers['stripe-signature'] as string;
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    let event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      app.log.warn({ err }, 'Webhook signature verification failed');
      return reply.status(400).send({ error: 'Invalid webhook signature' });
    }

    const pool = getPool();

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as {
            customer: string;
            subscription: string;
            metadata: { plan?: string; userId?: string };
          };

          const customerId = session.customer;
          const subscriptionId = session.subscription;
          const plan = session.metadata?.plan ?? 'starter';

          // Find user by stripe customer ID
          const userResult = await pool.query(
            'SELECT id FROM users WHERE stripe_customer_id = $1',
            [customerId],
          );

          if (userResult.rows.length > 0) {
            const userId = userResult.rows[0].id;

            // Update user's subscription reference
            await pool.query(
              'UPDATE users SET stripe_subscription_id = $1 WHERE id = $2',
              [subscriptionId, userId],
            );

            // Upsert subscription record
            await pool.query(
              `INSERT INTO subscriptions (user_id, stripe_sub_id, plan, status, current_period_end)
               VALUES ($1, $2, $3, 'active', now() + interval '30 days')
               ON CONFLICT (stripe_sub_id) DO UPDATE SET plan = $3, status = 'active'`,
              [userId, subscriptionId, plan],
            );

            // Update API key tiers
            await updateUserTier(userId, plan);
          }
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as unknown as {
            id: string;
            customer: string;
            status: string;
            current_period_end: number;
            items: { data: Array<{ price: { id: string } }> };
          };

          const priceId = subscription.items?.data?.[0]?.price?.id;
          const plan = priceId ? getPlanByPriceId(priceId) : undefined;
          const status = subscription.status;
          const periodEnd = new Date(subscription.current_period_end * 1000);

          // Read old plan BEFORE updating so we can detect plan changes for email
          const oldSubResult = await pool.query(
            'SELECT user_id, plan FROM subscriptions WHERE stripe_sub_id = $1',
            [subscription.id],
          );
          const oldPlan = oldSubResult.rows[0]?.plan ?? 'free';

          // Update subscription record
          if (plan) {
            await pool.query(
              `UPDATE subscriptions SET plan = $1, status = $2, current_period_end = $3
               WHERE stripe_sub_id = $4`,
              [plan.tier, status, periodEnd, subscription.id],
            );
          } else {
            await pool.query(
              `UPDATE subscriptions SET status = $1, current_period_end = $2
               WHERE stripe_sub_id = $3`,
              [status, periodEnd, subscription.id],
            );
          }

          // Update user tier if subscription is active
          if (oldSubResult.rows.length > 0) {
            const userId = oldSubResult.rows[0].user_id;
            const tier = status === 'active' || status === 'trialing'
              ? (plan?.tier ?? 'free')
              : 'free';
            await updateUserTier(userId, tier);

            // Send subscription changed email
            if (plan) {
              const user = await getUserById(userId);
              if (user) {
                const oldPlanName = PLANS[oldPlan]?.name ?? oldPlan;
                const newPlanName = PLANS[plan.tier]?.name ?? plan.tier;
                if (oldPlanName !== newPlanName) {
                  const smtp = getSmtpConfig();
                  const template = renderSubscriptionChanged({
                    email: user.email,
                    oldPlan: oldPlanName,
                    newPlan: newPlanName,
                    dashboardUrl: `${config.BASE_URL}/dashboard/billing`,
                  });
                  void sendEmail({ to: user.email, ...template }, smtp);
                }
              }
            }
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as { id: string; customer: string };

          // Mark subscription as canceled
          await pool.query(
            "UPDATE subscriptions SET status = 'canceled' WHERE stripe_sub_id = $1",
            [subscription.id],
          );

          // Find user and downgrade to free
          const userResult = await pool.query(
            'SELECT id FROM users WHERE stripe_customer_id = $1',
            [subscription.customer],
          );
          if (userResult.rows.length > 0) {
            await pool.query(
              'UPDATE users SET stripe_subscription_id = NULL WHERE id = $1',
              [userResult.rows[0].id],
            );
            await updateUserTier(userResult.rows[0].id, 'free');
          }
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as unknown as { customer: string; subscription: string };

          if (invoice.subscription) {
            await pool.query(
              "UPDATE subscriptions SET status = 'past_due' WHERE stripe_sub_id = $1",
              [invoice.subscription],
            );
          }

          // Send payment failed email
          const failedUser = await pool.query(
            'SELECT id, email FROM users WHERE stripe_customer_id = $1',
            [invoice.customer],
          );
          if (failedUser.rows.length > 0) {
            const smtp = getSmtpConfig();
            const template = renderPaymentFailed({
              email: failedUser.rows[0].email,
              billingUrl: `${config.BASE_URL}/v1/billing/portal`,
            });
            void sendEmail({ to: failedUser.rows[0].email, ...template }, smtp);
          }
          break;
        }

        default:
          // Unhandled event type — that's fine
          break;
      }
    } catch (err) {
      app.log.error({ err, eventType: event.type }, 'Error processing webhook event');
      return reply.status(500).send({ error: 'Webhook processing failed' });
    }

    return reply.send({ received: true });
  });
}

function billingLayout(title: string, content: string, csrfToken: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)} — ScreenForge</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0a0a0f;--surface:#12121a;--border:#1e1e2e;--text:#e0e0e8;--muted:#8888a0;--accent:#6c63ff;--accent2:#00d4aa;--err:#ff4466;--warn:#ffaa33}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
  a{color:var(--accent);text-decoration:none}
  .layout{display:flex;min-height:100vh}
  .sidebar{width:220px;background:var(--surface);border-right:1px solid var(--border);padding:24px 0;flex-shrink:0}
  .sidebar .logo{padding:0 20px 24px;font-size:1.1rem;font-weight:700;border-bottom:1px solid var(--border);margin-bottom:16px}
  .sidebar a{display:block;padding:10px 20px;color:var(--muted);font-size:.95rem}
  .sidebar a:hover,.sidebar a.active{color:var(--text);background:rgba(108,99,255,.1)}
  .main{flex:1;padding:32px;overflow-x:auto}
  .main h1{font-size:1.8rem;margin-bottom:24px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:20px}
  .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:.8rem;font-weight:600}
  .badge-active{background:rgba(0,212,170,.15);color:var(--accent2)}
  .btn{display:inline-block;padding:8px 16px;border-radius:6px;font-size:.9rem;font-weight:600;border:none;cursor:pointer;transition:opacity .2s}
  .btn-primary{background:var(--accent);color:#fff}
  .btn-sm{padding:4px 12px;font-size:.8rem}
  @media(max-width:768px){.layout{flex-direction:column}.sidebar{width:100%;display:flex;overflow-x:auto;padding:12px 0}.sidebar a{white-space:nowrap}}
</style></head><body>
<div class="layout">
  <nav class="sidebar">
    <div class="logo">ScreenForge</div>
    <a href="/dashboard">Overview</a>
    <a href="/dashboard/keys">API Keys</a>
    <a href="/dashboard/usage">Usage</a>
    <a href="/dashboard/billing" class="active">Billing</a>
    <a href="/dashboard/settings">Settings</a>
    <a href="/docs">API Docs</a>
    <form method="POST" action="/logout" style="padding:10px 20px;margin-top:auto"><input type="hidden" name="_csrf" value="${csrfToken}"><button type="submit" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.95rem">Log Out</button></form>
  </nav>
  <main class="main">${content}</main>
</div></body></html>`;
}
