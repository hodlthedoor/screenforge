import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config/index.js';
import { escapeHtml } from '../utils/html.js';

function landingHtml(baseUrl: string): string {
  const safeBaseUrl = escapeHtml(baseUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ScreenForge — Screenshot &amp; Render API</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--bg:#f5f7ff;--surface:#ffffff;--surface2:#edf1ff;--border:#d6ddf7;--text:#1d2238;--muted:#5b6488;--accent:#4f46e5;--accent2:#0ea5a0;--code-bg:#131828;--code-text:#dbe4ff}
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
    .btn-secondary{background:var(--surface);color:var(--text);border:1px solid var(--border)}

    .nav{border-bottom:1px solid var(--border);padding:16px 0;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(8px)}
    .nav-wrap{display:flex;justify-content:space-between;align-items:center;gap:16px}
    .nav-links{display:flex;gap:16px;align-items:center;flex-wrap:wrap}

    .hero{text-align:center;padding:84px 0 70px}
    .hero h1{font-size:3.1rem;line-height:1.1;font-weight:800;letter-spacing:-1px;margin-bottom:16px}
    .hero h1 span{color:var(--accent)}
    .hero p{font-size:1.2rem;color:var(--muted);max-width:700px;margin:0 auto 32px}
    .cta-group{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}

    .feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}
    .feature-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px}
    .feature-card h3{font-size:1.1rem;margin-bottom:8px;color:var(--accent2)}
    .feature-card p{color:var(--muted);font-size:.95rem}

    .code-section pre,.selfhost pre{background:var(--code-bg);border:1px solid color-mix(in srgb,var(--accent) 20%,var(--border));border-radius:14px;padding:24px;overflow-x:auto;font-size:.9rem;line-height:1.8;color:var(--code-text)}
    code .comment{color:#7f89ae}
    code .string{color:#65d8d6}

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
    .price-card ul li::before{content:'✓ ';color:var(--accent2)}
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

    .testimonials-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
    .quote-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px}
    .quote-card p{color:var(--muted);font-size:.95rem;margin-bottom:12px}
    .quote-card strong{font-size:.95rem}

    .selfhost{text-align:center}
    .selfhost p{color:var(--muted);margin-bottom:20px}

    footer{border-top:1px solid var(--border);padding:32px 0;color:var(--muted);font-size:.9rem}
    .footer-wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:center}
    .footer-links{display:flex;gap:14px}

    @media (prefers-color-scheme: dark){
      :root{--bg:#0b0d15;--surface:#121625;--surface2:#171c2d;--border:#232b45;--text:#e2e8ff;--muted:#9ea8c8;--accent:#7a72ff;--accent2:#2dd4bf;--code-bg:#090d18;--code-text:#c9d6ff}
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
    }
  </style>
</head>
<body>
  <nav class="nav">
    <div class="container nav-wrap">
      <strong style="font-size:1.2rem">ScreenForge</strong>
      <div class="nav-links">
        <a href="/docs">Docs</a>
        <a href="/pricing">Pricing</a>
        <a href="/login" class="btn btn-secondary" style="padding:8px 20px">Log In</a>
        <a href="/register" class="btn btn-primary" style="padding:8px 20px">Get Started</a>
      </div>
    </div>
  </nav>

  <section class="hero">
    <div class="container">
      <h1><span>ScreenForge</span><br>Screenshot &amp; Render API</h1>
      <p>Capture screenshots, generate PDFs, and create OG cards with a single API call. Self-hostable, fast, and developer-friendly.</p>
      <div class="cta-group">
        <a href="/register" class="btn btn-primary">Get Started</a>
        <a href="/docs" class="btn btn-secondary">View Docs</a>
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
      <pre><code><span class="comment"># Take a screenshot</span>
curl -X POST ${safeBaseUrl}/v1/screenshot \\
  -H "Content-Type: application/json" \\
  -d '{"url": "<span class="string">https://example.com</span>", "format": "png"}' \\
  --output screenshot.png

<span class="comment"># Generate a PDF</span>
curl -X POST ${safeBaseUrl}/v1/pdf \\
  -H "Content-Type: application/json" \\
  -d '{"url": "<span class="string">https://example.com</span>", "format": "A4"}'  \\
  --output page.pdf</code></pre>
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
      <p class="section-subtitle"></p>
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

  <section class="selfhost">
    <div class="container">
      <h2 class="section-title">Self-Host in Seconds</h2>
      <p>Run ScreenForge on your own infrastructure. Full control, no data leaves your servers.</p>
      <pre><code>docker compose up -d</code></pre>
    </div>
  </section>

  <footer>
    <div class="container footer-wrap">
      <p>ScreenForge v1.0.0 — Open Source Screenshot &amp; Render API</p>
      <div class="footer-links">
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
      </div>
    </div>
  </footer>
  <script>
    const demoUrlInput = document.getElementById('demo-url');
    const demoButton = document.getElementById('demo-submit');
    const demoStatus = document.getElementById('demo-status');
    const demoPreview = document.getElementById('demo-preview');

    async function runDemo() {
      if (!demoUrlInput || !demoButton || !demoStatus || !demoPreview) return;
      const targetUrl = demoUrlInput.value.trim();
      if (!targetUrl) {
        demoStatus.textContent = 'Enter a URL first';
        return;
      }

      demoStatus.textContent = 'Rendering...';
      demoButton.disabled = true;
      demoPreview.innerHTML = '<p class="demo-empty">Generating screenshot preview...</p>';

      try {
        const response = await fetch('${safeBaseUrl}/v1/screenshot', {
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

        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);
        demoPreview.innerHTML = '<img src="' + imageUrl + '" alt="Screenshot preview" />';
        demoStatus.textContent = 'Done';
      } catch {
        demoStatus.textContent = 'Network error';
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
  const handler = async (_req: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    return reply.type('text/html').send(landingHtml(config.BASE_URL));
  };

  app.get('/', handler);
  app.get('/pricing', handler);
}
