import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config/index.js';
import { escapeHtml } from '../utils/html.js';

function docsHtml(baseUrl: string): string {
  const safeBaseUrl = escapeHtml(baseUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Documentation — ScreenForge</title>
  <meta name="description" content="Complete API documentation for ScreenForge. Screenshots, PDFs, OG cards, batch rendering, webhooks, visual diff, and SDKs.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark-dimmed.min.css">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{
      --bg:#0c0e16;
      --surface:#141721;
      --surface2:#1a1e2e;
      --border:#2a2f42;
      --text:#e8ecf4;
      --muted:#8b93a8;
      --accent:#6c63ff;
      --accent-glow:rgba(108,99,255,0.15);
      --green:#34d399;
      --orange:#fb923c;
      --code-bg:#0a0c14;
      --code-text:#c5cee0;
    }
    html{scroll-behavior:smooth;scroll-padding-top:24px}
    body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);line-height:1.7;min-height:100vh}
    a{color:var(--accent);text-decoration:none;transition:color .15s}
    a:hover{color:#8b85ff;text-decoration:underline}

    /* ── Sidebar ── */
    .sidebar{position:fixed;top:0;left:0;width:240px;height:100vh;background:var(--surface);border-right:1px solid var(--border);overflow-y:auto;z-index:100;display:flex;flex-direction:column;padding:0}
    .sidebar-logo{padding:24px 20px 16px;border-bottom:1px solid var(--border);font-size:1.05rem;font-weight:700;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
    .sidebar-logo a{color:var(--text)}
    .sidebar-logo a:hover{text-decoration:none}
    .sidebar-logo .logo-icon{width:28px;height:28px;background:var(--accent);border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:.85rem;color:#fff;font-weight:700}
    .sidebar-nav{flex:1;padding:12px 0}
    .sidebar-nav a{display:block;padding:8px 20px;font-size:.875rem;color:var(--muted);font-weight:500;transition:all .15s;border-left:3px solid transparent}
    .sidebar-nav a:hover{color:var(--text);background:var(--accent-glow);text-decoration:none}
    .sidebar-nav a.active{color:var(--accent);border-left-color:var(--accent);background:var(--accent-glow)}
    .sidebar-nav .nav-label{padding:20px 20px 6px;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);opacity:.7}
    .sidebar-footer{padding:16px 20px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:6px}
    .sidebar-footer a{font-size:.85rem;color:var(--muted);padding:6px 0;display:flex;align-items:center;gap:8px}
    .sidebar-footer a:hover{color:var(--accent);text-decoration:none}
    .sidebar-footer .link-icon{font-size:1rem}

    /* ── Main content ── */
    .main{margin-left:240px;min-height:100vh}
    .content-wrap{max-width:780px;margin:0 auto;padding:48px 40px 80px}

    /* ── Typography ── */
    h1{font-size:2.2rem;font-weight:700;letter-spacing:-.03em;margin-bottom:8px}
    h2{font-size:1.6rem;font-weight:700;letter-spacing:-.02em;margin-top:64px;margin-bottom:16px;padding-top:24px;border-top:1px solid var(--border)}
    h3{font-size:1.15rem;font-weight:600;margin-top:32px;margin-bottom:12px;color:var(--text)}
    h4{font-size:.95rem;font-weight:600;margin-top:24px;margin-bottom:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
    p{margin-bottom:16px;color:var(--text);font-size:.95rem}
    .lead{font-size:1.1rem;color:var(--muted);margin-bottom:32px;line-height:1.8}

    /* ── Inline code ── */
    code:not([class*="language-"]):not(.hljs){background:var(--surface2);padding:2px 7px;border-radius:5px;font-family:'IBM Plex Mono',monospace;font-size:.83em;color:var(--orange)}

    /* ── Code tabs ── */
    .code-group{margin:20px 0 28px;border:1px solid var(--border);border-radius:10px;overflow:hidden}
    .code-tabs{display:flex;background:var(--surface);border-bottom:1px solid var(--border)}
    .code-tab{padding:10px 18px;font-size:.8rem;font-weight:600;font-family:'DM Sans',sans-serif;color:var(--muted);background:transparent;border:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .15s}
    .code-tab:hover{color:var(--text)}
    .code-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
    .code-panel{display:none}
    .code-panel.active{display:block}
    .code-panel pre{margin:0;padding:20px;background:var(--code-bg);overflow-x:auto}
    .code-panel pre code{font-family:'IBM Plex Mono',monospace;font-size:.82rem;line-height:1.7;color:var(--code-text)}

    /* ── Tables ── */
    .param-table{width:100%;border-collapse:collapse;margin:16px 0 24px;font-size:.88rem}
    .param-table th{text-align:left;padding:10px 14px;font-weight:600;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid var(--border);background:var(--surface)}
    .param-table td{padding:10px 14px;border-bottom:1px solid var(--border);vertical-align:top}
    .param-table tr:last-child td{border-bottom:none}
    .param-table .param-name{font-family:'IBM Plex Mono',monospace;font-weight:500;color:var(--accent);font-size:.85rem;white-space:nowrap}
    .param-table .param-type{font-family:'IBM Plex Mono',monospace;color:var(--orange);font-size:.8rem}
    .param-table .param-req{color:var(--green);font-size:.75rem;font-weight:600;text-transform:uppercase}

    /* ── Endpoint badge ── */
    .endpoint{display:inline-flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 16px;margin:12px 0 20px;font-family:'IBM Plex Mono',monospace;font-size:.88rem}
    .method{font-weight:700;border-radius:4px;padding:2px 8px;font-size:.78rem;text-transform:uppercase}
    .method-post{background:rgba(108,99,255,.15);color:var(--accent)}
    .method-get{background:rgba(52,211,153,.15);color:var(--green)}

    /* ── Try-it button ── */
    .try-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;background:var(--green);color:#0c0e16;font-weight:600;font-size:.88rem;border-radius:8px;border:none;cursor:pointer;text-decoration:none;transition:opacity .15s,transform .15s;margin:8px 0 16px}
    .try-btn:hover{opacity:.9;transform:translateY(-1px);text-decoration:none;color:#0c0e16}

    /* ── Callout ── */
    .callout{padding:16px 20px;border-radius:8px;margin:16px 0 24px;font-size:.9rem;line-height:1.6;border-left:3px solid}
    .callout-info{background:var(--accent-glow);border-color:var(--accent)}
    .callout-warn{background:rgba(251,146,60,.08);border-color:var(--orange)}

    /* ── Rate limit cards ── */
    .plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:16px 0 24px}
    .plan-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center}
    .plan-card .plan-name{font-weight:700;font-size:.95rem;margin-bottom:6px}
    .plan-card .plan-rate{font-family:'IBM Plex Mono',monospace;font-size:1.4rem;font-weight:700;color:var(--accent)}
    .plan-card .plan-unit{font-size:.78rem;color:var(--muted)}

    /* ── Error table ── */
    .error-table{width:100%;border-collapse:collapse;margin:16px 0 24px;font-size:.85rem}
    .error-table th{text-align:left;padding:10px 12px;font-weight:600;color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid var(--border);background:var(--surface)}
    .error-table td{padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top}
    .error-table .err-code{font-family:'IBM Plex Mono',monospace;font-weight:500;color:var(--orange);font-size:.82rem;white-space:nowrap}
    .error-table .err-status{font-family:'IBM Plex Mono',monospace;color:var(--muted);font-size:.82rem}

    /* ── Hamburger ── */
    .hamburger{display:none;position:fixed;top:14px;left:14px;z-index:200;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:1.3rem;cursor:pointer;color:var(--text);line-height:1}
    .sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:90}

    /* ── Responsive ── */
    @media(max-width:1024px){
      .sidebar{display:none}
      .sidebar.open{display:flex}
      .sidebar-overlay.open{display:block}
      .main{margin-left:0}
      .hamburger{display:block}
      .content-wrap{padding:60px 24px 80px}
    }
    @media(max-width:768px){
      h1{font-size:1.6rem}
      h2{font-size:1.3rem}
      .plan-grid{grid-template-columns:1fr 1fr}
      .param-table,.error-table{display:block;overflow-x:auto}
    }
  </style>
</head>
<body>

<!-- Hamburger -->
<button class="hamburger" id="hamburger" aria-label="Toggle navigation">&#9776;</button>
<div class="sidebar-overlay" id="sidebar-overlay"></div>

<!-- Sidebar -->
<aside class="sidebar" id="sidebar">
  <div class="sidebar-logo">
    <a href="/">
      <span class="logo-icon">S</span>
    </a>
    <a href="/">ScreenForge</a>
  </div>
  <nav class="sidebar-nav">
    <div class="nav-label">Getting Started</div>
    <a href="#getting-started">Introduction</a>
    <a href="#authentication">Authentication</a>
    <div class="nav-label">API Reference</div>
    <a href="#screenshots">Screenshots</a>
    <a href="#pdfs">PDFs</a>
    <a href="#og-cards">OG Cards</a>
    <a href="#batch-rendering">Batch Rendering</a>
    <a href="#async-rendering">Async Rendering</a>
    <a href="#webhooks">Webhooks</a>
    <a href="#visual-diff">Visual Diff</a>
    <a href="#schedules">Schedules</a>
    <div class="nav-label">Resources</div>
    <a href="#sdks">SDKs</a>
    <a href="#rate-limits">Rate Limits</a>
    <a href="#error-codes">Error Codes</a>
    <a href="#self-hosting">Self-Hosting</a>
  </nav>
  <div class="sidebar-footer">
    <a href="/docs/swagger"><span class="link-icon">&#8594;</span> Swagger UI</a>
    <a href="/playground"><span class="link-icon">&#9654;</span> Playground</a>
  </div>
</aside>

<!-- Main Content -->
<div class="main">
<div class="content-wrap">

<!-- ════════════════════════════════════════════ -->
<!-- GETTING STARTED -->
<!-- ════════════════════════════════════════════ -->
<section id="getting-started">
<h1>ScreenForge API</h1>
<p class="lead">Render screenshots, PDFs, and Open Graph cards from any URL or HTML. Production-grade rendering infrastructure you can self-host or use as a service.</p>

<h3>Quick start</h3>
<p>Get an API key by registering at <a href="${safeBaseUrl}/register">${safeBaseUrl}/register</a> or using the admin API. Then make your first request:</p>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">curl</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl -X POST ${safeBaseUrl}/v1/screenshot \\
  -H "x-api-key: sf_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com"}' \\
  --output screenshot.png</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">import ScreenForge from '@screenforge/sdk';

const sf = new ScreenForge({ apiKey: 'sf_live_your_key_here' });

const image = await sf.screenshot({ url: 'https://example.com' });
// image is a Buffer containing the PNG</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">import requests

resp = requests.post(
    "${safeBaseUrl}/v1/screenshot",
    headers={"x-api-key": "sf_live_your_key_here"},
    json={"url": "https://example.com"},
)
with open("screenshot.png", "wb") as f:
    f.write(resp.content)</code></pre></div>
</div>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- AUTHENTICATION -->
<!-- ════════════════════════════════════════════ -->
<section id="authentication">
<h2>Authentication</h2>

<h3>API Key</h3>
<p>Every request must include your API key using one of two methods:</p>

<table class="param-table">
  <thead><tr><th>Method</th><th>Example</th></tr></thead>
  <tbody>
    <tr><td><code>x-api-key</code> header</td><td><code>x-api-key: sf_live_abc123</code></td></tr>
    <tr><td><code>Authorization</code> header</td><td><code>Authorization: Bearer sf_live_abc123</code></td></tr>
  </tbody>
</table>

<h3>Key prefixes</h3>
<p>Keys are prefixed to indicate their environment:</p>
<ul style="margin:0 0 16px 20px;color:var(--text);font-size:.95rem">
  <li><code>sf_live_*</code> &mdash; production keys, counted against your quota</li>
  <li><code>sf_test_*</code> &mdash; test keys, rate-limited but not billed</li>
</ul>

<h3>Signed URLs</h3>
<p>For client-side embedding (e.g. <code>&lt;img&gt;</code> tags), you can generate HMAC-signed URLs so browsers fetch renders directly without exposing your API key.</p>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">curl</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash"># Generate a signed URL server-side
curl -X POST ${safeBaseUrl}/v1/signed-url \\
  -H "x-api-key: sf_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com", "format": "png"}'
# Returns: {"signedUrl": "${safeBaseUrl}/v1/render/signed/..."}</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">const { signedUrl } = await sf.signedUrl({
  url: 'https://example.com',
  format: 'png',
});
// Use in &lt;img src={signedUrl} /&gt;</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">resp = requests.post(
    "${safeBaseUrl}/v1/signed-url",
    headers={"x-api-key": "sf_live_your_key_here"},
    json={"url": "https://example.com", "format": "png"},
)
signed_url = resp.json()["signedUrl"]</code></pre></div>
</div>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- SCREENSHOTS -->
<!-- ════════════════════════════════════════════ -->
<section id="screenshots">
<h2>Screenshots</h2>
<div class="endpoint"><span class="method method-post">POST</span> /v1/screenshot</div>

<p>Capture a pixel-perfect screenshot of any URL or raw HTML. Returns the image as a binary response.</p>

<h4>Parameters</h4>
<table class="param-table">
  <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td class="param-name">url</td><td class="param-type">string</td><td class="param-req">*</td><td>URL to capture. Required unless <code>html</code> is provided.</td></tr>
    <tr><td class="param-name">html</td><td class="param-type">string</td><td></td><td>Raw HTML to render instead of a URL.</td></tr>
    <tr><td class="param-name">viewport</td><td class="param-type">object</td><td></td><td><code>{ width: 1280, height: 720 }</code> &mdash; viewport dimensions in pixels.</td></tr>
    <tr><td class="param-name">format</td><td class="param-type">string</td><td></td><td><code>png</code> (default), <code>jpeg</code>, or <code>webp</code>.</td></tr>
    <tr><td class="param-name">quality</td><td class="param-type">number</td><td></td><td>Quality 1&ndash;100 for JPEG and WebP (default 80). Ignored for PNG.</td></tr>
    <tr><td class="param-name">fullPage</td><td class="param-type">boolean</td><td></td><td>Capture full scrollable page (default <code>false</code>).</td></tr>
    <tr><td class="param-name">darkMode</td><td class="param-type">boolean</td><td></td><td>Emulate dark color scheme (default <code>false</code>).</td></tr>
    <tr><td class="param-name">css</td><td class="param-type">string</td><td></td><td>Custom CSS to inject before capture.</td></tr>
    <tr><td class="param-name">js</td><td class="param-type">string</td><td></td><td>Custom JavaScript to execute before capture.</td></tr>
    <tr><td class="param-name">delay</td><td class="param-type">number</td><td></td><td>Wait time in ms after page load (max 10000).</td></tr>
    <tr><td class="param-name">selector</td><td class="param-type">string</td><td></td><td>CSS selector &mdash; capture only this element.</td></tr>
    <tr><td class="param-name">blockAds</td><td class="param-type">boolean</td><td></td><td>Block known ad/tracker domains (default <code>false</code>).</td></tr>
  </tbody>
</table>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">curl</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl -X POST ${safeBaseUrl}/v1/screenshot \\
  -H "x-api-key: sf_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com",
    "viewport": {"width": 1440, "height": 900},
    "format": "png",
    "fullPage": true,
    "darkMode": true,
    "blockAds": true
  }' \\
  --output screenshot.png</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">import ScreenForge from '@screenforge/sdk';

const sf = new ScreenForge({ apiKey: 'sf_live_your_key_here' });

const image = await sf.screenshot({
  url: 'https://example.com',
  viewport: { width: 1440, height: 900 },
  format: 'png',
  fullPage: true,
  darkMode: true,
  blockAds: true,
});

fs.writeFileSync('screenshot.png', image);</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">import requests

resp = requests.post(
    "${safeBaseUrl}/v1/screenshot",
    headers={"x-api-key": "sf_live_your_key_here"},
    json={
        "url": "https://example.com",
        "viewport": {"width": 1440, "height": 900},
        "format": "png",
        "fullPage": True,
        "darkMode": True,
        "blockAds": True,
    },
)
with open("screenshot.png", "wb") as f:
    f.write(resp.content)</code></pre></div>
</div>

<a href="/playground" class="try-btn">&#9654; Try it in Playground</a>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- PDFs -->
<!-- ════════════════════════════════════════════ -->
<section id="pdfs">
<h2>PDFs</h2>
<div class="endpoint"><span class="method method-post">POST</span> /v1/pdf</div>

<p>Generate a PDF from any URL or raw HTML. Returns the PDF as a binary response with <code>application/pdf</code> content type.</p>

<h4>Parameters</h4>
<table class="param-table">
  <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td class="param-name">url</td><td class="param-type">string</td><td class="param-req">*</td><td>URL to render. Required unless <code>html</code> is provided.</td></tr>
    <tr><td class="param-name">html</td><td class="param-type">string</td><td></td><td>Raw HTML to render instead of a URL.</td></tr>
    <tr><td class="param-name">format</td><td class="param-type">string</td><td></td><td><code>A4</code> (default), <code>Letter</code>, or <code>Legal</code>.</td></tr>
    <tr><td class="param-name">landscape</td><td class="param-type">boolean</td><td></td><td>Use landscape orientation (default <code>false</code>).</td></tr>
    <tr><td class="param-name">margin</td><td class="param-type">object</td><td></td><td><code>{ top, right, bottom, left }</code> in CSS units, e.g. <code>"20mm"</code>.</td></tr>
    <tr><td class="param-name">headerTemplate</td><td class="param-type">string</td><td></td><td>HTML template for the page header.</td></tr>
    <tr><td class="param-name">footerTemplate</td><td class="param-type">string</td><td></td><td>HTML template for the page footer.</td></tr>
    <tr><td class="param-name">printBackground</td><td class="param-type">boolean</td><td></td><td>Include background graphics (default <code>true</code>).</td></tr>
    <tr><td class="param-name">scale</td><td class="param-type">number</td><td></td><td>Scale factor between 0.1 and 2 (default <code>1</code>).</td></tr>
  </tbody>
</table>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">curl</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl -X POST ${safeBaseUrl}/v1/pdf \\
  -H "x-api-key: sf_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com",
    "format": "A4",
    "printBackground": true,
    "margin": {"top": "20mm", "bottom": "20mm"}
  }' \\
  --output document.pdf</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">const pdf = await sf.pdf({
  url: 'https://example.com',
  format: 'A4',
  printBackground: true,
  margin: { top: '20mm', bottom: '20mm' },
});

fs.writeFileSync('document.pdf', pdf);</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">resp = requests.post(
    "${safeBaseUrl}/v1/pdf",
    headers={"x-api-key": "sf_live_your_key_here"},
    json={
        "url": "https://example.com",
        "format": "A4",
        "printBackground": True,
        "margin": {"top": "20mm", "bottom": "20mm"},
    },
)
with open("document.pdf", "wb") as f:
    f.write(resp.content)</code></pre></div>
</div>

<a href="/playground" class="try-btn">&#9654; Try it in Playground</a>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- OG CARDS -->
<!-- ════════════════════════════════════════════ -->
<section id="og-cards">
<h2>OG Cards</h2>
<div class="endpoint"><span class="method method-post">POST</span> /v1/og</div>

<p>Generate Open Graph social preview images (1200x630) ready for Twitter, Facebook, LinkedIn, and Slack. Use built-in templates or provide custom HTML.</p>

<h4>Parameters</h4>
<table class="param-table">
  <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td class="param-name">url</td><td class="param-type">string</td><td></td><td>URL to extract OG data from.</td></tr>
    <tr><td class="param-name">html</td><td class="param-type">string</td><td></td><td>Custom HTML template for the card.</td></tr>
    <tr><td class="param-name">template</td><td class="param-type">string</td><td></td><td><code>default</code>, <code>minimal</code>, or <code>branded</code>.</td></tr>
    <tr><td class="param-name">title</td><td class="param-type">string</td><td></td><td>Card title text.</td></tr>
    <tr><td class="param-name">description</td><td class="param-type">string</td><td></td><td>Card description text.</td></tr>
    <tr><td class="param-name">logo</td><td class="param-type">string</td><td></td><td>URL to a logo image to include.</td></tr>
    <tr><td class="param-name">theme</td><td class="param-type">string</td><td></td><td><code>light</code> or <code>dark</code> (default <code>light</code>).</td></tr>
  </tbody>
</table>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">curl</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl -X POST ${safeBaseUrl}/v1/og \\
  -H "x-api-key: sf_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "My Blog Post",
    "description": "A great article about rendering",
    "template": "branded",
    "theme": "dark",
    "logo": "https://example.com/logo.png"
  }' \\
  --output og-card.png</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">const card = await sf.og({
  title: 'My Blog Post',
  description: 'A great article about rendering',
  template: 'branded',
  theme: 'dark',
  logo: 'https://example.com/logo.png',
});

fs.writeFileSync('og-card.png', card);</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">resp = requests.post(
    "${safeBaseUrl}/v1/og",
    headers={"x-api-key": "sf_live_your_key_here"},
    json={
        "title": "My Blog Post",
        "description": "A great article about rendering",
        "template": "branded",
        "theme": "dark",
        "logo": "https://example.com/logo.png",
    },
)
with open("og-card.png", "wb") as f:
    f.write(resp.content)</code></pre></div>
</div>

<a href="/playground" class="try-btn">&#9654; Try it in Playground</a>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- BATCH RENDERING -->
<!-- ════════════════════════════════════════════ -->
<section id="batch-rendering">
<h2>Batch Rendering</h2>
<div class="endpoint"><span class="method method-post">POST</span> /v1/batch</div>

<p>Submit up to 50 render jobs in a single request. Each item can be a screenshot, PDF, or OG card. The batch is processed in parallel and results are delivered via webhook or polling.</p>

<h4>Submit a batch</h4>
<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">curl</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl -X POST ${safeBaseUrl}/v1/batch \\
  -H "x-api-key: sf_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "items": [
      {"type": "screenshot", "url": "https://example.com"},
      {"type": "screenshot", "url": "https://example.org"},
      {"type": "pdf", "url": "https://example.com/report"}
    ],
    "webhook": "https://your-server.com/webhook"
  }'
# Returns: {"batchId": "batch_abc123", "status": "processing", "total": 3}</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">const batch = await sf.batch({
  items: [
    { type: 'screenshot', url: 'https://example.com' },
    { type: 'screenshot', url: 'https://example.org' },
    { type: 'pdf', url: 'https://example.com/report' },
  ],
  webhook: 'https://your-server.com/webhook',
});

console.log(batch.batchId); // "batch_abc123"</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">resp = requests.post(
    "${safeBaseUrl}/v1/batch",
    headers={"x-api-key": "sf_live_your_key_here"},
    json={
        "items": [
            {"type": "screenshot", "url": "https://example.com"},
            {"type": "screenshot", "url": "https://example.org"},
            {"type": "pdf", "url": "https://example.com/report"},
        ],
        "webhook": "https://your-server.com/webhook",
    },
)
batch = resp.json()
print(batch["batchId"])  # "batch_abc123"</code></pre></div>
</div>

<h4>Check batch status</h4>
<div class="endpoint"><span class="method method-get">GET</span> /v1/batch/:id</div>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">curl</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl ${safeBaseUrl}/v1/batch/batch_abc123 \\
  -H "x-api-key: sf_live_your_key_here"
# Returns: {"batchId": "...", "status": "completed", "results": [...]}</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">const status = await sf.getBatch('batch_abc123');
console.log(status.results);</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">resp = requests.get(
    "${safeBaseUrl}/v1/batch/batch_abc123",
    headers={"x-api-key": "sf_live_your_key_here"},
)
print(resp.json()["results"])</code></pre></div>
</div>

<a href="/playground" class="try-btn">&#9654; Try it in Playground</a>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- ASYNC RENDERING -->
<!-- ════════════════════════════════════════════ -->
<section id="async-rendering">
<h2>Async Rendering</h2>

<p>For long-running renders, submit an async job and poll for the result or receive a webhook callback when it completes.</p>

<h4>Submit async job</h4>
<div class="endpoint"><span class="method method-post">POST</span> /v1/screenshot <span style="color:var(--muted);font-size:.8rem;margin-left:8px">with <code>async: true</code></span></div>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">curl</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl -X POST ${safeBaseUrl}/v1/screenshot \\
  -H "x-api-key: sf_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com",
    "async": true,
    "webhook": "https://your-server.com/callback"
  }'
# Returns: {"jobId": "job_xyz789", "status": "pending"}</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">const job = await sf.screenshot({
  url: 'https://example.com',
  async: true,
  webhook: 'https://your-server.com/callback',
});

console.log(job.jobId); // "job_xyz789"</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">resp = requests.post(
    "${safeBaseUrl}/v1/screenshot",
    headers={"x-api-key": "sf_live_your_key_here"},
    json={
        "url": "https://example.com",
        "async": True,
        "webhook": "https://your-server.com/callback",
    },
)
job = resp.json()
print(job["jobId"])  # "job_xyz789"</code></pre></div>
</div>

<h4>Poll for result</h4>
<div class="endpoint"><span class="method method-get">GET</span> /v1/render/:id</div>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">curl</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl ${safeBaseUrl}/v1/render/job_xyz789 \\
  -H "x-api-key: sf_live_your_key_here"
# When complete, returns the rendered image/PDF binary</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">// Poll until complete
const result = await sf.getRender('job_xyz789');
if (result.status === 'completed') {
  fs.writeFileSync('output.png', result.data);
}</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">import time

while True:
    resp = requests.get(
        "${safeBaseUrl}/v1/render/job_xyz789",
        headers={"x-api-key": "sf_live_your_key_here"},
    )
    if resp.headers.get("content-type", "").startswith("image/"):
        with open("output.png", "wb") as f:
            f.write(resp.content)
        break
    time.sleep(2)</code></pre></div>
</div>

<a href="/playground" class="try-btn">&#9654; Try it in Playground</a>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- WEBHOOKS -->
<!-- ════════════════════════════════════════════ -->
<section id="webhooks">
<h2>Webhooks</h2>

<p>Subscribe to events and receive real-time notifications when renders complete, batches finish, or errors occur.</p>

<h4>Subscribe</h4>
<div class="endpoint"><span class="method method-post">POST</span> /v1/webhooks/subscribe</div>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">curl</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl -X POST ${safeBaseUrl}/v1/webhooks/subscribe \\
  -H "x-api-key: sf_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://your-server.com/webhook",
    "events": ["render.completed", "render.failed", "batch.completed"]
  }'</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">await sf.webhooks.subscribe({
  url: 'https://your-server.com/webhook',
  events: ['render.completed', 'render.failed', 'batch.completed'],
});</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">resp = requests.post(
    "${safeBaseUrl}/v1/webhooks/subscribe",
    headers={"x-api-key": "sf_live_your_key_here"},
    json={
        "url": "https://your-server.com/webhook",
        "events": ["render.completed", "render.failed", "batch.completed"],
    },
)</code></pre></div>
</div>

<h4>Payload structure</h4>
<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">JSON</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-json">{
  "event": "render.completed",
  "timestamp": "2025-01-15T10:30:00Z",
  "data": {
    "jobId": "job_xyz789",
    "type": "screenshot",
    "status": "completed",
    "downloadUrl": "https://..."
  }
}</code></pre></div>
</div>

<h4>Signature verification</h4>
<p>Every webhook request includes an <code>X-Signature-256</code> header containing an HMAC-SHA256 signature. Verify it to ensure the payload is authentic:</p>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="js"><pre><code class="language-javascript">import crypto from 'crypto';

function verifyWebhook(body, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">import hmac
import hashlib

def verify_webhook(body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)</code></pre></div>
</div>

<h4>Retry policy</h4>
<p>Failed deliveries are retried up to <strong>3 times</strong> with exponential backoff (10s, 60s, 300s). A delivery is considered failed if your endpoint returns a non-2xx status or does not respond within 10 seconds.</p>

<h4>Delivery history</h4>
<div class="endpoint"><span class="method method-get">GET</span> /v1/webhooks/deliveries</div>
<p>View recent webhook delivery attempts and their status codes.</p>

<h4>Test event</h4>
<div class="endpoint"><span class="method method-post">POST</span> /v1/webhooks/test</div>
<p>Send a test event to your registered webhook URL to verify integration.</p>

<a href="/playground" class="try-btn">&#9654; Try it in Playground</a>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- Visual Diff -->
<!-- ════════════════════════════════════════════ -->
<section id="visual-diff">
<h2>Visual Diff</h2>

<p>Compare two screenshots pixel-by-pixel and get a diff image highlighting the differences. Useful for visual regression testing, A/B comparisons, and detecting page changes.</p>

<h3>Compare Screenshots</h3>
<div class="endpoint"><span class="method method-post">POST</span> /v1/diff</div>

<h4>URL Mode</h4>
<p>Provide two URLs — ScreenForge renders both and compares them:</p>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">cURL</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="python">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl -X POST ${safeBaseUrl}/v1/diff \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url_a": "https://example.com/v1",
    "url_b": "https://example.com/v2",
    "screenshot_options": {
      "width": 1280,
      "height": 900,
      "delay": 1000
    },
    "threshold": 0.1,
    "include_diff_image": true
  }'</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">const res = await fetch("${safeBaseUrl}/v1/diff", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    url_a: "https://example.com/v1",
    url_b: "https://example.com/v2",
    screenshot_options: { width: 1280, height: 900, delay: 1000 },
    threshold: 0.1,
    include_diff_image: true,
  }),
});
const diff = await res.json();</code></pre></div>
  <div class="code-panel" data-panel="python"><pre><code class="language-python">import requests

resp = requests.post(
    "${safeBaseUrl}/v1/diff",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "url_a": "https://example.com/v1",
        "url_b": "https://example.com/v2",
        "screenshot_options": {"width": 1280, "height": 900, "delay": 1000},
        "threshold": 0.1,
        "include_diff_image": True,
    },
)
diff = resp.json()</code></pre></div>
</div>

<h4>Job ID Mode</h4>
<p>Compare two previously rendered screenshots by job ID:</p>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">cURL</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl -X POST ${safeBaseUrl}/v1/diff \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "job_id_a": "abc12345-...",
    "job_id_b": "def67890-...",
    "threshold": 0.05
  }'</code></pre></div>
</div>

<h4>Screenshot Options</h4>
<p>When using URL mode, control how both pages are rendered:</p>
<table class="params-table">
  <tr><td class="param-name">width</td><td>Viewport width in pixels (default: 1920)</td></tr>
  <tr><td class="param-name">height</td><td>Viewport height in pixels (default: 1080)</td></tr>
  <tr><td class="param-name">fullPage</td><td>Capture the entire scrollable page (default: false)</td></tr>
  <tr><td class="param-name">darkMode</td><td>Emulate dark color scheme (default: false)</td></tr>
  <tr><td class="param-name">deviceScaleFactor</td><td>Device pixel ratio, 0.5–4 (default: 1)</td></tr>
  <tr><td class="param-name">delay</td><td>Wait N milliseconds after page load, 0–30000 (default: 0)</td></tr>
  <tr><td class="param-name">waitFor</td><td>CSS selector to wait for before capturing</td></tr>
  <tr><td class="param-name">wait</td><td>Advanced wait strategy: <code>{"type":"selector","value":".loaded"}</code>, <code>{"type":"networkidle"}</code>, etc.</td></tr>
</table>

<h4>Diff Options</h4>
<table class="params-table">
  <tr><td class="param-name">threshold</td><td>Pixel sensitivity, 0 = exact match, 1 = lenient (default: 0.1)</td></tr>
  <tr><td class="param-name">include_diff_image</td><td>Return a base64-encoded diff image (default: true)</td></tr>
  <tr><td class="param-name">anti_aliasing_detection</td><td>Ignore anti-aliasing differences (default: false)</td></tr>
  <tr><td class="param-name">output_format</td><td>Diff image format: png, jpeg, webp (default: png)</td></tr>
</table>

<h4>Response</h4>
<pre><code class="language-json">{
  "mismatch_percentage": 2.34,
  "total_pixels": 2073600,
  "diff_pixels": 48523,
  "duration_ms": 145,
  "diff_image": "iVBORw0KGgo...",
  "diff_image_content_type": "image/png"
}</code></pre>

</section>

<!-- ════════════════════════════════════════════ -->
<!-- SCHEDULES -->
<!-- ════════════════════════════════════════════ -->
<section id="schedules">
<h2>Schedules</h2>

<p>Create recurring render jobs that execute on a cron schedule. ScreenForge automatically captures screenshots, PDFs, or OG cards at your specified intervals.</p>

<h3>Create a Schedule</h3>
<div class="endpoint"><span class="method method-post">POST</span> /v1/schedules</div>

<h4>Parameters</h4>
<div style="overflow-x:auto">
<table class="param-table">
  <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td class="param-name">name</td><td class="param-type">string</td><td class="param-req">*</td><td>Human-readable name for the schedule (1&ndash;255 chars).</td></tr>
    <tr><td class="param-name">cron_expression</td><td class="param-type">string</td><td class="param-req">*</td><td>Cron expression defining the schedule (e.g. <code>"0 */6 * * *"</code> for every 6 hours). Minimum interval depends on your plan.</td></tr>
    <tr><td class="param-name">render_type</td><td class="param-type">string</td><td class="param-req">*</td><td><code>screenshot</code>, <code>pdf</code>, or <code>og</code>.</td></tr>
    <tr><td class="param-name">render_config</td><td class="param-type">object</td><td class="param-req">*</td><td>Render options (same as the corresponding render endpoint). Must include <code>url</code> for screenshot/pdf types.</td></tr>
    <tr><td class="param-name">enabled</td><td class="param-type">boolean</td><td></td><td>Whether the schedule is active (default <code>true</code>).</td></tr>
  </tbody>
</table>
</div>

<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">curl</button>
    <button class="code-tab" data-tab="js">JavaScript</button>
    <button class="code-tab" data-tab="py">Python</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">curl -X POST ${safeBaseUrl}/v1/schedules \\
  -H "x-api-key: sf_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Homepage daily screenshot",
    "cron_expression": "0 9 * * *",
    "render_type": "screenshot",
    "render_config": {
      "url": "https://example.com",
      "viewport": {"width": 1280, "height": 720},
      "fullPage": true
    }
  }'</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">const res = await fetch("${safeBaseUrl}/v1/schedules", {
  method: "POST",
  headers: {
    "x-api-key": "sf_live_your_key_here",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Homepage daily screenshot",
    cron_expression: "0 9 * * *",
    render_type: "screenshot",
    render_config: {
      url: "https://example.com",
      viewport: { width: 1280, height: 720 },
      fullPage: true,
    },
  }),
});
const { schedule } = await res.json();</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">resp = requests.post(
    "${safeBaseUrl}/v1/schedules",
    headers={"x-api-key": "sf_live_your_key_here"},
    json={
        "name": "Homepage daily screenshot",
        "cron_expression": "0 9 * * *",
        "render_type": "screenshot",
        "render_config": {
            "url": "https://example.com",
            "viewport": {"width": 1280, "height": 720},
            "fullPage": True,
        },
    },
)
schedule = resp.json()["schedule"]</code></pre></div>
</div>

<h3>List Schedules</h3>
<div class="endpoint"><span class="method method-get">GET</span> /v1/schedules</div>
<p>Returns all schedules for the authenticated API key.</p>

<h3>Get Schedule Detail</h3>
<div class="endpoint"><span class="method method-get">GET</span> /v1/schedules/:id</div>
<p>Returns the schedule details along with the last 10 render job results.</p>

<h3>Update a Schedule</h3>
<div class="endpoint"><span class="method method-post">PATCH</span> /v1/schedules/:id</div>
<p>Update any combination of <code>name</code>, <code>cron_expression</code>, <code>render_type</code>, <code>render_config</code>, or <code>enabled</code>. The next run time is automatically recomputed.</p>

<h3>Delete a Schedule</h3>
<div class="endpoint"><span class="method method-post">DELETE</span> /v1/schedules/:id</div>
<p>Permanently remove a schedule. Existing render jobs from previous runs are not deleted.</p>

<h4>Cron limits by plan</h4>
<div style="overflow-x:auto">
<table class="param-table">
  <thead><tr><th>Plan</th><th>Min Interval</th><th>Max Schedules</th></tr></thead>
  <tbody>
    <tr><td>Free</td><td>24 hours</td><td>2</td></tr>
    <tr><td>Starter</td><td>1 hour</td><td>10</td></tr>
    <tr><td>Pro</td><td>15 minutes</td><td>50</td></tr>
    <tr><td>Business</td><td>5 minutes</td><td>200</td></tr>
  </tbody>
</table>
</div>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- SDKs -->
<!-- ════════════════════════════════════════════ -->
<section id="sdks">
<h2>SDKs</h2>

<h3>JavaScript / TypeScript</h3>
<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">Install</button>
    <button class="code-tab" data-tab="js">Usage</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">npm install @screenforge/sdk</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-javascript">import ScreenForge from '@screenforge/sdk';

const sf = new ScreenForge({
  apiKey: process.env.SCREENFORGE_API_KEY,
  // baseUrl: '${safeBaseUrl}', // for self-hosted
});

// Screenshot
const png = await sf.screenshot({ url: 'https://example.com' });

// PDF
const pdf = await sf.pdf({ url: 'https://example.com', format: 'A4' });

// OG Card
const og = await sf.og({
  title: 'Hello World',
  template: 'default',
});

// All methods return Buffer and include full TypeScript types</code></pre></div>
</div>

<h3>Python</h3>
<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">Install</button>
    <button class="code-tab" data-tab="py">Usage</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">pip install screenforge</code></pre></div>
  <div class="code-panel" data-panel="py"><pre><code class="language-python">from screenforge import ScreenForge

sf = ScreenForge(api_key="sf_live_your_key_here")

# Screenshot
png = sf.screenshot(url="https://example.com")

# PDF
pdf = sf.pdf(url="https://example.com", format="A4")

# OG Card
og = sf.og(title="Hello World", template="default")

# All methods return bytes</code></pre></div>
</div>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- RATE LIMITS -->
<!-- ════════════════════════════════════════════ -->
<section id="rate-limits">
<h2>Rate Limits &amp; Quotas</h2>

<p>Rate limits are applied per API key on a sliding window. Your current usage is returned in response headers.</p>

<div class="plan-grid">
  <div class="plan-card">
    <div class="plan-name">Free</div>
    <div class="plan-rate">10</div>
    <div class="plan-unit">requests / min</div>
  </div>
  <div class="plan-card">
    <div class="plan-name">Starter</div>
    <div class="plan-rate">60</div>
    <div class="plan-unit">requests / min</div>
  </div>
  <div class="plan-card">
    <div class="plan-name">Pro</div>
    <div class="plan-rate">300</div>
    <div class="plan-unit">requests / min</div>
  </div>
  <div class="plan-card">
    <div class="plan-name">Business</div>
    <div class="plan-rate">1000</div>
    <div class="plan-unit">requests / min</div>
  </div>
</div>

<h4>Response headers</h4>
<table class="param-table">
  <thead><tr><th>Header</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td class="param-name">X-RateLimit-Limit</td><td>Maximum requests allowed per window</td></tr>
    <tr><td class="param-name">X-RateLimit-Remaining</td><td>Requests remaining in the current window</td></tr>
    <tr><td class="param-name">X-RateLimit-Reset</td><td>Unix timestamp when the window resets</td></tr>
  </tbody>
</table>

<h4>Handling 429 responses</h4>
<p>When you exceed your rate limit, the API returns a <code>429 Too Many Requests</code> response. Use the <code>X-RateLimit-Reset</code> header or the <code>Retry-After</code> header (seconds) to determine when to retry.</p>

<div class="callout callout-info">
  <strong>Tip:</strong> Self-hosted instances have no rate limits by default. Configure them via the <code>RATE_LIMIT_MAX</code> environment variable.
</div>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- ERROR CODES -->
<!-- ════════════════════════════════════════════ -->
<section id="error-codes">
<h2>Error Codes</h2>

<p>All errors follow a consistent JSON format. You can also query the <span class="endpoint" style="display:inline-flex;margin:0;padding:4px 10px;font-size:.82rem"><span class="method method-get">GET</span> /v1/errors</span> endpoint for a machine-readable error catalog.</p>

<h4>Error response format</h4>
<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">JSON</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-json">{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "'url' must be a valid URL",
    "request_id": "req_abc123xyz"
  }
}</code></pre></div>
</div>

<h4>Error reference</h4>
<table class="error-table">
  <thead><tr><th>Code</th><th>HTTP</th><th>Description</th><th>Retry?</th></tr></thead>
  <tbody>
    <tr><td class="err-code">VALIDATION_ERROR</td><td class="err-status">400</td><td>Invalid request body or missing required fields.</td><td>No &mdash; fix the request</td></tr>
    <tr><td class="err-code">INVALID_URL</td><td class="err-status">400</td><td>The provided URL is malformed or unreachable.</td><td>No</td></tr>
    <tr><td class="err-code">SSRF_BLOCKED</td><td class="err-status">400</td><td>URL points to a private/internal network address.</td><td>No</td></tr>
    <tr><td class="err-code">AUTH_REQUIRED</td><td class="err-status">401</td><td>No API key provided in the request.</td><td>No &mdash; add auth</td></tr>
    <tr><td class="err-code">INVALID_API_KEY</td><td class="err-status">401</td><td>API key is invalid or does not exist.</td><td>No</td></tr>
    <tr><td class="err-code">API_KEY_DISABLED</td><td class="err-status">403</td><td>API key has been revoked or disabled.</td><td>No</td></tr>
    <tr><td class="err-code">QUOTA_EXCEEDED</td><td class="err-status">403</td><td>Monthly usage quota has been reached.</td><td>No &mdash; upgrade plan</td></tr>
    <tr><td class="err-code">RATE_LIMITED</td><td class="err-status">429</td><td>Too many requests in the current window.</td><td>Yes &mdash; wait for reset</td></tr>
    <tr><td class="err-code">RENDER_TIMEOUT</td><td class="err-status">504</td><td>Page did not load within the timeout period.</td><td>Yes &mdash; try again or increase delay</td></tr>
    <tr><td class="err-code">RENDER_FAILED</td><td class="err-status">500</td><td>An internal error occurred during rendering.</td><td>Yes &mdash; retry with backoff</td></tr>
    <tr><td class="err-code">JOB_NOT_FOUND</td><td class="err-status">404</td><td>The requested render job was not found.</td><td>No &mdash; check job ID</td></tr>
    <tr><td class="err-code">SCHEDULE_NOT_FOUND</td><td class="err-status">404</td><td>The requested schedule was not found.</td><td>No &mdash; check schedule ID</td></tr>
  </tbody>
</table>
</section>

<!-- ════════════════════════════════════════════ -->
<!-- SELF-HOSTING -->
<!-- ════════════════════════════════════════════ -->
<section id="self-hosting">
<h2>Self-Hosting Guide</h2>

<p>ScreenForge is fully open-source and designed to be self-hosted. Run it on your own infrastructure with full control over data and rendering.</p>

<h3>Docker (recommended)</h3>
<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">Docker</button>
    <button class="code-tab" data-tab="js">Docker Compose</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">docker pull screenforge/screenforge

docker run -d \\
  --name screenforge \\
  -p 3000:3000 \\
  -e DATABASE_URL="postgresql:///screenforge?host=/var/run/postgresql" \\
  -e REDIS_URL="redis://localhost:6379" \\
  -e ADMIN_API_KEY="your-admin-key" \\
  -e API_KEY_SALT="random-32-char-string" \\
  screenforge/screenforge</code></pre></div>
  <div class="code-panel" data-panel="js"><pre><code class="language-yaml">version: '3.8'
services:
  screenforge:
    image: screenforge/screenforge
    ports:
      - '3000:3000'
    environment:
      DATABASE_URL: postgresql://sf:password@db:5432/screenforge
      REDIS_URL: redis://redis:6379
      ADMIN_API_KEY: your-admin-key
      API_KEY_SALT: random-32-char-string
      BROWSER_POOL_SIZE: '4'
    depends_on:
      - db
      - redis

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: sf
      POSTGRES_PASSWORD: password
      POSTGRES_DB: screenforge
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine

volumes:
  pgdata:</code></pre></div>
</div>

<h3>Manual setup</h3>
<div class="code-group" data-tabs>
  <div class="code-tabs">
    <button class="code-tab active" data-tab="curl">Shell</button>
  </div>
  <div class="code-panel active" data-panel="curl"><pre><code class="language-bash">git clone https://github.com/screenforge/screenforge.git
cd screenforge
npm install
npm run build
npm start</code></pre></div>
</div>

<h4>Environment variables</h4>
<table class="param-table">
  <thead><tr><th>Variable</th><th>Default</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td class="param-name">PORT</td><td>3000</td><td>HTTP server port.</td></tr>
    <tr><td class="param-name">DATABASE_URL</td><td>&mdash;</td><td>PostgreSQL connection string.</td></tr>
    <tr><td class="param-name">REDIS_URL</td><td>redis://localhost:6379</td><td>Redis connection string for queues and caching.</td></tr>
    <tr><td class="param-name">ADMIN_API_KEY</td><td>&mdash;</td><td>Secret key for admin endpoints (/admin/*).</td></tr>
    <tr><td class="param-name">API_KEY_SALT</td><td>&mdash;</td><td>Salt for hashing API keys at rest.</td></tr>
    <tr><td class="param-name">STORAGE_PATH</td><td>./storage</td><td>Directory for rendered file storage.</td></tr>
    <tr><td class="param-name">BASE_URL</td><td>http://localhost:3000</td><td>Public base URL for signed URLs and webhooks.</td></tr>
    <tr><td class="param-name">BROWSER_POOL_SIZE</td><td>4</td><td>Number of browser instances in the rendering pool.</td></tr>
  </tbody>
</table>

<div class="callout callout-warn">
  <strong>Important:</strong> Always set <code>API_KEY_SALT</code> to a strong random string. Changing it after deployment will invalidate all existing API keys.
</div>
</section>

</div><!-- .content-wrap -->
</div><!-- .main -->

<!-- highlight.js -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/bash.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/javascript.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/python.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/json.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/yaml.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/dockerfile.min.js"></script>
<script>
(function() {
  // Highlight all code blocks
  hljs.highlightAll();

  // ── Tab switching ──
  document.querySelectorAll('[data-tabs]').forEach(function(group) {
    var tabs = group.querySelectorAll('.code-tab');
    var panels = group.querySelectorAll('.code-panel');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var target = tab.getAttribute('data-tab');
        tabs.forEach(function(t) { t.classList.remove('active'); });
        panels.forEach(function(p) { p.classList.remove('active'); });
        tab.classList.add('active');
        var panel = group.querySelector('[data-panel="' + target + '"]');
        if (panel) panel.classList.add('active');
      });
    });
  });

  // ── Sidebar active section (Intersection Observer) ──
  var sidebarLinks = document.querySelectorAll('.sidebar-nav a[href^="#"]');
  var sections = [];
  sidebarLinks.forEach(function(link) {
    var id = link.getAttribute('href').slice(1);
    var el = document.getElementById(id);
    if (el) sections.push({ id: id, el: el, link: link });
  });

  if (sections.length > 0 && 'IntersectionObserver' in window) {
    var currentActive = null;
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var id = entry.target.id;
          if (currentActive) currentActive.classList.remove('active');
          var match = sections.find(function(s) { return s.id === id; });
          if (match) {
            match.link.classList.add('active');
            currentActive = match.link;
          }
        }
      });
    }, { rootMargin: '-10% 0px -80% 0px', threshold: 0 });

    sections.forEach(function(s) { observer.observe(s.el); });
  }

  // ── Mobile hamburger ──
  var hamburger = document.getElementById('hamburger');
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebar-overlay');

  function toggleSidebar() {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  }

  hamburger.addEventListener('click', toggleSidebar);
  overlay.addEventListener('click', toggleSidebar);

  // Close sidebar when clicking a nav link on mobile
  sidebarLinks.forEach(function(link) {
    link.addEventListener('click', function() {
      if (window.innerWidth <= 1024) {
        sidebar.classList.remove('open');
        overlay.classList.remove('open');
      }
    });
  });
})();
</script>

</body>
</html>`;
}

export async function docsSiteRoutes(app: FastifyInstance): Promise<void> {
  app.get('/docs', async (_req: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    return reply
      .type('text/html')
      .header('Cache-Control', 'public, max-age=3600')
      .send(docsHtml(config.BASE_URL));
  });
}
