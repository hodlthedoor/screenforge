import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getUserById, getUserApiKeys, linkApiKeyToUser, revokeUserApiKey, verifyUserPassword, deleteUser } from '../db/users.js';
import { createApiKey, getUsageStats, rotateApiKey, getApiKeyWithSigningSecret } from '../db/api-keys.js';
import { generateSignedUrl, type SignedUrlOptions } from '../auth/signed-urls.js';
import { getPool } from '../db/index.js';
import { escapeHtml, generateCsrfToken } from '../utils/html.js';
import { getConfig } from '../config/index.js';

// Session auth guard
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

function consumeFlash(req: FastifyRequest, key: string): string | undefined {
  const value = req.session.flash?.[key];
  if (value && req.session.flash) {
    delete req.session.flash[key];
  }
  return value;
}

function dashboardLayout(title: string, nav: string, content: string, csrfToken: string): string {
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
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
  .stat{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px}
  .stat .label{font-size:.85rem;color:var(--muted);margin-bottom:4px}
  .stat .value{font-size:1.8rem;font-weight:700}
  table{width:100%;border-collapse:collapse}
  th,td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--border)}
  th{font-size:.85rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
  .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:.8rem;font-weight:600}
  .badge-active{background:rgba(0,212,170,.15);color:var(--accent2)}
  .badge-revoked{background:rgba(255,68,102,.15);color:var(--err)}
  .btn{display:inline-block;padding:8px 16px;border-radius:6px;font-size:.9rem;font-weight:600;border:none;cursor:pointer;transition:opacity .2s}
  .btn-primary{background:var(--accent);color:#fff}
  .btn-danger{background:var(--err);color:#fff}
  .btn-sm{padding:4px 12px;font-size:.8rem}
  input,select{padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.9rem}
  input:focus,select:focus{outline:none;border-color:var(--accent)}
  .form-row{display:flex;gap:12px;align-items:end;margin-bottom:16px;flex-wrap:wrap}
  .form-group{display:flex;flex-direction:column;gap:4px}
  .form-group label{font-size:.85rem;color:var(--muted)}
  .key-display{background:var(--bg);border:1px solid var(--accent);border-radius:8px;padding:16px;margin:16px 0;font-family:monospace;word-break:break-all;color:var(--accent2)}
  .key-warning{color:var(--warn);font-size:.85rem;margin-top:8px}
  @media(max-width:768px){.layout{flex-direction:column}.sidebar{width:100%;display:flex;overflow-x:auto;padding:12px 0}.sidebar a{white-space:nowrap}}
</style></head><body>
<div class="layout">
  <nav class="sidebar">
    <div class="logo">ScreenForge</div>
    <a href="/dashboard" class="${nav === 'overview' ? 'active' : ''}">Overview</a>
    <a href="/dashboard/keys" class="${nav === 'keys' ? 'active' : ''}">API Keys</a>
    <a href="/dashboard/usage" class="${nav === 'usage' ? 'active' : ''}">Usage</a>
    <a href="/dashboard/webhooks" class="${nav === 'webhooks' ? 'active' : ''}">Webhooks</a>
    <a href="/dashboard/analytics" class="${nav === 'analytics' ? 'active' : ''}">Analytics</a>
    <a href="/dashboard/signed-urls" class="${nav === 'signed-urls' ? 'active' : ''}">Signed URLs</a>
    <a href="/dashboard/billing" class="${nav === 'billing' ? 'active' : ''}">Billing</a>
    <a href="/dashboard/settings" class="${nav === 'settings' ? 'active' : ''}">Settings</a>
    <a href="/playground">Playground</a>
    <a href="/docs">API Docs</a>
    <form method="POST" action="/logout" style="padding:10px 20px;margin-top:auto"><input type="hidden" name="_csrf" value="${csrfToken}"><button type="submit" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.95rem">Log Out</button></form>
  </nav>
  <main class="main">${content}</main>
</div></body></html>`;
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // Overview
  app.get('/dashboard', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.dashboardUser!;
    const keys = await getUserApiKeys(user.id);
    const csrfToken = ensureCsrfToken(req);

    let totalToday = 0;
    let totalMonth = 0;
    let totalQuota = 0;
    for (const key of keys) {
      const stats = await getUsageStats(key.id);
      totalToday += stats.today;
      totalMonth += stats.thisMonth;
      totalQuota += key.monthlyQuota;
    }

    // Recent renders
    const recentResult = await getPool().query(
      `SELECT rj.id, rj.type, rj.url, rj.status, rj.created_at, rj.duration_ms
       FROM render_jobs rj
       JOIN user_api_keys uak ON uak.api_key_id = rj.api_key_id
       WHERE uak.user_id = $1
       ORDER BY rj.created_at DESC LIMIT 10`,
      [user.id],
    );

    const recentRows = recentResult.rows.map((r: {
      type: string;
      url: string;
      status: string;
      duration_ms: number | null;
    }) =>
      `<tr><td>${escapeHtml(r.type)}</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.url)}</td><td><span class="badge ${r.status === 'completed' ? 'badge-active' : 'badge-revoked'}">${r.status}</span></td><td>${r.duration_ms ? r.duration_ms + 'ms' : '—'}</td></tr>`
    ).join('');

    const html = `
      <h1>Dashboard</h1>
      <div class="stats">
        <div class="stat"><div class="label">Renders Today</div><div class="value">${totalToday}</div></div>
        <div class="stat"><div class="label">This Month</div><div class="value">${totalMonth.toLocaleString()}</div></div>
        <div class="stat"><div class="label">Monthly Quota</div><div class="value">${totalQuota.toLocaleString()}</div></div>
        <div class="stat"><div class="label">API Keys</div><div class="value">${keys.length}</div></div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Recent Renders</h2>
        ${recentResult.rows.length > 0 ? `<table><thead><tr><th>Type</th><th>URL</th><th>Status</th><th>Duration</th></tr></thead><tbody>${recentRows}</tbody></table>` : '<p style="color:var(--muted)">No renders yet. Create an API key and start making requests.</p>'}
      </div>`;

    await req.session.save();
    return reply.type('text/html').send(dashboardLayout('Dashboard', 'overview', html, csrfToken));
  });

  // API Keys
  app.get('/dashboard/keys', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.dashboardUser!;
    const keys = await getUserApiKeys(user.id);
    const csrfToken = ensureCsrfToken(req);
    const newKey = consumeFlash(req, 'newKey');

    const keyRows = keys.map((k: { id: string; name: string; prefix: string; tier: string; active: boolean }) =>
      `<tr>
        <td>${escapeHtml(k.name)}</td>
        <td><code>${escapeHtml(k.prefix)}...</code></td>
        <td>${k.tier}</td>
        <td><span class="badge ${k.active ? 'badge-active' : 'badge-revoked'}">${k.active ? 'Active' : 'Revoked'}</span></td>
        <td>${k.active ? `<form method="POST" action="/dashboard/keys/${k.id}/rotate" style="display:inline;margin-right:8px"><input type="hidden" name="_csrf" value="${csrfToken}"><button type="submit" class="btn btn-primary btn-sm">Rotate</button></form><form method="POST" action="/dashboard/keys/${k.id}/revoke" style="display:inline"><input type="hidden" name="_csrf" value="${csrfToken}"><button type="submit" class="btn btn-danger btn-sm">Revoke</button></form>` : '—'}</td>
      </tr>`
    ).join('');

    const html = `
      <h1>API Keys</h1>
      ${newKey ? `<div class="key-display">${escapeHtml(newKey)}</div><div class="key-warning">Copy this key now. It will not be shown again.</div>` : ''}
      <div class="card">
        <h2 style="margin-bottom:16px">Create New Key</h2>
        <form method="POST" action="/dashboard/keys">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <div class="form-row">
            <div class="form-group"><label>Name</label><input type="text" name="name" placeholder="My API Key" required></div>
            <div class="form-group"><label>Tier</label><select name="tier"><option value="free">Free</option><option value="starter">Starter</option><option value="pro">Pro</option><option value="business">Business</option></select></div>
            <button type="submit" class="btn btn-primary">Create Key</button>
          </div>
        </form>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Your Keys</h2>
        ${keys.length > 0 ? `<table><thead><tr><th>Name</th><th>Prefix</th><th>Tier</th><th>Status</th><th>Actions</th></tr></thead><tbody>${keyRows}</tbody></table>` : '<p style="color:var(--muted)">No API keys yet.</p>'}
      </div>`;

    await req.session.save();
    return reply.type('text/html').send(dashboardLayout('API Keys', 'keys', html, csrfToken));
  });

  // Create key
  app.post('/dashboard/keys', { preHandler: requireAuth }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).redirect('/dashboard/keys');
    }

    const user = req.dashboardUser!;
    const { name, tier } = req.body as { name: string; tier: string; _csrf: string };
    const validTier = ['free', 'starter', 'pro', 'business'].includes(tier) ? tier as 'free' | 'starter' | 'pro' | 'business' : 'free';

    const result = await createApiKey(name || 'Unnamed Key', validTier);
    await linkApiKeyToUser(user.id, result.key.id);

    // Store key in flash session instead of URL param
    if (!req.session.flash) req.session.flash = {};
    req.session.flash.newKey = result.rawKey;
    req.session.csrfToken = generateCsrfToken();
    await req.session.save();

    return reply.redirect('/dashboard/keys');
  });

  // Revoke key
  app.post('/dashboard/keys/:id/revoke', { preHandler: requireAuth }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).redirect('/dashboard/keys');
    }

    const user = req.dashboardUser!;
    const { id } = req.params as { id: string };
    await revokeUserApiKey(user.id, id);
    req.session.csrfToken = generateCsrfToken();
    await req.session.save();
    return reply.redirect('/dashboard/keys');
  });

  // Rotate key
  app.post('/dashboard/keys/:id/rotate', { preHandler: requireAuth }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).redirect('/dashboard/keys');
    }

    const user = req.dashboardUser!;
    const { id } = req.params as { id: string };

    // Verify ownership
    const ownership = await getPool().query(
      'SELECT 1 FROM user_api_keys WHERE user_id = $1 AND api_key_id = $2',
      [user.id, id],
    );
    if (ownership.rows.length === 0) {
      return reply.status(403).send('Not authorized');
    }

    // Rotate the key
    const newRawKey = await rotateApiKey(id);

    // Store new key in flash session
    if (!req.session.flash) req.session.flash = {};
    req.session.flash.newKey = newRawKey;
    req.session.csrfToken = generateCsrfToken();
    await req.session.save();

    return reply.redirect('/dashboard/keys');
  });

  // Usage
  app.get('/dashboard/usage', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.dashboardUser!;
    const keys = await getUserApiKeys(user.id);
    const csrfToken = ensureCsrfToken(req);
    const pool = getPool();

    // Daily usage for the last 30 days
    const dailyResult = await pool.query(
      `SELECT ud.date, SUM(ud.count) as total
       FROM usage_daily ud
       JOIN user_api_keys uak ON uak.api_key_id = ud.api_key_id
       WHERE uak.user_id = $1 AND ud.date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY ud.date
       ORDER BY ud.date`,
      [user.id],
    );

    // Usage by render type
    const typeResult = await pool.query(
      `SELECT rj.type, COUNT(*)::int as count
       FROM render_jobs rj
       JOIN user_api_keys uak ON uak.api_key_id = rj.api_key_id
       WHERE uak.user_id = $1 AND rj.created_at >= date_trunc('month', CURRENT_DATE)
       GROUP BY rj.type`,
      [user.id],
    );

    // Recent errors (last 10 failed renders)
    const errorsResult = await pool.query(
      `SELECT rj.url, rj.error, rj.created_at
       FROM render_jobs rj
       JOIN user_api_keys uak ON uak.api_key_id = rj.api_key_id
       WHERE uak.user_id = $1 AND rj.status = 'failed'
       ORDER BY rj.created_at DESC LIMIT 10`,
      [user.id],
    );

    const dailyData = JSON.stringify(dailyResult.rows.map((r: { date: string; total: number | string }) => ({ date: r.date, count: Number(r.total) })));
    const typeData = JSON.stringify(typeResult.rows.map((r: { type: string; count: number | string }) => ({ type: r.type, count: Number(r.count) })));

    const typeColors: Record<string, string> = { screenshot: '#6c63ff', pdf: '#00d4aa', og: '#ffaa33' };

    const statCards = await Promise.all(keys.map(async (k: { id: string; name: string; monthlyQuota: number }) => {
      const stats = await getUsageStats(k.id);
      return `<div class="stat"><div class="label">${escapeHtml(k.name)}</div><div class="value">${stats.thisMonth} / ${k.monthlyQuota.toLocaleString()}</div></div>`;
    }));

    const errorRows = errorsResult.rows.map((r: { url: string; error: string | null; created_at: string }) =>
      `<tr>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.url)}</td>
        <td>${escapeHtml(r.error || 'Unknown error')}</td>
        <td>${new Date(r.created_at).toLocaleString()}</td>
      </tr>`
    ).join('');

    const html = `
      <h1>Usage</h1>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
        <div style="display:flex;gap:12px">
          <a href="/dashboard/usage/export?format=csv" class="btn btn-primary btn-sm">Export CSV</a>
          <a href="/dashboard/usage/export?format=json" class="btn btn-primary btn-sm">Export JSON</a>
        </div>
        <label style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:.85rem;cursor:pointer">
          <input type="checkbox" id="auto-refresh" style="cursor:pointer">
          Auto-refresh (30s)
        </label>
      </div>
      <div class="stats">
        ${statCards.join('')}
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Daily Renders (Last 30 Days)</h2>
        <canvas id="dailyChart" height="250"></canvas>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Render Type Breakdown</h2>
        <div style="max-width:400px;margin:0 auto">
          <canvas id="typeChart" height="300"></canvas>
        </div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Recent Errors</h2>
        ${errorsResult.rows.length > 0
          ? `<table><thead><tr><th>URL</th><th>Error</th><th>Time</th></tr></thead><tbody>${errorRows}</tbody></table>`
          : '<p style="color:var(--muted)">No recent errors.</p>'}
      </div>
      <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
      <script>
        const dailyData = ${dailyData};
        const typeData = ${typeData};
        const typeColors = ${JSON.stringify(typeColors)};

        // Line chart for daily renders
        if (dailyData.length > 0) {
          new Chart(document.getElementById('dailyChart'), {
            type: 'line',
            data: {
              labels: dailyData.map(d => new Date(d.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })),
              datasets: [{
                label: 'Renders',
                data: dailyData.map(d => d.count),
                borderColor: '#6c63ff',
                backgroundColor: 'rgba(108,99,255,0.1)',
                fill: true,
                tension: 0.3,
              }]
            },
            options: {
              responsive: true,
              plugins: { legend: { display: false } },
              scales: {
                x: { grid: { color: '#1e1e2e' }, ticks: { color: '#8888a0' } },
                y: { grid: { color: '#1e1e2e' }, ticks: { color: '#8888a0' }, beginAtZero: true }
              }
            }
          });
        }

        // Doughnut chart for render type breakdown
        if (typeData.length > 0) {
          new Chart(document.getElementById('typeChart'), {
            type: 'doughnut',
            data: {
              labels: typeData.map(d => d.type),
              datasets: [{
                data: typeData.map(d => d.count),
                backgroundColor: typeData.map(d => typeColors[d.type] || '#6c63ff'),
              }]
            },
            options: {
              responsive: true,
              plugins: {
                legend: { labels: { color: '#e0e0e8' } }
              }
            }
          });
        }

        // Auto-refresh toggle
        const autoRefreshCheckbox = document.getElementById('auto-refresh');
        let refreshInterval = null;

        function startAutoRefresh() {
          if (refreshInterval) clearInterval(refreshInterval);
          refreshInterval = setInterval(async () => {
            try {
              const res = await fetch('/v1/analytics', { credentials: 'same-origin' });
              if (res.ok) {
                // Reload page to update charts with fresh data
                window.location.reload();
              }
            } catch (e) { /* ignore fetch errors */ }
          }, 30000);
        }

        function stopAutoRefresh() {
          if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
        }

        // Restore preference from localStorage
        const savedPref = localStorage.getItem('screenforge-auto-refresh');
        if (savedPref === 'true') {
          autoRefreshCheckbox.checked = true;
          startAutoRefresh();
        }

        autoRefreshCheckbox.addEventListener('change', () => {
          localStorage.setItem('screenforge-auto-refresh', String(autoRefreshCheckbox.checked));
          if (autoRefreshCheckbox.checked) { startAutoRefresh(); } else { stopAutoRefresh(); }
        });
      </script>`;

    await req.session.save();
    return reply.type('text/html').send(dashboardLayout('Usage', 'usage', html, csrfToken));
  });

  // Usage export (CSV/JSON)
  app.get('/dashboard/usage/export', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.dashboardUser!;
    const query = req.query as { format?: string };
    const format = query.format;

    if (format !== 'csv' && format !== 'json') {
      return reply.status(400).send({ error: 'Invalid format. Use csv or json.' });
    }

    const pool = getPool();
    const result = await pool.query(
      `SELECT rj.id, rj.type, rj.url, rj.status, rj.duration_ms, rj.created_at
       FROM render_jobs rj
       JOIN user_api_keys uak ON uak.api_key_id = rj.api_key_id
       WHERE uak.user_id = $1 AND rj.created_at >= CURRENT_DATE - INTERVAL '90 days'
       ORDER BY rj.created_at DESC
       LIMIT 10000`,
      [user.id],
    );

    if (format === 'json') {
      return reply
        .header('content-disposition', 'attachment; filename="usage-export.json"')
        .type('application/json')
        .send(result.rows);
    }

    // CSV export
    const headers = ['id', 'type', 'url', 'status', 'duration_ms', 'created_at'];
    const csvLines = [headers.join(',')];
    for (const row of result.rows) {
      csvLines.push(headers.map(h => {
        const val = String(row[h] ?? '');
        return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(','));
    }

    return reply
      .header('content-disposition', 'attachment; filename="usage-export.csv"')
      .type('text/csv')
      .send(csvLines.join('\n'));
  });

  // Webhook delivery log
  app.get('/dashboard/webhooks', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.dashboardUser!;
    const csrfToken = ensureCsrfToken(req);
    const pool = getPool();
    const query = req.query as { page?: string; status?: string };

    const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
    const perPage = 25;
    const offset = (page - 1) * perPage;
    const statusFilter = query.status && ['pending', 'retrying', 'delivered', 'failed'].includes(query.status) ? query.status : null;

    const params: (string | number)[] = [user.id];
    let whereClause = '';
    if (statusFilter) {
      params.push(statusFilter);
      whereClause = ` AND wd.status = $${params.length}`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int as total
       FROM webhook_deliveries wd
       JOIN user_api_keys uak ON uak.api_key_id = wd.api_key_id
       WHERE uak.user_id = $1${whereClause}`,
      params,
    );
    const total = countResult.rows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / perPage));

    params.push(perPage, offset);
    const result = await pool.query(
      `SELECT wd.url, wd.status, wd.last_status_code, wd.attempts, wd.last_error, wd.created_at
       FROM webhook_deliveries wd
       JOIN user_api_keys uak ON uak.api_key_id = wd.api_key_id
       WHERE uak.user_id = $1${whereClause}
       ORDER BY wd.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const rows = result.rows.map((r: { url: string; status: string; last_status_code: number | null; attempts: number; last_error: string | null; created_at: string }) => {
      const badgeClass = r.status === 'delivered' ? 'badge-active' : r.status === 'failed' ? 'badge-revoked' : '';
      return `<tr>
        <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.url)}</td>
        <td><span class="badge ${badgeClass}">${escapeHtml(r.status)}</span></td>
        <td>${r.last_status_code ?? '—'}</td>
        <td>${r.attempts}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.last_error || '—')}</td>
        <td>${new Date(r.created_at).toLocaleString()}</td>
      </tr>`;
    }).join('');

    const filterLinks = ['all', 'pending', 'retrying', 'delivered', 'failed'].map(s => {
      const isActive = (s === 'all' && !statusFilter) || s === statusFilter;
      const href = s === 'all' ? '/dashboard/webhooks' : `/dashboard/webhooks?status=${s}`;
      return `<a href="${href}" class="btn btn-sm ${isActive ? 'btn-primary' : ''}" style="text-decoration:none">${s}</a>`;
    }).join(' ');

    const paginationLinks = [];
    if (page > 1) paginationLinks.push(`<a href="/dashboard/webhooks?page=${page - 1}${statusFilter ? '&status=' + statusFilter : ''}" class="btn btn-sm">&laquo; Prev</a>`);
    paginationLinks.push(`<span style="color:var(--muted);font-size:.85rem">Page ${page} of ${totalPages}</span>`);
    if (page < totalPages) paginationLinks.push(`<a href="/dashboard/webhooks?page=${page + 1}${statusFilter ? '&status=' + statusFilter : ''}" class="btn btn-sm">Next &raquo;</a>`);

    const html = `
      <h1>Webhook Deliveries</h1>
      <div style="display:flex;gap:8px;margin-bottom:16px">${filterLinks}</div>
      <div class="card">
        ${result.rows.length > 0
          ? `<table><thead><tr><th>URL</th><th>Status</th><th>Response Code</th><th>Attempts</th><th>Error</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>`
          : '<p style="color:var(--muted)">No webhook deliveries found.</p>'}
      </div>
      <div style="display:flex;gap:12px;align-items:center;margin-top:16px">${paginationLinks.join('')}</div>`;

    await req.session.save();
    return reply.type('text/html').send(dashboardLayout('Webhook Deliveries', 'webhooks', html, csrfToken));
  });

  // Settings
  app.get('/dashboard/settings', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.dashboardUser!;
    const csrfToken = ensureCsrfToken(req);

    const html = `
      <h1>Settings</h1>
      <div class="card">
        <h2 style="margin-bottom:16px">Account</h2>
        <div class="form-group" style="margin-bottom:16px">
          <label>Email</label>
          <input type="email" value="${escapeHtml(user.email)}" disabled style="max-width:400px">
        </div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Change Password</h2>
        <form method="POST" action="/auth/change-password">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <div class="form-group" style="margin-bottom:16px">
            <label>Current Password</label>
            <input type="password" name="currentPassword" required style="max-width:400px">
          </div>
          <div class="form-group" style="margin-bottom:16px">
            <label>New Password (min 8 characters)</label>
            <input type="password" name="newPassword" minlength="8" required style="max-width:400px">
          </div>
          <button type="submit" class="btn btn-primary">Change Password</button>
        </form>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Danger Zone</h2>
        <p style="color:var(--muted);margin-bottom:16px">Deleting your account will revoke all API keys and remove all data.</p>
        <form id="delete-account-form" method="POST" action="/dashboard/account" onsubmit="return confirm('Are you sure you want to delete your account? This cannot be undone.')">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <div class="form-group" style="margin-bottom:16px">
            <label>Confirm your password to delete account</label>
            <input type="password" name="password" required style="max-width:400px">
          </div>
          <button type="submit" class="btn btn-danger">Delete Account</button>
        </form>
      </div>
      <script>
        const form = document.getElementById('delete-account-form');
        if (form) {
          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(form);
            const password = String(formData.get('password') || '');
            const _csrf = String(formData.get('_csrf') || '');
            const res = await fetch('/dashboard/account', {
              method: 'DELETE',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ password, _csrf }),
            });
            if (res.redirected) {
              window.location.href = res.url;
              return;
            }
            if (res.ok) {
              window.location.href = '/login';
              return;
            }
            window.alert(await res.text());
          });
        }
      </script>`;

    await req.session.save();
    return reply.type('text/html').send(dashboardLayout('Settings', 'settings', html, csrfToken));
  });

  // Delete account
  const handleDeleteAccount = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).send('Invalid CSRF token');
    }

    const user = req.dashboardUser!;
    const { password } = req.body as { password: string; _csrf: string };

    if (!password) {
      return reply.status(400).send('Password required');
    }

    // Verify password
    const valid = await verifyUserPassword(user.id, password);
    if (!valid) {
      return reply.status(401).send('Incorrect password');
    }

    // Delete user (cascade deletes api keys, usage, render jobs, subscriptions via FK constraints)
    await deleteUser(user.id);

    // Destroy session
    req.session.destroy();

    return reply.redirect('/login');
  };

  app.delete('/dashboard/account', { preHandler: requireAuth }, handleDeleteAccount);
  // Backward-compatible endpoint for non-JS form submissions.
  app.post('/dashboard/account', { preHandler: requireAuth }, handleDeleteAccount);

  // Signed URLs page
  app.get('/dashboard/signed-urls', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.dashboardUser!;
    const csrfToken = ensureCsrfToken(req);
    const config = getConfig();

    const keys = await getUserApiKeys(user.id);

    const content = `
      <h1>Signed URLs</h1>
      <p style="color:var(--muted);margin-bottom:24px">Generate pre-authenticated URLs for embedding screenshots/PDFs without exposing your API key</p>

      <div class="card">
        <h2 style="margin-bottom:16px">Generate Signed URL</h2>
        <form id="signed-url-form">
          <div class="form-group" style="margin-bottom:16px">
            <label for="api-key">API Key</label>
            <select id="api-key" required style="width:100%">
              <option value="">Select an API key...</option>
              ${keys.map((k) => `<option value="${escapeHtml(k.id)}">${escapeHtml(k.name)} (${escapeHtml(k.prefix)})</option>`).join('')}
            </select>
          </div>

          <div class="form-group" style="margin-bottom:16px">
            <label for="type">Type</label>
            <select id="type" required style="width:100%">
              <option value="screenshot">Screenshot</option>
              <option value="pdf">PDF</option>
            </select>
          </div>

          <div class="form-group" style="margin-bottom:16px">
            <label for="url">Target URL</label>
            <input type="url" id="url" placeholder="https://example.com" required style="width:100%">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="width">Viewport Width</label>
              <input type="number" id="width" placeholder="1920" min="100" max="4096">
            </div>
            <div class="form-group">
              <label for="height">Viewport Height</label>
              <input type="number" id="height" placeholder="1080" min="100" max="4096">
            </div>
          </div>

          <div class="form-row screenshot-only">
            <div class="form-group">
              <label for="format">Format</label>
              <select id="format">
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
              </select>
            </div>
            <div class="form-group">
              <label for="fullPage">Full Page</label>
              <select id="fullPage">
                <option value="">No</option>
                <option value="true">Yes</option>
              </select>
            </div>
          </div>

          <div class="form-group" style="margin-bottom:16px">
            <label for="expiry">Expiry (seconds, max 30 days)</label>
            <input type="number" id="expiry" value="3600" min="60" max="2592000" required style="width:100%">
            <small style="color:var(--muted)">Default: 3600 (1 hour)</small>
          </div>

          <button type="submit" class="btn btn-primary">Generate Signed URL</button>
        </form>

        <div id="result" style="display:none;margin-top:24px">
          <h3 style="margin-bottom:12px">Generated Signed URL</h3>
          <div class="key-display" id="signed-url-display"></div>
          <button type="button" class="btn btn-primary btn-sm" onclick="copySignedUrl()">Copy to Clipboard</button>
          <p style="color:var(--muted);font-size:.85rem;margin-top:12px">This URL is valid until <span id="expiry-time"></span></p>
        </div>
      </div>

      <script>
        const form = document.getElementById('signed-url-form');
        const typeSelect = document.getElementById('type');
        const screenshotOnlyFields = document.querySelectorAll('.screenshot-only');

        typeSelect.addEventListener('change', () => {
          const isScreenshot = typeSelect.value === 'screenshot';
          screenshotOnlyFields.forEach(el => {
            el.style.display = isScreenshot ? 'flex' : 'none';
          });
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();

          const apiKeyId = document.getElementById('api-key').value;
          const type = document.getElementById('type').value;
          const url = document.getElementById('url').value;
          const width = document.getElementById('width').value;
          const height = document.getElementById('height').value;
          const format = document.getElementById('format').value;
          const fullPage = document.getElementById('fullPage').value;
          const expiry = parseInt(document.getElementById('expiry').value);

          const options = { type, url };
          if (width && height) {
            options.viewport = { width: parseInt(width), height: parseInt(height) };
          }
          if (type === 'screenshot') {
            if (format) options.format = format;
            if (fullPage) options.fullPage = fullPage === 'true';
          }

          try {
            const res = await fetch('/dashboard/signed-urls/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ apiKeyId, options, expiry }),
            });

            if (!res.ok) {
              throw new Error('Failed to generate signed URL');
            }

            const data = await res.json();
            const fullUrl = '${escapeHtml(config.BASE_URL)}' + data.signedUrl;

            document.getElementById('signed-url-display').textContent = fullUrl;
            document.getElementById('expiry-time').textContent = new Date(data.expiresAt).toLocaleString();
            document.getElementById('result').style.display = 'block';
          } catch (err) {
            alert('Error: ' + err.message);
          }
        });

        function copySignedUrl() {
          const text = document.getElementById('signed-url-display').textContent;
          navigator.clipboard.writeText(text).then(() => {
            alert('Copied to clipboard!');
          });
        }
      </script>
    `;

    return reply.type('text/html').send(dashboardLayout('Signed URLs', 'signed-urls', content, csrfToken));
  });

  // Signed URL generation API endpoint
  app.post('/dashboard/signed-urls/generate', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.dashboardUser!;
    const body = req.body as { apiKeyId: string; options: SignedUrlOptions; expiry: number };

    // Verify API key belongs to user
    const keys = await getUserApiKeys(user.id);
    const keyExists = keys.find((k) => k.id === body.apiKeyId);
    if (!keyExists) {
      return reply.status(403).send({ error: 'API key not found or access denied' });
    }

    // Get signing secret
    const apiKey = await getApiKeyWithSigningSecret(body.apiKeyId);
    if (!apiKey) {
      return reply.status(404).send({ error: 'API key not found' });
    }

    // Generate signed URL
    const signedUrl = generateSignedUrl(apiKey.id, apiKey.signingSecret, body.options, body.expiry);

    // Calculate expiry timestamp
    const expiresAt = Date.now() + body.expiry * 1000;

    return reply.send({ signedUrl, expiresAt });
  });

  // Analytics
  app.get('/dashboard/analytics', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.dashboardUser!;
    const keys = await getUserApiKeys(user.id);
    const csrfToken = ensureCsrfToken(req);
    const pool = getPool();

    // Aggregate across all user's API keys
    const keyIds = keys.map((k) => k.id);

    if (keyIds.length === 0) {
      const html = `
        <h1>Analytics</h1>
        <p style="color:var(--muted)">No API keys found. Create an API key to start seeing analytics.</p>`;
      await req.session.save();
      return reply.type('text/html').send(dashboardLayout('Analytics', 'analytics', html, csrfToken));
    }

    // Daily renders (last 30 days)
    const dailyResult = await pool.query(
      `SELECT date_trunc('day', rj.created_at)::date AS date,
              COUNT(*)::int AS count,
              COALESCE(AVG(rj.duration_ms)::int, 0) AS avg_duration_ms
       FROM render_jobs rj
       JOIN user_api_keys uak ON uak.api_key_id = rj.api_key_id
       WHERE uak.user_id = $1
         AND rj.created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY 1
       ORDER BY 1`,
      [user.id],
    );

    // Type breakdown (this month)
    const typeResult = await pool.query(
      `SELECT rj.type, COUNT(*)::int AS count
       FROM render_jobs rj
       JOIN user_api_keys uak ON uak.api_key_id = rj.api_key_id
       WHERE uak.user_id = $1
         AND rj.created_at >= date_trunc('month', CURRENT_DATE)
       GROUP BY rj.type
       ORDER BY count DESC`,
      [user.id],
    );

    // Top 10 URLs
    const topUrlsResult = await pool.query(
      `SELECT rj.url, COUNT(*)::int AS count,
              COALESCE(AVG(rj.duration_ms)::int, 0) AS avg_duration_ms
       FROM render_jobs rj
       JOIN user_api_keys uak ON uak.api_key_id = rj.api_key_id
       WHERE uak.user_id = $1
         AND rj.created_at >= date_trunc('month', CURRENT_DATE)
       GROUP BY rj.url
       ORDER BY count DESC
       LIMIT 10`,
      [user.id],
    );

    // Summary
    const summaryResult = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(AVG(rj.duration_ms)::int, 0) AS avg_duration_ms
       FROM render_jobs rj
       JOIN user_api_keys uak ON uak.api_key_id = rj.api_key_id
       WHERE uak.user_id = $1
         AND rj.created_at >= date_trunc('month', CURRENT_DATE)`,
      [user.id],
    );

    const totalMonth = summaryResult.rows[0]?.total ?? 0;
    const avgDuration = summaryResult.rows[0]?.avg_duration_ms ?? 0;
    const totalQuota = keys.reduce((sum, k) => sum + k.monthlyQuota, 0);
    const quotaPct = totalQuota > 0 ? Math.round((totalMonth / totalQuota) * 10000) / 100 : 0;

    const dailyData = JSON.stringify(dailyResult.rows.map((r: { date: string; count: number; avg_duration_ms: number }) => ({
      date: r.date,
      count: r.count,
      avgDurationMs: r.avg_duration_ms,
    })));

    const typeData = JSON.stringify(typeResult.rows.map((r: { type: string; count: number }) => ({
      type: r.type,
      count: r.count,
    })));

    const topUrlRows = topUrlsResult.rows.map((r: { url: string; count: number; avg_duration_ms: number }) =>
      `<tr>
        <td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.url)}</td>
        <td>${r.count}</td>
        <td>${r.avg_duration_ms}ms</td>
      </tr>`
    ).join('');

    const typeColors: Record<string, string> = {
      screenshot: '#6c63ff',
      pdf: '#00d4aa',
      og: '#ffaa33',
    };

    const html = `
      <h1>Analytics</h1>
      <div class="stats">
        <div class="stat"><div class="label">Renders This Month</div><div class="value">${totalMonth.toLocaleString()}</div></div>
        <div class="stat"><div class="label">Avg Duration</div><div class="value">${avgDuration}ms</div></div>
        <div class="stat"><div class="label">Quota Usage</div><div class="value">${quotaPct}%</div></div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Daily Renders (Last 30 Days)</h2>
        <canvas id="dailyChart" height="220"></canvas>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Render Type Breakdown</h2>
        <canvas id="typeChart" height="180"></canvas>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Top Rendered URLs</h2>
        ${topUrlsResult.rows.length > 0
          ? `<table><thead><tr><th>URL</th><th>Count</th><th>Avg Duration</th></tr></thead><tbody>${topUrlRows}</tbody></table>`
          : '<p style="color:var(--muted)">No renders yet this month.</p>'}
      </div>
      <script>
        const dailyData = ${dailyData};
        const typeData = ${typeData};
        const typeColors = ${JSON.stringify(typeColors)};

        function drawLineChart(canvasId, data) {
          const canvas = document.getElementById(canvasId);
          if (!canvas || !data.length) return;
          const ctx = canvas.getContext('2d');
          const W = canvas.width = canvas.offsetWidth;
          const H = canvas.height;
          const pad = { top: 20, right: 20, bottom: 40, left: 50 };
          const cW = W - pad.left - pad.right;
          const cH = H - pad.top - pad.bottom;
          const max = Math.max(...data.map(d => d.count), 1);

          ctx.fillStyle = '#12121a';
          ctx.fillRect(0, 0, W, H);

          // Grid lines
          ctx.strokeStyle = '#1e1e2e';
          ctx.lineWidth = 1;
          for (let i = 0; i <= 4; i++) {
            const y = pad.top + (cH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(W - pad.right, y);
            ctx.stroke();
            ctx.fillStyle = '#8888a0';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(String(Math.round(max * (4 - i) / 4)), pad.left - 8, y + 4);
          }

          // Line
          ctx.strokeStyle = '#6c63ff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          data.forEach((d, i) => {
            const x = pad.left + (i / Math.max(data.length - 1, 1)) * cW;
            const y = pad.top + cH - (d.count / max) * cH;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          });
          ctx.stroke();

          // Fill area under line
          const lastX = pad.left + ((data.length - 1) / Math.max(data.length - 1, 1)) * cW;
          ctx.lineTo(lastX, pad.top + cH);
          ctx.lineTo(pad.left, pad.top + cH);
          ctx.closePath();
          ctx.fillStyle = 'rgba(108, 99, 255, 0.1)';
          ctx.fill();

          // X-axis labels (show every 5th)
          ctx.fillStyle = '#8888a0';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          data.forEach((d, i) => {
            if (i % 5 === 0 || i === data.length - 1) {
              const x = pad.left + (i / Math.max(data.length - 1, 1)) * cW;
              const label = new Date(d.date).toLocaleDateString('en', { month: 'short', day: 'numeric' });
              ctx.fillText(label, x, H - 10);
            }
          });
        }

        function drawStackedBar(canvasId, data) {
          const canvas = document.getElementById(canvasId);
          if (!canvas || !data.length) return;
          const ctx = canvas.getContext('2d');
          const W = canvas.width = canvas.offsetWidth;
          const H = canvas.height;
          const pad = { top: 20, right: 20, bottom: 40, left: 50 };
          const cW = W - pad.left - pad.right;
          const cH = H - pad.top - pad.bottom;
          const total = data.reduce((s, d) => s + d.count, 0);
          const max = Math.max(...data.map(d => d.count), 1);

          ctx.fillStyle = '#12121a';
          ctx.fillRect(0, 0, W, H);

          const barW = Math.min(80, cW / data.length - 20);
          const gap = (cW - barW * data.length) / (data.length + 1);

          data.forEach((d, i) => {
            const x = pad.left + gap + i * (barW + gap);
            const h = (d.count / max) * cH;
            ctx.fillStyle = typeColors[d.type] || '#6c63ff';
            ctx.fillRect(x, pad.top + cH - h, barW, h);

            // Label
            ctx.fillStyle = '#e0e0e8';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(d.type, x + barW / 2, H - 18);
            ctx.fillText(String(d.count), x + barW / 2, pad.top + cH - h - 6);
          });
        }

        drawLineChart('dailyChart', dailyData);
        drawStackedBar('typeChart', typeData);
      </script>`;

    await req.session.save();
    return reply.type('text/html').send(dashboardLayout('Analytics', 'analytics', html, csrfToken));
  });
}
