import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config/index.js';
import { escapeHtml } from '../utils/html.js';

function playgroundHtml(baseUrl: string): string {
  const safeBaseUrl = escapeHtml(baseUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Playground — ScreenForge</title>
  <meta name="description" content="Interactive API playground for ScreenForge. Try screenshot, PDF, and OG card generation live.">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    :root{--bg:#0b0d15;--surface:#121625;--surface2:#171c2d;--border:#232b45;--text:#e2e8ff;--muted:#9ea8c8;--accent:#7a72ff;--accent2:#2dd4bf;--err:#ff4466;--code-bg:#090d18;--code-text:#c9d6ff}
    body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(180deg,#090c16 0%,#0f1424 100%);color:var(--text);line-height:1.6;min-height:100vh}
    a{color:var(--accent);text-decoration:none}
    a:hover{text-decoration:underline}
    .container{max-width:1120px;margin:0 auto;padding:0 24px}

    .nav{border-bottom:1px solid var(--border);padding:16px 0;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(8px)}
    .nav-wrap{display:flex;justify-content:space-between;align-items:center;gap:16px}
    .nav-links{display:flex;gap:16px;align-items:center;flex-wrap:wrap}

    h1{font-size:2rem;margin:32px 0 8px;text-align:center}
    .subtitle{text-align:center;color:var(--muted);margin-bottom:32px}

    .playground-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:40px}
    .panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px}
    .panel h2{font-size:1.1rem;margin-bottom:16px;color:var(--accent2)}

    label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:4px;margin-top:12px}
    label:first-child{margin-top:0}
    input[type="text"],input[type="url"],input[type="number"],select,textarea{
      width:100%;padding:10px 14px;border-radius:8px;border:1px solid var(--border);
      background:var(--bg);color:var(--text);font-size:.9rem;font-family:inherit
    }
    input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent)}
    textarea{resize:vertical;min-height:60px;font-family:'Fira Code',monospace,monospace}

    .row{display:flex;gap:12px}
    .row>*{flex:1}

    .toggle-row{display:flex;gap:24px;margin-top:12px}
    .toggle-label{display:flex;align-items:center;gap:8px;font-size:.9rem;color:var(--text);cursor:pointer}
    .toggle-label input[type="checkbox"]{width:18px;height:18px;accent-color:var(--accent)}

    .btn{display:inline-block;padding:12px 28px;border-radius:10px;font-weight:600;font-size:1rem;border:none;cursor:pointer;transition:opacity .2s,transform .2s}
    .btn:hover{opacity:.95;transform:translateY(-1px)}
    .btn-primary{background:var(--accent);color:#fff}
    .btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
    .submit-row{margin-top:20px;display:flex;gap:12px;align-items:center}
    .status{font-size:.9rem;color:var(--muted)}

    #result-area{min-height:120px;display:flex;align-items:center;justify-content:center}
    #result-area img{max-width:100%;border-radius:10px;border:1px solid var(--border)}
    .result-empty{color:var(--muted);font-size:.95rem;text-align:center}
    .result-error{background:rgba(255,68,102,.1);border:1px solid var(--err);border-radius:10px;padding:16px;color:var(--err);width:100%}
    .result-error .error-code{font-weight:700;font-size:1rem;margin-bottom:4px}
    .result-error .error-message{font-size:.9rem;opacity:.85}
    .download-link{display:inline-block;padding:12px 24px;background:var(--accent2);color:#062320;border-radius:10px;font-weight:600;margin-top:8px}

    .code-section{margin-bottom:40px}
    .code-section h2{font-size:1.4rem;text-align:center;margin-bottom:16px}
    .code-tabs{display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:0}
    .code-tab{padding:10px 20px;background:transparent;border:none;color:var(--muted);font-size:.9rem;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px}
    .code-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
    .code-block{display:none;background:var(--code-bg);border:1px solid var(--border);border-top:none;border-radius:0 0 14px 14px;padding:20px;overflow-x:auto;font-size:.85rem;line-height:1.7;color:var(--code-text);white-space:pre;font-family:'Fira Code',monospace,monospace}
    .code-block.active{display:block}

    footer{border-top:1px solid var(--border);padding:32px 0;color:var(--muted);font-size:.9rem;text-align:center}

    @media(max-width:768px){
      .playground-grid{grid-template-columns:1fr}
      .nav-wrap{flex-direction:column;align-items:flex-start}
      .row{flex-direction:column}
      .toggle-row{flex-direction:column;gap:8px}
    }
  </style>
</head>
<body>
  <nav class="nav">
    <div class="container nav-wrap">
      <strong style="font-size:1.2rem"><a href="/" style="color:var(--text)">ScreenForge</a></strong>
      <div class="nav-links">
        <a href="/docs">Docs</a>
        <a href="/playground" style="color:var(--accent2)">Playground</a>
        <a href="/pricing">Pricing</a>
        <a href="/login">Log In</a>
      </div>
    </div>
  </nav>

  <div class="container">
    <h1>API Playground</h1>
    <p class="subtitle">Try the ScreenForge API live. Configure your request, see the result, and copy the code.</p>

    <div class="playground-grid">
      <div class="panel">
        <h2>Request</h2>

        <label for="api-key">API Key (x-api-key header)</label>
        <input type="text" id="api-key" placeholder="sf_live_... or sf_test_..." autocomplete="off" spellcheck="false">

        <label for="target-url">URL to render</label>
        <input type="url" id="target-url" placeholder="https://example.com" value="https://example.com">

        <label for="format">Format</label>
        <select id="format">
          <option value="screenshot" selected>Screenshot (PNG)</option>
          <option value="pdf">PDF</option>
          <option value="og">OG Card</option>
        </select>

        <div class="row">
          <div>
            <label for="viewport-width">Viewport Width</label>
            <input type="number" id="viewport-width" value="1280" min="320" max="3840">
          </div>
          <div>
            <label for="viewport-height">Viewport Height</label>
            <input type="number" id="viewport-height" value="800" min="200" max="3840">
          </div>
        </div>

        <div class="toggle-row">
          <label class="toggle-label"><input type="checkbox" id="dark-mode"> Dark Mode</label>
          <label class="toggle-label"><input type="checkbox" id="full-page"> Full Page</label>
        </div>

        <label for="custom-css">Custom CSS</label>
        <textarea id="custom-css" placeholder="body { background: #000; }"></textarea>

        <div class="submit-row">
          <button id="submit-btn" class="btn btn-primary" type="button">Send Request</button>
          <span id="status" class="status">Ready</span>
        </div>
      </div>

      <div class="panel">
        <h2>Result</h2>
        <div id="result-area">
          <p class="result-empty">Send a request to see the result here.</p>
        </div>
      </div>
    </div>

    <div class="code-section">
      <h2>Code Examples</h2>
      <div class="code-tabs">
        <button class="code-tab active" data-lang="curl">cURL</button>
        <button class="code-tab" data-lang="javascript">JavaScript</button>
        <button class="code-tab" data-lang="python">Python</button>
        <button class="code-tab" data-lang="go">Go</button>
      </div>
      <pre class="code-block active" id="code-curl"></pre>
      <pre class="code-block" id="code-javascript"></pre>
      <pre class="code-block" id="code-python"></pre>
      <pre class="code-block" id="code-go"></pre>
    </div>
  </div>

  <footer>
    <div class="container">ScreenForge — Screenshot &amp; Render API</div>
  </footer>

  <script>
    const BASE = ${JSON.stringify(safeBaseUrl)};
    const $ = (s) => document.getElementById(s);

    const apiKeyInput   = $('api-key');
    const urlInput      = $('target-url');
    const formatSelect  = $('format');
    const vpWidth       = $('viewport-width');
    const vpHeight      = $('viewport-height');
    const darkMode      = $('dark-mode');
    const fullPage      = $('full-page');
    const customCss     = $('custom-css');
    const submitBtn     = $('submit-btn');
    const statusEl      = $('status');
    const resultArea    = $('result-area');

    function getEndpoint() {
      const f = formatSelect.value;
      if (f === 'pdf') return '/v1/pdf';
      if (f === 'og') return '/v1/og';
      return '/v1/screenshot';
    }

    function getBody() {
      const body = { url: urlInput.value || 'https://example.com' };
      const w = parseInt(vpWidth.value, 10);
      const h = parseInt(vpHeight.value, 10);
      if (w && w !== 1280) body.viewport = { ...(body.viewport || {}), width: w };
      if (h && h !== 800) body.viewport = { ...(body.viewport || {}), height: h };
      if (darkMode.checked) body.darkMode = true;
      if (fullPage.checked) body.fullPage = true;
      const css = customCss.value.trim();
      if (css) body.css = css;
      return body;
    }

    function updateCodeExamples() {
      const endpoint = getEndpoint();
      const body = getBody();
      const json = JSON.stringify(body, null, 2);
      const jsonOneline = JSON.stringify(body);
      const key = apiKeyInput.value || 'YOUR_API_KEY';
      const fullUrl = BASE + endpoint;

      // cURL
      var SQ = String.fromCharCode(39);
      var BT = String.fromCharCode(96);
      var NL = String.fromCharCode(10);
      var BS = String.fromCharCode(92);
      $('code-curl').textContent = [
        "curl -X POST " + fullUrl + " " + BS,
        '  -H "Content-Type: application/json" ' + BS,
        '  -H "x-api-key: ' + key + '" ' + BS,
        "  -d " + SQ + jsonOneline + SQ + " " + BS,
        "  --output render." + (formatSelect.value === "pdf" ? "pdf" : "png")
      ].join(NL);

      // JavaScript (@screenforge/sdk)
      var jsMethod = formatSelect.value === 'screenshot' ? 'screenshot'
        : formatSelect.value === 'pdf' ? 'pdf' : 'og';
      var jsComment = formatSelect.value === 'pdf' ? 'PDF' : 'PNG';
      $('code-javascript').textContent = [
        'import ScreenForge from "@screenforge/sdk";',
        '',
        'const sf = new ScreenForge({ apiKey: "' + key + '" });',
        '',
        'const result = await sf.' + jsMethod + '(' + json + ');',
        '// result is a Buffer (' + jsComment + ')'
      ].join(NL);

      // Python
      var pyJson = json.replace(/"/g, '"').replace(/true/g, 'True').replace(/false/g, 'False');
      var pyExt = formatSelect.value === 'pdf' ? 'pdf' : 'png';
      $('code-python').textContent = [
        'import requests',
        '',
        'response = requests.post(',
        '    "' + fullUrl + '",',
        '    headers={',
        '        "Content-Type": "application/json",',
        '        "x-api-key": "' + key + '",',
        '    },',
        '    json=' + pyJson + ',',
        ')',
        '',
        'with open("render.' + pyExt + '", "wb") as f:',
        '    f.write(response.content)'
      ].join(NL);

      // Go
      var goExt = formatSelect.value === 'pdf' ? 'pdf' : 'png';
      $('code-go').textContent = [
        'package main',
        '',
        'import (',
        '    "bytes"',
        '    "io"',
        '    "net/http"',
        '    "os"',
        ')',
        '',
        'func main() {',
        '    body := bytes.NewBufferString(' + BT + jsonOneline + BT + ')',
        '    req, _ := http.NewRequest("POST", "' + fullUrl + '", body)',
        '    req.Header.Set("Content-Type", "application/json")',
        '    req.Header.Set("x-api-key", "' + key + '")',
        '',
        '    resp, _ := http.DefaultClient.Do(req)',
        '    defer resp.Body.Close()',
        '',
        '    out, _ := os.Create("render.' + goExt + '")',
        '    defer out.Close()',
        '    io.Copy(out, resp.Body)',
        '}'
      ].join(NL);
    }

    // Tab switching
    document.querySelectorAll('.code-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.code-block').forEach(b => b.classList.remove('active'));
        tab.classList.add('active');
        $('code-' + tab.dataset.lang).classList.add('active');
      });
    });

    // Live update code examples on any field change
    [apiKeyInput, urlInput, formatSelect, vpWidth, vpHeight, darkMode, fullPage, customCss].forEach(el => {
      el.addEventListener('input', updateCodeExamples);
      el.addEventListener('change', updateCodeExamples);
    });

    updateCodeExamples();

    // Submit request
    submitBtn.addEventListener('click', async () => {
      const key = apiKeyInput.value.trim();
      if (!key) {
        statusEl.textContent = 'Enter an API key first';
        return;
      }

      submitBtn.disabled = true;
      statusEl.textContent = 'Sending...';
      resultArea.innerHTML = '<p class="result-empty">Rendering...<\\/p>';

      try {
        const endpoint = getEndpoint();
        const res = await fetch(BASE + endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key },
          body: JSON.stringify(getBody()),
        });

        if (!res.ok) {
          let errData;
          try { errData = await res.json(); } catch { errData = null; }
          const code = errData?.error?.code || res.status;
          const message = errData?.error?.message || res.statusText;
          resultArea.innerHTML =
            '<div class="result-error">' +
            '<div class="error-code">' + code + '<\\/div>' +
            '<div class="error-message">' + message + '<\\/div>' +
            '<\\/div>';
          statusEl.textContent = 'Error';
          return;
        }

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('pdf')) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          resultArea.innerHTML =
            '<div style="text-align:center;width:100%">' +
            '<p style="color:var(--muted);margin-bottom:8px">PDF generated successfully<\\/p>' +
            '<a class="download-link" href="' + url + '" download="render.pdf">Download PDF<\\/a>' +
            '<\\/div>';
        } else {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          resultArea.innerHTML = '<img src="' + url + '" alt="Render result">';
        }
        statusEl.textContent = 'Done';
      } catch (e) {
        resultArea.innerHTML =
          '<div class="result-error">' +
          '<div class="error-code">NETWORK_ERROR<\\/div>' +
          '<div class="error-message">' + e.message + '<\\/div>' +
          '<\\/div>';
        statusEl.textContent = 'Error';
      } finally {
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export async function playgroundRoutes(app: FastifyInstance): Promise<void> {
  app.get('/playground', async (_req: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    return reply
      .type('text/html')
      .header('Cache-Control', 'public, max-age=3600')
      .send(playgroundHtml(config.BASE_URL));
  });
}
