import type { FastifyInstance } from 'fastify';
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
    :root{--bg:#0a0a0f;--surface:#12121a;--border:#1e1e2e;--text:#e0e0e8;--muted:#8888a0;--accent:#6c63ff;--accent2:#00d4aa;--code-bg:#1a1a28}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    .container{max-width:1100px;margin:0 auto;padding:0 24px}

    /* Hero */
    .hero{text-align:center;padding:80px 0 60px}
    .hero h1{font-size:3rem;font-weight:800;letter-spacing:-1px;margin-bottom:16px}
    .hero h1 span{color:var(--accent)}
    .hero p{font-size:1.25rem;color:var(--muted);max-width:600px;margin:0 auto 32px}
    .cta-group{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
    .btn{display:inline-block;padding:12px 28px;border-radius:8px;font-weight:600;font-size:1rem;transition:opacity .2s}
    .btn-primary{background:var(--accent);color:#fff}
    .btn-secondary{background:var(--surface);color:var(--text);border:1px solid var(--border)}

    /* Features */
    .features{padding:60px 0}
    .features h2{text-align:center;font-size:2rem;margin-bottom:40px}
    .feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
    .feature-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px}
    .feature-card h3{font-size:1.1rem;margin-bottom:8px;color:var(--accent2)}
    .feature-card p{color:var(--muted);font-size:.95rem}

    /* Code */
    .code-section{padding:60px 0}
    .code-section h2{text-align:center;font-size:2rem;margin-bottom:32px}
    pre{background:var(--code-bg);border:1px solid var(--border);border-radius:12px;padding:24px;overflow-x:auto;font-size:.9rem;line-height:1.8;color:#c0c0d0}
    code .comment{color:#666}
    code .string{color:var(--accent2)}

    /* Pricing */
    .pricing{padding:60px 0}
    .pricing h2{text-align:center;font-size:2rem;margin-bottom:40px}
    .pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}
    .price-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px;text-align:center}
    .price-card.featured{border-color:var(--accent)}
    .price-card h3{font-size:1.3rem;margin-bottom:8px}
    .price-card .price{font-size:2rem;font-weight:800;margin:12px 0}
    .price-card .price span{font-size:.9rem;color:var(--muted);font-weight:400}
    .price-card ul{list-style:none;text-align:left;margin-top:16px}
    .price-card ul li{padding:6px 0;color:var(--muted);font-size:.9rem}
    .price-card ul li::before{content:'✓ ';color:var(--accent2)}

    /* Self-host */
    .selfhost{padding:60px 0;text-align:center}
    .selfhost h2{font-size:2rem;margin-bottom:16px}
    .selfhost p{color:var(--muted);margin-bottom:24px;font-size:1.1rem}
    .selfhost pre{display:inline-block;text-align:left;max-width:600px;margin:0 auto}

    /* Footer */
    footer{border-top:1px solid var(--border);padding:32px 0;text-align:center;color:var(--muted);font-size:.85rem}

    @media(max-width:768px){
      .hero h1{font-size:2rem}
      .hero p{font-size:1rem}
      .pricing-grid,.feature-grid{grid-template-columns:1fr}
    }
  </style>
</head>
<body>
  <nav style="border-bottom:1px solid var(--border);padding:16px 0">
    <div class="container" style="display:flex;justify-content:space-between;align-items:center">
      <strong style="font-size:1.2rem">⚡ ScreenForge</strong>
      <div style="display:flex;gap:20px;align-items:center">
        <a href="/docs">Docs</a>
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
      <h2>Everything You Need</h2>
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
      <h2>Simple API</h2>
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
      <h2>Pricing</h2>
      <div class="pricing-grid">
        <div class="price-card">
          <h3>Free</h3>
          <div class="price">$0<span>/mo</span></div>
          <ul>
            <li>1,000 renders/month</li>
            <li>10 req/min rate limit</li>
            <li>Community support</li>
          </ul>
        </div>
        <div class="price-card">
          <h3>Starter</h3>
          <div class="price">$19<span>/mo</span></div>
          <ul>
            <li>10,000 renders/month</li>
            <li>50 req/min rate limit</li>
            <li>Email support</li>
          </ul>
        </div>
        <div class="price-card featured">
          <h3>Pro</h3>
          <div class="price">$49<span>/mo</span></div>
          <ul>
            <li>100,000 renders/month</li>
            <li>200 req/min rate limit</li>
            <li>Priority support</li>
          </ul>
        </div>
        <div class="price-card">
          <h3>Business</h3>
          <div class="price">$149<span>/mo</span></div>
          <ul>
            <li>1,000,000 renders/month</li>
            <li>1,000 req/min rate limit</li>
            <li>Dedicated support</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section class="selfhost">
    <div class="container">
      <h2>Self-Host in Seconds</h2>
      <p>Run ScreenForge on your own infrastructure. Full control, no data leaves your servers.</p>
      <pre><code>docker compose up -d</code></pre>
    </div>
  </section>

  <footer>
    <div class="container">
      <p>ScreenForge v1.0.0 — Open Source Screenshot &amp; Render API</p>
    </div>
  </footer>
</body>
</html>`;
}

export async function landingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (_req, reply) => {
    const config = getConfig();
    return reply.type('text/html').send(landingHtml(config.BASE_URL));
  });
}
