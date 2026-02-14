export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title></head><body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#12121a;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden;">
<tr><td style="padding:32px 40px 24px;border-bottom:1px solid #1e1e2e;">
  <h1 style="margin:0;font-size:20px;color:#e0e0e8;">ScreenForge</h1>
</td></tr>
<tr><td style="padding:32px 40px;color:#e0e0e8;font-size:15px;line-height:1.6;">
${body}
</td></tr>
<tr><td style="padding:24px 40px;border-top:1px solid #1e1e2e;color:#8888a0;font-size:13px;">
  <p style="margin:0;">This email was sent by ScreenForge. If you didn't expect this, you can safely ignore it.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function btn(text: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;padding:12px 24px;background:#6c63ff;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">${text}</a>`;
}

export function renderWelcomeEmail(vars: {
  email: string;
  apiKeyPrefix: string;
  dashboardUrl: string;
  docsUrl: string;
}): EmailTemplate {
  return {
    subject: 'Welcome to ScreenForge!',
    html: wrap('Welcome to ScreenForge', `
  <p>Hi ${vars.email},</p>
  <p>Welcome to ScreenForge! Your account is ready. Here's your API key prefix: <code style="background:#1e1e2e;padding:2px 8px;border-radius:4px;color:#6c63ff;">${vars.apiKeyPrefix}</code></p>
  <p><strong>Quick start:</strong></p>
  <pre style="background:#1e1e2e;padding:16px;border-radius:8px;overflow-x:auto;color:#e0e0e8;font-size:13px;">curl "${vars.dashboardUrl.replace('/dashboard', '')}/v1/screenshot?url=https://example.com" \\
  -H "Authorization: Bearer YOUR_API_KEY"</pre>
  <p style="margin:24px 0;">${btn('Go to Dashboard', vars.dashboardUrl)}</p>
  <p>Read the <a href="${vars.docsUrl}" style="color:#6c63ff;">API documentation</a> to get started.</p>
`),
    text: `Welcome to ScreenForge!

Hi ${vars.email},

Your account is ready. API key prefix: ${vars.apiKeyPrefix}

Dashboard: ${vars.dashboardUrl}
API Docs: ${vars.docsUrl}

Quick start:
curl "${vars.dashboardUrl.replace('/dashboard', '')}/v1/screenshot?url=https://example.com" -H "Authorization: Bearer YOUR_API_KEY"`,
  };
}

export function renderEmailVerification(vars: {
  email: string;
  verifyUrl: string;
}): EmailTemplate {
  return {
    subject: 'Verify your ScreenForge email',
    html: wrap('Verify Your Email', `
  <p>Hi ${vars.email},</p>
  <p>Please verify your email address by clicking the button below. This link expires in 1 hour.</p>
  <p style="margin:24px 0;">${btn('Verify Email', vars.verifyUrl)}</p>
  <p style="color:#8888a0;font-size:13px;">Or copy this link: <a href="${vars.verifyUrl}" style="color:#6c63ff;">${vars.verifyUrl}</a></p>
`),
    text: `Verify your ScreenForge email

Hi ${vars.email},

Please verify your email by visiting:
${vars.verifyUrl}

This link expires in 1 hour.`,
  };
}

export function renderPasswordReset(vars: {
  email: string;
  resetUrl: string;
}): EmailTemplate {
  return {
    subject: 'Reset your ScreenForge password',
    html: wrap('Reset Your Password', `
  <p>Hi ${vars.email},</p>
  <p>We received a request to reset your password. Click the button below to set a new password. This link expires in 1 hour.</p>
  <p style="margin:24px 0;">${btn('Reset Password', vars.resetUrl)}</p>
  <p style="color:#8888a0;font-size:13px;">Or copy this link: <a href="${vars.resetUrl}" style="color:#6c63ff;">${vars.resetUrl}</a></p>
  <p style="color:#8888a0;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
`),
    text: `Reset your ScreenForge password

Hi ${vars.email},

We received a request to reset your password. Visit this link to set a new one:
${vars.resetUrl}

This link expires in 1 hour. If you didn't request this, ignore this email.`,
  };
}

export function renderQuotaWarning(vars: {
  email: string;
  currentUsage: number;
  monthlyQuota: number;
  percentage: number;
  upgradeUrl: string;
}): EmailTemplate {
  return {
    subject: `ScreenForge: You've used ${vars.percentage}% of your monthly quota`,
    html: wrap('Usage Warning', `
  <p>Hi ${vars.email},</p>
  <p>You've used <strong>${vars.percentage}%</strong> of your monthly render quota.</p>
  <table style="width:100%;margin:16px 0;border-collapse:collapse;">
    <tr><td style="color:#8888a0;padding:4px 0;">Current usage</td><td style="text-align:right;color:#e0e0e8;font-weight:600;">${fmt(vars.currentUsage)} renders</td></tr>
    <tr><td style="color:#8888a0;padding:4px 0;">Monthly limit</td><td style="text-align:right;color:#e0e0e8;font-weight:600;">${fmt(vars.monthlyQuota)} renders</td></tr>
  </table>
  <p>Upgrade your plan to increase your limit and avoid disruptions.</p>
  <p style="margin:24px 0;">${btn('Upgrade Plan', vars.upgradeUrl)}</p>
`),
    text: `ScreenForge: You've used ${vars.percentage}% of your monthly quota

Hi ${vars.email},

Current usage: ${fmt(vars.currentUsage)} / ${fmt(vars.monthlyQuota)} renders (${vars.percentage}%)

Upgrade your plan to increase your limit: ${vars.upgradeUrl}`,
  };
}

export function renderQuotaExceeded(vars: {
  email: string;
  currentUsage: number;
  monthlyQuota: number;
  upgradeUrl: string;
}): EmailTemplate {
  return {
    subject: 'ScreenForge: Monthly quota exceeded',
    html: wrap('Quota Exceeded', `
  <p>Hi ${vars.email},</p>
  <p>You've <strong style="color:#ff4466;">exceeded</strong> your monthly render quota. API requests will be throttled until the next billing cycle.</p>
  <table style="width:100%;margin:16px 0;border-collapse:collapse;">
    <tr><td style="color:#8888a0;padding:4px 0;">Current usage</td><td style="text-align:right;color:#ff4466;font-weight:600;">${fmt(vars.currentUsage)} renders</td></tr>
    <tr><td style="color:#8888a0;padding:4px 0;">Monthly limit</td><td style="text-align:right;color:#e0e0e8;font-weight:600;">${fmt(vars.monthlyQuota)} renders</td></tr>
  </table>
  <p>Upgrade now to restore full access immediately.</p>
  <p style="margin:24px 0;">${btn('Upgrade Now', vars.upgradeUrl)}</p>
`),
    text: `ScreenForge: Monthly quota exceeded

Hi ${vars.email},

You've exceeded your monthly render quota.
Current usage: ${fmt(vars.currentUsage)} / ${fmt(vars.monthlyQuota)} renders

API requests will be throttled until the next billing cycle.
Upgrade to restore access: ${vars.upgradeUrl}`,
  };
}

export function renderPaymentFailed(vars: {
  email: string;
  billingUrl: string;
}): EmailTemplate {
  return {
    subject: 'ScreenForge: Payment failed — action required',
    html: wrap('Payment Failed', `
  <p>Hi ${vars.email},</p>
  <p>We were unable to process your latest payment. Please update your billing information to avoid service interruption.</p>
  <p style="margin:24px 0;">${btn('Update Billing', vars.billingUrl)}</p>
  <p style="color:#8888a0;font-size:13px;">If your payment method has changed, please update it in the billing portal. If you believe this is an error, please contact support.</p>
`),
    text: `ScreenForge: Payment failed — action required

Hi ${vars.email},

We were unable to process your latest payment. Please update your billing information to avoid service interruption.

Update billing: ${vars.billingUrl}`,
  };
}

export function renderSubscriptionChanged(vars: {
  email: string;
  oldPlan: string;
  newPlan: string;
  dashboardUrl: string;
}): EmailTemplate {
  return {
    subject: 'ScreenForge: Your plan has changed',
    html: wrap('Plan Changed', `
  <p>Hi ${vars.email},</p>
  <p>Your subscription has been updated:</p>
  <table style="width:100%;margin:16px 0;border-collapse:collapse;">
    <tr><td style="color:#8888a0;padding:4px 0;">Previous plan</td><td style="text-align:right;color:#e0e0e8;">${vars.oldPlan}</td></tr>
    <tr><td style="color:#8888a0;padding:4px 0;">New plan</td><td style="text-align:right;color:#6c63ff;font-weight:600;">${vars.newPlan}</td></tr>
  </table>
  <p style="margin:24px 0;">${btn('View Billing', vars.dashboardUrl)}</p>
`),
    text: `ScreenForge: Your plan has changed

Hi ${vars.email},

Your subscription has been updated:
Previous plan: ${vars.oldPlan}
New plan: ${vars.newPlan}

View billing: ${vars.dashboardUrl}`,
  };
}
