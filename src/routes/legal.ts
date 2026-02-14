import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

function legalStyles(): string {
  return `*{margin:0;padding:0;box-sizing:border-box}
    :root{--bg:#f5f7ff;--surface:#ffffff;--border:#d6ddf7;--text:#1d2238;--muted:#5b6488;--accent:#4f46e5}
    body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);line-height:1.7}
    a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
    .nav{border-bottom:1px solid var(--border);padding:16px 0;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(8px)}
    .nav-wrap{display:flex;justify-content:space-between;align-items:center;gap:16px;max-width:900px;margin:0 auto;padding:0 24px}
    .content{max-width:900px;margin:0 auto;padding:48px 24px}
    h1{font-size:2rem;margin-bottom:8px}
    .subtitle{color:var(--muted);margin-bottom:32px}
    h2{font-size:1.3rem;margin:28px 0 12px;color:var(--accent)}
    p,ul{margin-bottom:16px;color:var(--text)}
    ul{padding-left:24px}li{margin-bottom:6px}
    footer{border-top:1px solid var(--border);padding:32px 0;color:var(--muted);font-size:.9rem;text-align:center}
    @media(prefers-color-scheme:dark){
      :root{--bg:#0b0d15;--surface:#121625;--border:#232b45;--text:#e2e8ff;--muted:#9ea8c8;--accent:#7a72ff}
      body{background:#090c16}
    }`;
}

function navHtml(): string {
  return `<nav class="nav"><div class="nav-wrap">
    <a href="/" style="font-weight:700;font-size:1.2rem;color:var(--text)">ScreenForge</a>
    <a href="/">Back to Home</a>
  </div></nav>`;
}

function termsHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Terms of Service — ScreenForge</title>
<style>${legalStyles()}</style></head><body>
${navHtml()}
<div class="content">
  <h1>Terms of Service</h1>
  <p class="subtitle">Last updated: February 2026</p>

  <h2>1. Service Description</h2>
  <p>ScreenForge is a screenshot and render API that captures web page screenshots, generates PDFs, and creates Open Graph images. The service is available as a hosted platform and a self-hosted Docker deployment.</p>

  <h2>2. Acceptable Use</h2>
  <p>You agree to use ScreenForge only for lawful purposes. You must not:</p>
  <ul>
    <li>Use the service to capture content you are not authorized to access</li>
    <li>Attempt to bypass rate limits or authentication mechanisms</li>
    <li>Submit URLs that host malware, phishing, or illegal content</li>
    <li>Reverse-engineer, decompile, or interfere with the service infrastructure</li>
  </ul>

  <h2>3. API Key Responsibilities</h2>
  <p>Your API key is confidential. You are responsible for all activity performed with your API key. If you suspect unauthorized use, rotate your key immediately from your dashboard. Do not share your API key in public repositories or client-side code.</p>

  <h2>4. Rate Limits</h2>
  <p>Each plan has a defined rate limit and monthly render quota. Exceeding your rate limit will result in HTTP 429 responses. Exceeding your monthly quota will block further renders until the next billing cycle. Upgrading your plan increases both limits immediately.</p>

  <h2>5. Data Retention</h2>
  <p>Rendered output files (screenshots and PDFs) from async and batch render jobs are stored for 30 days, after which they are automatically deleted. Synchronous renders are streamed directly and not stored on our servers.</p>

  <h2>6. Limitation of Liability</h2>
  <p>ScreenForge is provided "as is" without warranty of any kind. We are not liable for any indirect, incidental, or consequential damages arising from your use of the service, including but not limited to loss of data, revenue, or business opportunities. Our total liability is limited to the amount you paid for the service in the 12 months preceding the claim.</p>

  <h2>7. Termination</h2>
  <p>We may suspend or terminate your account at any time if you violate these terms. You may delete your account at any time from your account settings. Upon termination, your data will be deleted within 30 days. Termination does not entitle you to a refund for the current billing period.</p>

  <h2>8. Changes to Terms</h2>
  <p>We may update these terms from time to time. Continued use of the service after changes constitutes acceptance of the updated terms. We will notify registered users of material changes via email.</p>
</div>
<footer>ScreenForge — <a href="/privacy">Privacy Policy</a></footer>
</body></html>`;
}

function privacyHtml(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Privacy Policy — ScreenForge</title>
<style>${legalStyles()}</style></head><body>
${navHtml()}
<div class="content">
  <h1>Privacy Policy</h1>
  <p class="subtitle">Last updated: February 2026</p>

  <h2>1. Data We Collect</h2>
  <p>We collect the minimum data necessary to operate the service:</p>
  <ul>
    <li><strong>Account data:</strong> email address, bcrypt password hash</li>
    <li><strong>API keys:</strong> hashed API key values and human-readable prefixes</li>
    <li><strong>Render data:</strong> URLs submitted for rendering, output file metadata</li>
    <li><strong>Usage data:</strong> IP address (for rate limiting), request timestamps, render counts</li>
  </ul>

  <h2>2. How We Use Your Data</h2>
  <p>Your data is used to authenticate requests, enforce rate limits, process renders, generate billing invoices, and send transactional emails (password resets, billing alerts, usage notifications).</p>

  <h2>3. Third-Party Services</h2>
  <p>We do not sell or share your personal data with third-party advertisers. The only third-party service that receives your data is <strong>Stripe</strong>, which processes billing and subscription payments. Stripe's privacy policy governs their handling of your payment information.</p>

  <h2>4. Cookies</h2>
  <p>We use session-only cookies to maintain your login state on the dashboard. These cookies are HTTP-only, have no tracking purpose, and expire when your session ends or after 7 days of inactivity. We do not use analytics cookies or third-party tracking scripts.</p>

  <h2>5. Data Security</h2>
  <p>Passwords are hashed with bcrypt. API keys are stored as SHA-256 hashes. All connections use HTTPS. Render output files are stored with unique signed URLs that expire after the retention period.</p>

  <h2>6. GDPR &amp; Data Deletion</h2>
  <p>Under GDPR, you have the right to access, correct, or delete your personal data. You can delete your account and all associated data from your account settings page. Account deletion removes your email, API keys, render history, and billing records within 30 days. To request a data export, contact us at the email address listed on our homepage.</p>

  <h2>7. Data Retention</h2>
  <p>Account data is retained for the lifetime of your account. Render output files are deleted after 30 days. Server logs containing IP addresses are retained for 90 days for security purposes, then permanently deleted.</p>

  <h2>8. Changes to This Policy</h2>
  <p>We may update this privacy policy from time to time. We will notify registered users of material changes via email. Continued use of the service constitutes acceptance of the updated policy.</p>
</div>
<footer>ScreenForge — <a href="/terms">Terms of Service</a></footer>
</body></html>`;
}

export async function legalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/terms', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.type('text/html').send(termsHtml());
  });

  app.get('/privacy', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.type('text/html').send(privacyHtml());
  });
}
