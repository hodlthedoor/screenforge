import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import { getConfig } from '../config/index.js';
import { getPool } from '../db/index.js';
import { getAbVariantFromCookie, type AbVariant } from '../utils/cookies.js';
import { escapeHtml } from '../utils/html.js';
import { getLogger } from '../logging/index.js';
import { APP_VERSION } from '../utils/version.js';

const AB_CTA: Record<AbVariant, { text: string; color: string }> = {
  A: { text: 'Get Started Free', color: 'btn-primary' },
  B: { text: 'Start Building Free', color: 'btn-primary btn-variant-b' },
};

function getOrAssignVariant(req: FastifyRequest): AbVariant {
  return getAbVariantFromCookie(req) ?? (Math.random() < 0.5 ? 'A' : 'B');
}

export async function trackAbEvent(variant: string, eventType: 'view' | 'signup'): Promise<void> {
  try {
    const pool = getPool();
    await pool.query('INSERT INTO ab_test_events (variant, event_type) VALUES ($1, $2)', [variant, eventType]);
  } catch (err) {
    try { getLogger('landing').warn({ err, variant, eventType }, 'Failed to track A/B event'); } catch { /* logger not registered yet */ }
  }
}

const SOCIAL_PROOF_CACHE_KEY = 'screenforge:social_proof:total_renders';
const SOCIAL_PROOF_TTL = 300; // 5 minutes

let cachedRedis: Redis | undefined;

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function getRedis(redisUrl: string): Redis {
  if (!cachedRedis || cachedRedis.status === 'end') {
    cachedRedis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
  }
  return cachedRedis;
}

async function getSocialProofCount(redisUrl: string): Promise<number> {
  try {
    const redis = getRedis(redisUrl);

    const cached = await redis.get(SOCIAL_PROOF_CACHE_KEY);
    if (cached !== null) {
      return parseInt(cached, 10) || 0;
    }

    const pool = getPool();
    const result = await pool.query('SELECT COALESCE(SUM(count), 0)::int AS total FROM usage_daily');
    const total = result.rows[0]?.total ?? 0;

    await redis.setex(SOCIAL_PROOF_CACHE_KEY, SOCIAL_PROOF_TTL, String(total));
    return total;
  } catch {
    return 0;
  }
}

interface LandingOptions {
  baseUrl: string;
  analyticsScript?: string;
  socialProofCount: number;
  abVariant: AbVariant;
}

function sanitizeAnalyticsScript(raw: string): string {
  // Only allow <script ...></script> or <script ... /> tags
  const scriptPattern = /^<script\s[^>]*(?:src=["'][^"']+["'])[^>]*(?:\/>|><\/script>)$/i;
  return scriptPattern.test(raw.trim()) ? raw.trim() : '';
}

function landingHtml(opts: LandingOptions): string {
  const safeBaseUrl = escapeHtml(opts.baseUrl);
  const analyticsTag = opts.analyticsScript ? sanitizeAnalyticsScript(opts.analyticsScript) : '';
  const renderCount = formatNumber(opts.socialProofCount);
  const cta = AB_CTA[opts.abVariant];

  const faqItems = [
    { q: 'Can I self-host ScreenForge?', a: 'Yes! ScreenForge is fully open source and self-hostable. Run it on your own infrastructure with a single docker compose up command. Your data never leaves your servers.' },
    { q: 'Is there a free tier?', a: 'Yes. The free tier includes 100 renders per month with webhook support — no credit card required. Perfect for prototyping and personal projects.' },
    { q: 'What are the rate limits?', a: 'Rate limits depend on your plan: Free allows 1 concurrent render, Starter allows 3, Pro allows 10, and Business offers unlimited concurrency. All plans include webhook callbacks for async workflows.' },
    { q: 'What output formats are supported?', a: 'ScreenForge supports PNG and JPEG screenshots, PDF generation (A4, Letter, Legal), and Open Graph card generation. All formats support full-page capture and custom viewports.' },
    { q: 'How does pricing compare to competitors?', a: 'ScreenForge offers more generous quotas at every price point. Our free tier includes 100 renders/month vs competitors offering 100 or fewer. Paid plans start at $29/month for 5,000 renders. Plus, self-hosting is completely free and unlimited.' },
    { q: 'Do you offer SDKs?', a: 'Yes. We provide official JavaScript and Python SDKs, plus a comprehensive REST API accessible via cURL or any HTTP client. All SDKs include TypeScript types.' },
    { q: 'Can I use webhooks for async rendering?', a: 'Yes. All plans include webhook support. Submit a render job, and ScreenForge will POST the result to your callback URL when complete. Batch jobs also support webhooks.' },
    { q: 'Is ScreenForge open source?', a: 'Yes. ScreenForge is MIT licensed and fully open source. You can inspect the code, contribute, or fork it. We are the only screenshot API that offers this transparency.' },
  ];

  const faqJsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ScreenForge — Screenshot &amp; Render API</title>
  <meta name="description" content="Capture screenshots, generate PDFs, and create OG cards with a single API call. Self-hostable, fast, and developer-friendly.">
  <link rel="canonical" href="${safeBaseUrl}/">
  <meta property="og:title" content="ScreenForge — Screenshot &amp; Render API">
  <meta property="og:description" content="Capture screenshots, generate PDFs, and create OG cards with a single API call. Self-hostable, fast, and developer-friendly.">
  <meta property="og:url" content="${safeBaseUrl}/">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${safeBaseUrl}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="ScreenForge — Screenshot &amp; Render API">
  <meta name="twitter:description" content="Capture screenshots, generate PDFs, and create OG cards with a single API call.">
  <meta name="twitter:image" content="${safeBaseUrl}/og-image.png">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "ScreenForge",
    "description": "Screenshot & Render API — capture screenshots, generate PDFs, and create OG cards with a single API call.",
    "url": "${safeBaseUrl}",
    "applicationCategory": "DeveloperApplication",
    "operatingSystem": "Any",
    "offers": [
      { "@type": "Offer", "name": "Free", "price": "0", "priceCurrency": "USD" },
      { "@type": "Offer", "name": "Starter", "price": "29", "priceCurrency": "USD" },
      { "@type": "Offer", "name": "Pro", "price": "79", "priceCurrency": "USD" },
      { "@type": "Offer", "name": "Business", "price": "199", "priceCurrency": "USD" }
    ]
  }
  </script>
  <script type="application/ld+json">
  ${faqJsonLd}
  </script>
  ${analyticsTag}
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--bg:#f5f7ff;--surface:#ffffff;--surface2:#edf1ff;--border:#d6ddf7;--text:#1d2238;--muted:#5b6488;--accent:#4f46e5;--accent2:#0ea5a0;--code-bg:#131828;--code-text:#dbe4ff;--green:#16a34a;--red:#dc2626}
    body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(180deg,var(--bg) 0%,#eef3ff 100%);color:var(--text);line-height:1.6}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    section{padding:64px 0}
    .container{max-width:1120px;margin:0 auto;padding:0 24px}
    .section-title{text-align:center;font-size:2rem;margin-bottom:16px}
    .section-subtitle{text-align:center;color:var(--muted);max-width:700px;margin:0 auto 40px}
    .btn{display:inline-block;padding:12px 28px;border-radius:10px;font-weight:600;font-size:1rem;transition:opacity .2s,transform .2s}
    .btn:hover{text-decoration:none;opacity:.95;transform:translateY(-1px)}
    .btn-primary{background:var(--accent);color:#fff}
    .btn-variant-b{background:linear-gradient(135deg,var(--accent),var(--accent2));box-shadow:0 4px 14px color-mix(in srgb,var(--accent) 30%,transparent)}
    .btn-secondary{background:var(--surface);color:var(--text);border:1px solid var(--border)}

    .nav{border-bottom:1px solid var(--border);padding:16px 0;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(8px)}
    .nav-wrap{display:flex;justify-content:space-between;align-items:center;gap:16px}
    .nav-links{display:flex;gap:16px;align-items:center;flex-wrap:wrap}

    .hero{text-align:center;padding:84px 0 70px}
    .hero h1{font-size:3.1rem;line-height:1.1;font-weight:800;letter-spacing:-1px;margin-bottom:16px}
    .hero h1 span{color:var(--accent)}
    .hero p{font-size:1.2rem;color:var(--muted);max-width:700px;margin:0 auto 32px}
    .cta-group{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}

    .social-proof-counter{text-align:center;margin-top:20px}
    .social-proof-counter .counter-value{font-size:1.8rem;font-weight:800;color:var(--accent)}
    .social-proof-counter .counter-label{color:var(--muted);font-size:.95rem}

    .feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
    .feature-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px}
    .feature-card h3{font-size:1.1rem;margin-bottom:8px;color:var(--accent2)}
    .feature-card p{color:var(--muted);font-size:.95rem}

    .code-section pre,.selfhost pre{background:var(--code-bg);border:1px solid color-mix(in srgb,var(--accent) 20%,var(--border));border-radius:14px;padding:24px;overflow-x:auto;font-size:.9rem;line-height:1.8;color:var(--code-text)}
    code .comment{color:#7f89ae}
    code .string{color:#65d8d6}

    .code-tabs{display:flex;gap:0;margin-bottom:0}
    .code-tab{padding:10px 20px;border:1px solid var(--border);background:var(--surface2);cursor:pointer;font-size:.9rem;font-weight:600;border-bottom:none;border-radius:10px 10px 0 0;color:var(--muted);transition:background .15s}
    .code-tab.active{background:var(--code-bg);color:var(--code-text)}
    .code-panel{display:none}
    .code-panel.active{display:block}
    .code-panel pre{border-radius:0 14px 14px 14px;margin-top:0;position:relative}
    .copy-btn{position:absolute;top:12px;right:12px;padding:6px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08);color:var(--code-text);cursor:pointer;font-size:.8rem;transition:background .15s}
    .copy-btn:hover{background:rgba(255,255,255,.15)}

    .pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px}
    .price-card{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px}
    .price-card.featured{border:2px solid var(--accent);box-shadow:0 10px 30px color-mix(in srgb,var(--accent) 20%,transparent)}
    .badge{position:absolute;top:-12px;right:16px;background:var(--accent2);color:#032826;padding:4px 10px;border-radius:999px;font-size:.75rem;font-weight:700}
    .price-card h3{font-size:1.25rem;margin-bottom:8px}
    .price-card .quota{color:var(--muted);font-size:.9rem;margin-bottom:12px}
    .price-card .price{font-size:2rem;font-weight:800;margin:12px 0 16px}
    .price-card .price span{font-size:.9rem;color:var(--muted);font-weight:500}
    .price-card ul{list-style:none;margin:0 0 20px;padding:0}
    .price-card ul li{padding:6px 0;color:var(--muted);font-size:.92rem}
    .price-card ul li::before{content:'\\2713 ';color:var(--accent2)}
    .price-card .btn{width:100%;text-align:center}

    .demo-wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:18px;align-items:start}
    .demo-panel,.demo-preview{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px}
    .demo-label{display:block;font-size:.9rem;color:var(--muted);margin-bottom:8px}
    .demo-input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--text)}
    .demo-actions{margin-top:12px;display:flex;gap:12px;align-items:center}
    .demo-status{font-size:.9rem;color:var(--muted)}
    .demo-preview img{width:100%;border-radius:10px;border:1px solid var(--border)}
    .demo-empty{color:var(--muted);font-size:.95rem}

    .comparison-wrap{overflow-x:auto}
    .comparison-table{width:100%;border-collapse:collapse;min-width:720px;background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden}
    .comparison-table th,.comparison-table td{padding:14px 16px;border-bottom:1px solid var(--border);text-align:left}
    .comparison-table th{background:var(--surface2);font-size:.95rem}
    .comparison-table td:not(:first-child),.comparison-table th:not(:first-child){text-align:center}
    .comparison-table .check{color:var(--green);font-weight:700}
    .comparison-table .cross{color:var(--red);font-weight:700}
    .comparison-table .highlight{background:color-mix(in srgb,var(--accent) 6%,var(--surface))}

    .testimonials-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
    .quote-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px}
    .quote-card p{color:var(--muted);font-size:.95rem;margin-bottom:12px}
    .quote-card strong{font-size:.95rem}

    .faq-list{max-width:800px;margin:0 auto}
    .faq-item{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px 24px;margin-bottom:12px}
    .faq-item h3{font-size:1.05rem;margin-bottom:8px;cursor:pointer}
    .faq-item p{color:var(--muted);font-size:.95rem}

    .selfhost{text-align:center}
    .selfhost p{color:var(--muted);margin-bottom:20px}

    footer{border-top:1px solid var(--border);padding:32px 0;color:var(--muted);font-size:.9rem}
    .footer-wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center}
    .footer-links{display:flex;gap:14px}

    @media (prefers-color-scheme: dark){
      :root{--bg:#0b0d15;--surface:#121625;--surface2:#171c2d;--border:#232b45;--text:#e2e8ff;--muted:#9ea8c8;--accent:#7a72ff;--accent2:#2dd4bf;--code-bg:#090d18;--code-text:#c9d6ff;--green:#4ade80;--red:#f87171}
      body{background:linear-gradient(180deg,#090c16 0%,#0f1424 100%)}
      .badge{color:#062320}
    }

    @media(max-width:768px){
      section{padding:52px 0}
      .hero h1{font-size:2.15rem}
      .hero p{font-size:1rem}
      .pricing-grid,.feature-grid,.testimonials-grid{grid-template-columns:1fr}
      .demo-wrap{grid-template-columns:1fr}
      .footer-wrap{flex-direction:column;align-items:flex-start}
      .nav-wrap{flex-direction:column;align-items:flex-start}
      .code-tabs{flex-wrap:wrap}
    }
    .skip-link{position:absolute;top:-100%;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:8px 20px;border-radius:0 0 8px 8px;z-index:9999;font-weight:600}
    .skip-link:focus{top:0}
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <nav class="nav" aria-label="Main navigation">
    <div class="container nav-wrap">
      <strong style="font-size:1.2rem">ScreenForge</strong>
      <div class="nav-links">
        <a href="/docs">Docs</a>
        <a href="/playground">Playground</a>
        <a href="/pricing">Pricing</a>
        <a href="/login" class="btn btn-secondary" style="padding:8px 20px">Log In</a>
        <a href="/register" class="btn btn-primary" style="padding:8px 20px">Get Started</a>
      </div>
    </div>
  </nav>

  <main id="main-content">
  <section class="hero">
    <div class="container">
      <h1><span>ScreenForge</span><br>Screenshot &amp; Render API</h1>
      <p>Capture screenshots, generate PDFs, and create OG cards with a single API call. Self-hostable, fast, and developer-friendly.</p>
      <div class="cta-group">
        <a href="/register" class="btn ${cta.color}" data-ab-variant="${opts.abVariant}">${cta.text}</a>
        <a href="/docs" class="btn btn-secondary">View Docs</a>
      </div>
      <div class="social-proof-counter" id="social-proof-counter">
        <span class="counter-value">${renderCount}</span>
        <span class="counter-label"> renders processed by developers worldwide</span>
      </div>
    </div>
  </section>

  <section class="features">
    <div class="container">
      <h2 class="section-title">Everything You Need</h2>
      <div class="feature-grid">
        <div class="feature-card">
          <h3>Screenshots</h3>
          <p>Full-page or element-level screenshots in PNG/JPEG. Configurable viewport, device emulation, wait conditions.</p>
        </div>
        <div class="feature-card">
          <h3>PDF Generation</h3>
          <p>Render any URL to PDF with custom page size, margins, headers/footers. A4, Letter, Legal formats.</p>
        </div>
        <div class="feature-card">
          <h3>OG Cards</h3>
          <p>Auto-generate Open Graph preview images from any URL. Light/dark themes, multiple templates.</p>
        </div>
        <div class="feature-card">
          <h3>Batch Rendering</h3>
          <p>Submit up to 50 renders in a single request. Track progress with polling or webhooks.</p>
        </div>
        <div class="feature-card">
          <h3>Caching</h3>
          <p>Content-hash deduplication with configurable TTL. Same content never rendered twice.</p>
        </div>
        <div class="feature-card">
          <h3>Webhooks</h3>
          <p>Get notified when async renders complete. Reliable delivery with job status callbacks.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="code-section">
    <div class="container">
      <h2 class="section-title">Simple API</h2>
      <div class="code-tabs">
        <button class="code-tab active" data-tab="curl" onclick="switchTab('curl')">cURL</button>
        <button class="code-tab" data-tab="javascript" onclick="switchTab('javascript')">JavaScript SDK</button>
        <button class="code-tab" data-tab="python" onclick="switchTab('python')">Python</button>
      </div>
      <div class="code-panel active" id="panel-curl">
        <pre style="position:relative"><code><span class="comment"># Take a screenshot</span>
curl -X POST ${safeBaseUrl}/v1/screenshot \\
  -H <span class="string">"Content-Type: application/json"</span> \\
  -H <span class="string">"x-api-key: YOUR_API_KEY"</span> \\
  -d '{"url": "<span class="string">https://example.com</span>", "format": "png"}' \\
  --output screenshot.png

<span class="comment"># Generate a PDF</span>
curl -X POST ${safeBaseUrl}/v1/pdf \\
  -H <span class="string">"Content-Type: application/json"</span> \\
  -H <span class="string">"x-api-key: YOUR_API_KEY"</span> \\
  -d '{"url": "<span class="string">https://example.com</span>", "format": "A4"}' \\
  --output page.pdf</code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
      </div>
      <div class="code-panel" id="panel-javascript">
        <pre style="position:relative"><code><span class="comment">// npm install @screenforge/sdk</span>
import { ScreenForge } from <span class="string">'@screenforge/sdk'</span>;

const sf = new ScreenForge({
  apiKey: <span class="string">'YOUR_API_KEY'</span>,
  baseUrl: <span class="string">'${safeBaseUrl}'</span>
});

<span class="comment">// Take a screenshot</span>
const screenshot = await sf.screenshot({
  url: <span class="string">'https://example.com'</span>,
  format: <span class="string">'png'</span>,
  fullPage: true
});

<span class="comment">// Generate a PDF</span>
const pdf = await sf.pdf({
  url: <span class="string">'https://example.com'</span>,
  format: <span class="string">'A4'</span>
});</code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
      </div>
      <div class="code-panel" id="panel-python">
        <pre style="position:relative"><code><span class="comment"># pip install requests</span>
import requests

<span class="comment"># Take a screenshot</span>
response = requests.post(
    <span class="string">'${safeBaseUrl}/v1/screenshot'</span>,
    headers={<span class="string">'x-api-key'</span>: <span class="string">'YOUR_API_KEY'</span>},
    json={<span class="string">'url'</span>: <span class="string">'https://example.com'</span>, <span class="string">'format'</span>: <span class="string">'png'</span>}
)

with open(<span class="string">'screenshot.png'</span>, <span class="string">'wb'</span>) as f:
    f.write(response.content)

<span class="comment"># Generate a PDF</span>
response = requests.post(
    <span class="string">'${safeBaseUrl}/v1/pdf'</span>,
    headers={<span class="string">'x-api-key'</span>: <span class="string">'YOUR_API_KEY'</span>},
    json={<span class="string">'url'</span>: <span class="string">'https://example.com'</span>, <span class="string">'format'</span>: <span class="string">'A4'</span>}
)

with open(<span class="string">'page.pdf'</span>, <span class="string">'wb'</span>) as f:
    f.write(response.content)</code><button class="copy-btn" onclick="copyCode(this)">Copy</button></pre>
      </div>
    </div>
  </section>

  <section class="pricing">
    <div class="container">
      <h2 class="section-title">Pricing</h2>
      <p class="section-subtitle">Scale from early experiments to high-volume production automation with predictable monthly pricing.</p>
      <div class="pricing-grid">
        <div class="price-card">
          <h3>Free</h3>
          <p class="quota">100 renders/mo</p>
          <div class="price">$0<span>/mo</span></div>
          <ul>
            <li>1 concurrent render</li>
            <li>Webhook support</li>
            <li>Basic support</li>
          </ul>
          <a class="btn btn-secondary" href="/register">Start free</a>
        </div>
        <div class="price-card">
          <h3>Starter</h3>
          <p class="quota">5,000 renders/mo</p>
          <div class="price">$29<span>/mo</span></div>
          <ul>
            <li>3 concurrent renders</li>
            <li>Webhook support</li>
            <li>Custom CSS/JS</li>
          </ul>
          <a class="btn btn-primary" href="/v1/billing/checkout?plan=starter">Choose Starter</a>
        </div>
        <div class="price-card featured">
          <span class="badge">Popular</span>
          <h3>Pro</h3>
          <p class="quota">25,000 renders/mo</p>
          <div class="price">$79<span>/mo</span></div>
          <ul>
            <li>10 concurrent renders</li>
            <li>Priority queue</li>
            <li>Priority support</li>
          </ul>
          <a class="btn btn-primary" href="/v1/billing/checkout?plan=pro">Choose Pro</a>
        </div>
        <div class="price-card">
          <h3>Business</h3>
          <p class="quota">Unlimited renders</p>
          <div class="price">$199<span>/mo</span></div>
          <ul>
            <li>Unlimited concurrency</li>
            <li>SLA-backed uptime</li>
            <li>Dedicated support channel</li>
          </ul>
          <a class="btn btn-primary" href="/v1/billing/checkout?plan=business">Talk to sales</a>
        </div>
      </div>
    </div>
  </section>

  <section class="demo">
    <div class="container">
      <h2 class="section-title">Try Live Demo</h2>
      <p class="section-subtitle">Paste a URL and preview a live screenshot from the ScreenForge API in a few seconds.</p>
      <div class="demo-wrap">
        <div class="demo-panel">
          <label class="demo-label" for="demo-url">Website URL</label>
          <input id="demo-url" class="demo-input" type="url" placeholder="https://example.com" value="https://example.com" />
          <div class="demo-actions">
            <button id="demo-submit" class="btn btn-primary" type="button">Capture Screenshot</button>
            <span id="demo-status" class="demo-status">Ready</span>
          </div>
        </div>
        <div id="demo-preview" class="demo-preview">
          <p class="demo-empty">Screenshot preview appears here.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="comparison">
    <div class="container">
      <h2 class="section-title">ScreenForge vs Competitors</h2>
      <p class="section-subtitle">See how ScreenForge compares to other screenshot APIs on the features that matter.</p>
      <div class="comparison-wrap">
        <table class="comparison-table competitor-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th class="highlight">ScreenForge</th>
              <th>ScreenshotOne</th>
              <th>Urlbox</th>
              <th>Browserless</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Pricing (starter)</td>
              <td class="highlight"><strong>$29/mo (5K)</strong></td>
              <td>$17/mo (2K)</td>
              <td>$9/mo (2K)</td>
              <td>Usage-based</td>
            </tr>
            <tr>
              <td>Free Tier</td>
              <td class="highlight"><strong>100/mo</strong></td>
              <td>100/mo</td>
              <td>None</td>
              <td>None</td>
            </tr>
            <tr>
              <td>Self-Hosted</td>
              <td class="highlight"><span class="check">Yes</span></td>
              <td><span class="cross">No</span></td>
              <td><span class="cross">No</span></td>
              <td><span class="check">Yes</span></td>
            </tr>
            <tr>
              <td>Open Source</td>
              <td class="highlight"><span class="check">Yes</span></td>
              <td><span class="cross">No</span></td>
              <td><span class="cross">No</span></td>
              <td><span class="check">Yes</span></td>
            </tr>
            <tr>
              <td>Screenshots</td>
              <td class="highlight"><span class="check">Yes</span></td>
              <td><span class="check">Yes</span></td>
              <td><span class="check">Yes</span></td>
              <td><span class="check">Yes</span></td>
            </tr>
            <tr>
              <td>PDFs</td>
              <td class="highlight"><span class="check">Yes</span></td>
              <td><span class="check">Yes</span></td>
              <td><span class="check">Yes</span></td>
              <td><span class="check">Yes</span></td>
            </tr>
            <tr>
              <td>OG Cards</td>
              <td class="highlight"><span class="check">Yes</span></td>
              <td><span class="cross">No</span></td>
              <td><span class="cross">No</span></td>
              <td><span class="cross">No</span></td>
            </tr>
            <tr>
              <td>Batch API</td>
              <td class="highlight"><span class="check">Yes</span></td>
              <td><span class="cross">No</span></td>
              <td><span class="check">Yes</span></td>
              <td><span class="cross">No</span></td>
            </tr>
            <tr>
              <td>Webhooks</td>
              <td class="highlight"><span class="check">Yes</span></td>
              <td><span class="check">Yes</span></td>
              <td><span class="check">Yes</span></td>
              <td><span class="cross">No</span></td>
            </tr>
            <tr>
              <td>SDKs</td>
              <td class="highlight"><span class="check">JS + Python</span></td>
              <td><span class="check">JS</span></td>
              <td><span class="check">JS</span></td>
              <td><span class="check">JS</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="comparison">
    <div class="container">
      <h2 class="section-title">Feature Comparison</h2>
      <div class="comparison-wrap">
        <table class="comparison-table">
          <thead>
            <tr>
              <th>Feature</th>
              <th>Free</th>
              <th>Starter</th>
              <th>Pro</th>
              <th>Business</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Concurrent renders</td>
              <td>1</td>
              <td>3</td>
              <td>10</td>
              <td>Unlimited</td>
            </tr>
            <tr>
              <td>Webhook support</td>
              <td>Yes</td>
              <td>Yes</td>
              <td>Yes</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Custom CSS/JS</td>
              <td>No</td>
              <td>Yes</td>
              <td>Yes</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Priority queue</td>
              <td>No</td>
              <td>No</td>
              <td>Yes</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>SLA</td>
              <td>No</td>
              <td>No</td>
              <td>99.9%</td>
              <td>99.99%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="testimonials">
    <div class="container">
      <h2 class="section-title">Trusted by teams shipping visuals at scale</h2>
      <div class="testimonials-grid">
        <article class="quote-card">
          <p>"ScreenForge replaced multiple brittle screenshot scripts and cut our rendering latency by half."</p>
          <strong>Product Engineering Lead, SaaS Company</strong>
        </article>
        <article class="quote-card">
          <p>"We ship weekly reports with generated PDFs and web previews from one API integration."</p>
          <strong>Operations Team, Fintech Startup</strong>
        </article>
        <article class="quote-card">
          <p>"Reliable webhook callbacks and queue prioritization made our async rendering pipeline predictable."</p>
          <strong>Platform Team, Enterprise IT</strong>
        </article>
      </div>
    </div>
  </section>

  <section class="faq-section" id="faq-section">
    <div class="container">
      <h2 class="section-title">Frequently Asked Questions</h2>
      <div class="faq-list">
${faqItems.map((item) => `        <div class="faq-item">
          <h3>${escapeHtml(item.q)}</h3>
          <p>${escapeHtml(item.a)}</p>
        </div>`).join('\n')}
      </div>
    </div>
  </section>

  <section class="selfhost">
    <div class="container">
      <h2 class="section-title">Self-Host in Seconds</h2>
      <p>Run ScreenForge on your own infrastructure. Full control, no data leaves your servers.</p>
      <pre><code>docker compose up -d</code></pre>
    </div>
  </section>

  </main>
  <footer>
    <div class="container footer-wrap">
      <p>ScreenForge v${escapeHtml(APP_VERSION)} — Open Source Screenshot &amp; Render API</p>
      <div class="footer-links">
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
      </div>
    </div>
  </footer>
  <script>
    function switchTab(tab) {
      document.querySelectorAll('.code-tab').forEach(function(el) {
        el.classList.toggle('active', el.getAttribute('data-tab') === tab);
      });
      document.querySelectorAll('.code-panel').forEach(function(el) {
        el.classList.toggle('active', el.id === 'panel-' + tab);
      });
    }

    function copyCode(btn) {
      var code = btn.parentElement.querySelector('code');
      if (!code) return;
      var text = code.textContent || '';
      navigator.clipboard.writeText(text).then(function() {
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
      });
    }

    var demoUrlInput = document.getElementById('demo-url');
    var demoButton = document.getElementById('demo-submit');
    var demoStatus = document.getElementById('demo-status');
    var demoPreview = document.getElementById('demo-preview');

    async function runDemo() {
      if (!demoUrlInput || !demoButton || !demoStatus || !demoPreview) return;
      var targetUrl = demoUrlInput.value.trim();
      if (!targetUrl) {
        demoStatus.textContent = 'Enter a URL first';
        return;
      }

      demoStatus.textContent = 'Rendering...';
      demoButton.disabled = true;
      demoPreview.innerHTML = '<p class="demo-empty">Generating screenshot preview...</p>';

      try {
        var response = await fetch('${safeBaseUrl}/v1/screenshot', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': 'sf_demo_public'
          },
          body: JSON.stringify({ url: targetUrl, format: 'png', fullPage: true })
        });

        if (!response.ok) {
          demoStatus.textContent = 'Demo unavailable';
          demoPreview.innerHTML = '<p class="demo-empty">Live demo is currently unavailable. Please try again later.</p>';
          return;
        }

        var blob = await response.blob();
        var imageUrl = URL.createObjectURL(blob);
        demoPreview.innerHTML = '<img src="' + imageUrl + '" alt="Screenshot preview" />';
        demoStatus.textContent = 'Done';
      } catch(e) {
        demoStatus.textContent = '';
        demoPreview.innerHTML = '<p class="demo-empty">Demo coming soon! Sign up to try the API.</p>';
      } finally {
        demoButton.disabled = false;
      }
    }

    if (demoButton) {
      demoButton.addEventListener('click', runDemo);
    }
  </script>
</body>
</html>`;
}

export async function landingRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    let socialProofCount = 0;
    try {
      socialProofCount = await getSocialProofCount(config.REDIS_URL);
    } catch {
      // Graceful fallback — show 0
    }

    const variant = getOrAssignVariant(req);

    // Set cookie if not already set
    const existingCookie = (req.headers.cookie ?? '')
      .split(';')
      .some((c) => c.trim().startsWith('ab_variant='));
    if (!existingCookie) {
      reply.header(
        'Set-Cookie',
        `ab_variant=${variant}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`,
      );
    }

    void trackAbEvent(variant, 'view');

    return reply
      .type('text/html')
      .header('Cache-Control', 'private, max-age=3600')
      .send(landingHtml({
        baseUrl: config.BASE_URL,
        analyticsScript: config.ANALYTICS_SCRIPT,
        socialProofCount,
        abVariant: variant,
      }));
  };

  app.get('/', handler);
  app.get('/pricing', handler);

  app.get('/robots.txt', async (_req: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    const robots = [
      'User-agent: *',
      'Allow: /',
      'Allow: /docs',
      'Allow: /playground',
      'Allow: /terms',
      'Allow: /privacy',
      'Disallow: /dashboard',
      'Disallow: /v1/',
      'Disallow: /admin',
      '',
      `Sitemap: ${config.BASE_URL}/sitemap.xml`,
    ].join('\n');
    return reply
      .type('text/plain')
      .header('Cache-Control', 'public, max-age=86400')
      .send(robots);
  });

  app.get('/sitemap.xml', async (_req: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    const publicPaths = ['/', '/docs', '/playground', '/pricing', '/terms', '/privacy', '/login', '/register'];
    const today = new Date().toISOString().split('T')[0];
    const urls = publicPaths
      .map(
        (path) =>
          `  <url>\n    <loc>${escapeHtml(config.BASE_URL)}${path}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${path === '/' ? 'weekly' : 'monthly'}</changefreq>\n  </url>`,
      )
      .join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
    return reply
      .type('application/xml')
      .header('Cache-Control', 'public, max-age=86400')
      .send(xml);
  });
}
