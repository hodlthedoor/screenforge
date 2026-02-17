import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getUserById, listAllUsers, toggleUserActive, changeUserTier, getAdminUserDetail } from '../db/users.js';
import { getPool } from '../db/index.js';
import { getAnalyticsMetrics } from '../db/analytics.js';
import { getQueueMetrics, getQueue } from '../queue/render-queue.js';
import { getConfig } from '../config/index.js';
import { getStorageBackend } from '../storage/index.js';
import { escapeHtml, generateCsrfToken } from '../utils/html.js';
import { statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Redis } from 'ioredis';

// Admin session auth guard
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    return reply.redirect('/login');
  }
  const user = await getUserById(userId);
  if (!user || !user.isAdmin) {
    return reply.status(403).type('text/html').send(errorPage('Access Denied', 'You do not have admin privileges.'));
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

function errorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)} — ScreenForge Admin</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0a0a0f;--surface:#12121a;--border:#1e1e2e;--text:#e0e0e8;--accent:#6c63ff}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:40px;max-width:400px;text-align:center}
  h1{font-size:1.5rem;margin-bottom:16px}
  a{color:var(--accent)}
</style></head><body>
<div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p style="margin-top:16px"><a href="/dashboard">Back to Dashboard</a></p></div>
</body></html>`;
}

function adminLayout(title: string, nav: string, content: string, csrfToken: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)} — ScreenForge Admin</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0a0a0f;--surface:#12121a;--border:#1e1e2e;--text:#e0e0e8;--muted:#8888a0;--accent:#6c63ff;--accent2:#00d4aa;--err:#ff4466;--warn:#ffaa33}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
  a{color:var(--accent);text-decoration:none}
  .layout{display:flex;min-height:100vh}
  .sidebar{width:220px;background:var(--surface);border-right:1px solid var(--border);padding:24px 0;flex-shrink:0}
  .sidebar .logo{padding:0 20px 24px;font-size:1.1rem;font-weight:700;border-bottom:1px solid var(--border);margin-bottom:16px}
  .sidebar .logo span{color:var(--err);font-size:.75rem;margin-left:6px;text-transform:uppercase;letter-spacing:1px}
  .sidebar a{display:block;padding:10px 20px;color:var(--muted);font-size:.95rem}
  .sidebar a:hover,.sidebar a.active{color:var(--text);background:rgba(108,99,255,.1)}
  .sidebar .sep{border-top:1px solid var(--border);margin:12px 0}
  .main{flex:1;padding:32px;overflow-x:auto}
  .main h1{font-size:1.8rem;margin-bottom:24px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:20px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
  .stat{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px}
  .stat .label{font-size:.85rem;color:var(--muted);margin-bottom:4px}
  .stat .value{font-size:1.8rem;font-weight:700}
  table{width:100%;border-collapse:collapse}
  th,td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--border)}
  th{font-size:.85rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
  .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:.8rem;font-weight:600}
  .badge-active{background:rgba(0,212,170,.15);color:var(--accent2)}
  .badge-suspended{background:rgba(255,68,102,.15);color:var(--err)}
  .badge-admin{background:rgba(108,99,255,.15);color:var(--accent)}
  .badge-free{background:rgba(136,136,160,.15);color:var(--muted)}
  .badge-starter{background:rgba(0,212,170,.15);color:var(--accent2)}
  .badge-pro{background:rgba(108,99,255,.15);color:var(--accent)}
  .badge-business{background:rgba(255,170,51,.15);color:var(--warn)}
  .badge-failed{background:rgba(255,68,102,.15);color:var(--err)}
  .badge-completed{background:rgba(0,212,170,.15);color:var(--accent2)}
  .badge-waiting,.badge-pending{background:rgba(136,136,160,.15);color:var(--muted)}
  .btn{display:inline-block;padding:8px 16px;border-radius:6px;font-size:.9rem;font-weight:600;border:none;cursor:pointer;transition:opacity .2s}
  .btn-primary{background:var(--accent);color:#fff}
  .btn-danger{background:var(--err);color:#fff}
  .btn-sm{padding:4px 12px;font-size:.8rem}
  input,select{padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.9rem}
  input:focus,select:focus{outline:none;border-color:var(--accent)}
  .form-row{display:flex;gap:12px;align-items:end;margin-bottom:16px;flex-wrap:wrap}
  .pagination{display:flex;gap:8px;margin-top:16px;align-items:center;justify-content:center}
  .pagination a,.pagination span{padding:6px 14px;border-radius:6px;font-size:.9rem}
  .pagination a{background:var(--surface);border:1px solid var(--border);color:var(--text)}
  .pagination span{background:var(--accent);color:#fff}
  .chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}
  @media(max-width:1000px){.chart-grid{grid-template-columns:1fr}}
  @media(max-width:768px){.layout{flex-direction:column}.sidebar{width:100%;display:flex;overflow-x:auto;padding:12px 0}.sidebar a{white-space:nowrap}.sidebar .sep{display:none}}
</style></head><body>
<div class="layout">
  <nav class="sidebar">
    <div class="logo">ScreenForge <span>Admin</span></div>
    <a href="/admin" class="${nav === 'dashboard' ? 'active' : ''}">Dashboard</a>
    <a href="/admin/users" class="${nav === 'users' ? 'active' : ''}">Users</a>
    <a href="/admin/analytics" class="${nav === 'analytics' ? 'active' : ''}">Analytics</a>
    <a href="/admin/queue" class="${nav === 'queue' ? 'active' : ''}">Queue</a>
    <a href="/admin/storage" class="${nav === 'storage' ? 'active' : ''}">Storage</a>
    <div class="sep"></div>
    <a href="/dashboard">User Dashboard</a>
    <form method="POST" action="/logout" style="padding:10px 20px"><input type="hidden" name="_csrf" value="${csrfToken}"><button type="submit" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.95rem">Log Out</button></form>
  </nav>
  <main class="main">${content}</main>
</div></body></html>`;
}

function getDirSize(dirPath: string): number {
  let total = 0;
  try {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      try {
        const s = statSync(join(dirPath, entry));
        if (s.isFile()) total += s.size;
      } catch { /* skip */ }
    }
  } catch { /* dir doesn't exist */ }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export async function adminPanelRoutes(app: FastifyInstance): Promise<void> {
  const config = getConfig();

  // Dashboard overview
  app.get('/admin', { preHandler: requireAdmin }, async (req, reply) => {
    const csrfToken = ensureCsrfToken(req);
    const pool = getPool();

    // Total users
    const usersResult = await pool.query('SELECT COUNT(*)::int as total FROM users');
    const totalUsers = usersResult.rows[0].total;

    // Renders today/week/month
    const rendersResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int as today,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::int as week,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE))::int as month
      FROM render_jobs
    `);
    const renders = rendersResult.rows[0];

    // Queue depth
    let queueStats = { waiting: 0, active: 0, completed: 0, failed: 0 };
    try {
      queueStats = await getQueueMetrics(config.REDIS_URL);
    } catch { /* queue not initialized */ }

    // Storage used
    const storageUsed = getDirSize(config.STORAGE_PATH);

    // Subscriptions by tier
    const subsResult = await pool.query(`
      SELECT plan, COUNT(*)::int as count
      FROM subscriptions WHERE status = 'active'
      GROUP BY plan ORDER BY plan
    `);

    const html = `
      <h1>Admin Dashboard</h1>
      <div class="stats">
        <div class="stat"><div class="label">Total Users</div><div class="value">${totalUsers}</div></div>
        <div class="stat"><div class="label">Renders Today</div><div class="value">${renders.today}</div></div>
        <div class="stat"><div class="label">Renders This Week</div><div class="value">${renders.week}</div></div>
        <div class="stat"><div class="label">Renders This Month</div><div class="value">${renders.month}</div></div>
        <div class="stat"><div class="label">Queue Depth</div><div class="value">${queueStats.waiting + queueStats.active}</div></div>
        <div class="stat"><div class="label">Storage Used</div><div class="value">${formatBytes(storageUsed)}</div></div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Active Subscriptions</h2>
        ${subsResult.rows.length > 0 ? `<table><thead><tr><th>Plan</th><th>Count</th></tr></thead><tbody>${subsResult.rows.map((r: { plan: string; count: number }) => `<tr><td><span class="badge badge-${r.plan}">${escapeHtml(r.plan)}</span></td><td>${r.count}</td></tr>`).join('')}</tbody></table>` : '<p style="color:var(--muted)">No active subscriptions.</p>'}
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Queue Status</h2>
        <div class="stats">
          <div class="stat"><div class="label">Waiting</div><div class="value">${queueStats.waiting}</div></div>
          <div class="stat"><div class="label">Active</div><div class="value">${queueStats.active}</div></div>
          <div class="stat"><div class="label">Completed</div><div class="value">${queueStats.completed}</div></div>
          <div class="stat"><div class="label">Failed</div><div class="value">${queueStats.failed}</div></div>
        </div>
      </div>`;

    await req.session.save();
    return reply.type('text/html').send(adminLayout('Dashboard', 'dashboard', html, csrfToken));
  });

  // Users list
  app.get('/admin/users', { preHandler: requireAdmin }, async (req, reply) => {
    const csrfToken = ensureCsrfToken(req);
    const query = req.query as { page?: string; search?: string };
    const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
    const search = query.search?.trim() || undefined;

    const { users, total } = await listAllUsers({ page, perPage: 25, search });
    const totalPages = Math.max(1, Math.ceil(total / 25));

    const searchParam = search ? `&search=${encodeURIComponent(search)}` : '';

    const userRows = users.map((u) =>
      `<tr>
        <td><a href="/admin/users/${u.id}">${escapeHtml(u.email)}</a></td>
        <td><span class="badge badge-${u.tier}">${escapeHtml(u.tier)}</span></td>
        <td>${u.rendersThisMonth}</td>
        <td>${u.isAdmin ? '<span class="badge badge-admin">admin</span>' : ''}
            ${u.active ? '<span class="badge badge-active">active</span>' : '<span class="badge badge-suspended">suspended</span>'}</td>
        <td>${new Date(u.createdAt).toLocaleDateString()}</td>
      </tr>`
    ).join('');

    let paginationHtml = '<div class="pagination">';
    if (page > 1) paginationHtml += `<a href="/admin/users?page=${page - 1}${searchParam}">&laquo; Prev</a>`;
    paginationHtml += `<span>${page} / ${totalPages}</span>`;
    if (page < totalPages) paginationHtml += `<a href="/admin/users?page=${page + 1}${searchParam}">Next &raquo;</a>`;
    paginationHtml += '</div>';

    const html = `
      <h1>Users <span style="font-size:.9rem;color:var(--muted);font-weight:400">(${total} total)</span></h1>
      <div class="card">
        <form method="GET" action="/admin/users" class="form-row">
          <input type="text" name="search" placeholder="Search by email..." value="${escapeHtml(search ?? '')}" style="flex:1;min-width:200px">
          <button type="submit" class="btn btn-primary">Search</button>
          ${search ? '<a href="/admin/users" class="btn" style="background:var(--border);color:var(--text)">Clear</a>' : ''}
        </form>
      </div>
      <div class="card">
        ${users.length > 0 ? `<table><thead><tr><th>Email</th><th>Tier</th><th>Renders/Mo</th><th>Status</th><th>Joined</th></tr></thead><tbody>${userRows}</tbody></table>` : '<p style="color:var(--muted)">No users found.</p>'}
        ${total > 25 ? paginationHtml : ''}
      </div>`;

    await req.session.save();
    return reply.type('text/html').send(adminLayout('Users', 'users', html, csrfToken));
  });

  // User detail
  app.get('/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const csrfToken = ensureCsrfToken(req);
    const { id } = req.params as { id: string };
    const detail = await getAdminUserDetail(id);

    if (!detail) {
      return reply.status(404).type('text/html').send(errorPage('Not Found', 'User not found.'));
    }

    const { user, keys, subscription, recentRenders } = detail;

    const keyRows = keys.map((k) =>
      `<tr><td>${escapeHtml(k.name)}</td><td><code>${escapeHtml(k.prefix)}...</code></td><td>${k.tier}</td><td><span class="badge ${k.active ? 'badge-active' : 'badge-suspended'}">${k.active ? 'Active' : 'Revoked'}</span></td></tr>`
    ).join('');

    const renderRows = recentRenders.map((r) =>
      `<tr><td>${escapeHtml(r.type)}</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.url)}</td><td><span class="badge badge-${r.status}">${r.status}</span></td><td>${new Date(r.createdAt).toLocaleString()}</td></tr>`
    ).join('');

    const html = `
      <h1 style="display:flex;align-items:center;gap:12px">
        ${escapeHtml(user.email)}
        ${user.isAdmin ? '<span class="badge badge-admin">admin</span>' : ''}
        ${user.active ? '<span class="badge badge-active">active</span>' : '<span class="badge badge-suspended">suspended</span>'}
      </h1>
      <p style="color:var(--muted);margin:-16px 0 24px">ID: ${escapeHtml(user.id)} &middot; Joined: ${new Date(user.createdAt).toLocaleDateString()}</p>

      <div class="card">
        <h2 style="margin-bottom:16px">Actions</h2>
        <div class="form-row">
          <form method="POST" action="/admin/users/${user.id}/suspend">
            <input type="hidden" name="_csrf" value="${csrfToken}">
            <button type="submit" class="btn ${user.active ? 'btn-danger' : 'btn-primary'}">${user.active ? 'Suspend User' : 'Reactivate User'}</button>
          </form>
          <form method="POST" action="/admin/users/${user.id}/tier" style="display:flex;gap:8px;align-items:end">
            <input type="hidden" name="_csrf" value="${csrfToken}">
            <select name="tier">
              ${['free', 'starter', 'pro', 'business'].map((t) => `<option value="${t}">${t}</option>`).join('')}
            </select>
            <button type="submit" class="btn btn-primary btn-sm">Change Tier</button>
          </form>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-bottom:16px">Subscription</h2>
        ${subscription ? `<p>Plan: <span class="badge badge-${subscription.plan}">${subscription.plan}</span> &middot; Status: ${subscription.status} &middot; Renews: ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>` : '<p style="color:var(--muted)">No active subscription (free tier).</p>'}
      </div>

      <div class="card">
        <h2 style="margin-bottom:16px">API Keys (${keys.length})</h2>
        ${keys.length > 0 ? `<table><thead><tr><th>Name</th><th>Prefix</th><th>Tier</th><th>Status</th></tr></thead><tbody>${keyRows}</tbody></table>` : '<p style="color:var(--muted)">No API keys.</p>'}
      </div>

      <div class="card">
        <h2 style="margin-bottom:16px">Recent Renders</h2>
        ${recentRenders.length > 0 ? `<table><thead><tr><th>Type</th><th>URL</th><th>Status</th><th>Date</th></tr></thead><tbody>${renderRows}</tbody></table>` : '<p style="color:var(--muted)">No renders yet.</p>'}
      </div>

      <p style="margin-top:16px"><a href="/admin/users">&laquo; Back to users</a></p>`;

    await req.session.save();
    return reply.type('text/html').send(adminLayout(`User: ${user.email}`, 'users', html, csrfToken));
  });

  // Suspend/reactivate user
  app.post('/admin/users/:id/suspend', { preHandler: requireAdmin }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).redirect('/admin/users');
    }
    const { id } = req.params as { id: string };
    await toggleUserActive(id);
    req.session.csrfToken = generateCsrfToken();
    await req.session.save();
    return reply.redirect(`/admin/users/${id}`);
  });

  // Change user tier
  app.post('/admin/users/:id/tier', { preHandler: requireAdmin }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).redirect('/admin/users');
    }
    const { id } = req.params as { id: string };
    const { tier } = req.body as { tier: string; _csrf: string };
    const validTiers = ['free', 'starter', 'pro', 'business'];
    if (validTiers.includes(tier)) {
      await changeUserTier(id, tier);
    }
    req.session.csrfToken = generateCsrfToken();
    await req.session.save();
    return reply.redirect(`/admin/users/${id}`);
  });

  // Queue management
  app.get('/admin/queue', { preHandler: requireAdmin }, async (req, reply) => {
    const csrfToken = ensureCsrfToken(req);

    let queueStats = { waiting: 0, active: 0, completed: 0, failed: 0 };
    try {
      queueStats = await getQueueMetrics(config.REDIS_URL);
    } catch { /* queue not initialized */ }

    // Get recent failed jobs from DB
    const failedResult = await getPool().query(
      `SELECT id, type, url, error, created_at FROM render_jobs
       WHERE status = 'failed'
       ORDER BY created_at DESC LIMIT 20`,
    );

    const failedRows = failedResult.rows.map((r: { id: string; type: string; url: string; error: string | null; created_at: Date }) =>
      `<tr>
        <td style="font-family:monospace;font-size:.8rem">${escapeHtml(r.id.slice(0, 8))}...</td>
        <td>${escapeHtml(r.type)}</td>
        <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.url)}</td>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--err)">${escapeHtml(r.error ?? 'Unknown')}</td>
        <td>${new Date(r.created_at).toLocaleString()}</td>
        <td><form method="POST" action="/admin/queue/${r.id}/retry" style="display:inline"><input type="hidden" name="_csrf" value="${csrfToken}"><button type="submit" class="btn btn-primary btn-sm">Retry</button></form></td>
      </tr>`
    ).join('');

    const html = `
      <h1>Queue Management</h1>
      <div class="stats">
        <div class="stat"><div class="label">Waiting</div><div class="value">${queueStats.waiting}</div></div>
        <div class="stat"><div class="label">Active</div><div class="value">${queueStats.active}</div></div>
        <div class="stat"><div class="label">Completed</div><div class="value">${queueStats.completed}</div></div>
        <div class="stat"><div class="label">Failed</div><div class="value">${queueStats.failed}</div></div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Recent Failed Jobs</h2>
        ${failedResult.rows.length > 0 ? `<table><thead><tr><th>ID</th><th>Type</th><th>URL</th><th>Error</th><th>Date</th><th>Action</th></tr></thead><tbody>${failedRows}</tbody></table>` : '<p style="color:var(--muted)">No failed jobs.</p>'}
      </div>`;

    await req.session.save();
    return reply.type('text/html').send(adminLayout('Queue', 'queue', html, csrfToken));
  });

  // Retry a failed job
  app.post('/admin/queue/:jobId/retry', { preHandler: requireAdmin }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).redirect('/admin/queue');
    }

    const { jobId } = req.params as { jobId: string };
    const pool = getPool();

    // Get the failed job's data
    const jobResult = await pool.query(
      'SELECT id, api_key_id, type, url, options, callback_url, batch_id, priority FROM render_jobs WHERE id = $1 AND status = $2',
      [jobId, 'failed'],
    );

    if (jobResult.rows.length > 0) {
      const row = jobResult.rows[0];
      // Reset job status to pending
      await pool.query(
        "UPDATE render_jobs SET status = 'pending', error = NULL, completed_at = NULL WHERE id = $1",
        [jobId],
      );

      // Re-enqueue to BullMQ with original priority
      try {
        const q = getQueue(config.REDIS_URL);
        await q.add('render', {
          jobId: row.id,
          apiKeyId: row.api_key_id,
          type: row.type,
          url: row.url,
          options: row.options,
          callbackUrl: row.callback_url,
          batchId: row.batch_id,
        }, { priority: row.priority ?? undefined });
      } catch { /* queue error - job is still reset in DB */ }
    }

    req.session.csrfToken = generateCsrfToken();
    await req.session.save();
    return reply.redirect('/admin/queue');
  });

  // Storage management
  app.get('/admin/storage', { preHandler: requireAdmin }, async (req, reply) => {
    const csrfToken = ensureCsrfToken(req);

    const storageUsed = getDirSize(config.STORAGE_PATH);

    // Get cache hit/miss from Redis
    let cacheHits = 0;
    let cacheMisses = 0;
    try {
      const redis = new Redis(config.REDIS_URL);
      const info = await redis.info('stats');
      const hitsMatch = info.match(/keyspace_hits:(\d+)/);
      const missesMatch = info.match(/keyspace_misses:(\d+)/);
      if (hitsMatch) cacheHits = parseInt(hitsMatch[1], 10);
      if (missesMatch) cacheMisses = parseInt(missesMatch[1], 10);
      await redis.quit();
    } catch { /* redis not available */ }

    const totalRequests = cacheHits + cacheMisses;
    const hitRate = totalRequests > 0 ? ((cacheHits / totalRequests) * 100).toFixed(1) : '0.0';

    // Count cached files
    let fileCount = 0;
    try {
      fileCount = readdirSync(config.STORAGE_PATH).length;
    } catch { /* dir doesn't exist */ }

    const html = `
      <h1>Storage</h1>
      <div class="stats">
        <div class="stat"><div class="label">Disk Usage</div><div class="value">${formatBytes(storageUsed)}</div></div>
        <div class="stat"><div class="label">Cached Files</div><div class="value">${fileCount}</div></div>
        <div class="stat"><div class="label">Cache Hit Rate</div><div class="value">${hitRate}%</div></div>
        <div class="stat"><div class="label">Cache Hits</div><div class="value">${cacheHits.toLocaleString()}</div></div>
        <div class="stat"><div class="label">Cache Misses</div><div class="value">${cacheMisses.toLocaleString()}</div></div>
      </div>
      <div class="card">
        <h2 style="margin-bottom:16px">Cleanup</h2>
        <p style="color:var(--muted);margin-bottom:16px">Remove cached files for completed render jobs older than 24 hours.</p>
        <form method="POST" action="/admin/storage/cleanup">
          <input type="hidden" name="_csrf" value="${csrfToken}">
          <button type="submit" class="btn btn-danger" onclick="return confirm('Delete expired cache entries?')">Run Cleanup</button>
        </form>
      </div>`;

    await req.session.save();
    return reply.type('text/html').send(adminLayout('Storage', 'storage', html, csrfToken));
  });

  // Analytics dashboard
  app.get('/admin/analytics', { preHandler: requireAdmin }, async (req, reply) => {
    const csrfToken = ensureCsrfToken(req);

    const metrics = await getAnalyticsMetrics();

    const successRate = metrics.successRate.toFixed(1);
    const failureRate = metrics.failureRate.toFixed(1);
    const conversionRate = metrics.conversionRate.toFixed(1);
    const churnRate = metrics.churnRate.toFixed(1);

    // Serialize data for JS
    const trendLabels = JSON.stringify(metrics.dailyTrend.map((r) => r.date));
    const trendData = JSON.stringify(metrics.dailyTrend.map((r) => r.count));
    const typeLabels = JSON.stringify(metrics.rendersByType.map((r) => r.type));
    const typeData = JSON.stringify(metrics.rendersByType.map((r) => r.count));
    const tierLabels = JSON.stringify(metrics.tierDistribution.map((r) => r.tier));
    const tierData = JSON.stringify(metrics.tierDistribution.map((r) => r.count));
    const funnelLabels = JSON.stringify(['Signups', 'Verified', 'First Render', 'Paid']);
    const funnelData = JSON.stringify([metrics.funnel.signups, metrics.funnel.verified, metrics.funnel.first_render, metrics.funnel.paid]);

    const topKeysRows = metrics.topApiKeys.map((r) =>
      `<tr><td>${escapeHtml(r.name)}</td><td>${r.count}</td></tr>`,
    ).join('');

    const html = `
      <h1>Analytics</h1>
      <div class="stats">
        <div class="stat"><div class="label">DAU (Today)</div><div class="value">${metrics.dau}</div></div>
        <div class="stat"><div class="label">WAU (7d)</div><div class="value">${metrics.wau}</div></div>
        <div class="stat"><div class="label">MAU (30d)</div><div class="value">${metrics.mau}</div></div>
        <div class="stat"><div class="label">Success Rate</div><div class="value" style="color:var(--accent2)">${successRate}%</div></div>
        <div class="stat"><div class="label">Failure Rate</div><div class="value" style="color:var(--err)">${failureRate}%</div></div>
        <div class="stat"><div class="label">Conversion</div><div class="value" style="color:var(--accent)">${conversionRate}%</div></div>
        <div class="stat"><div class="label">Churn Rate</div><div class="value" style="color:var(--warn)">${churnRate}%</div></div>
      </div>

      <div class="chart-grid">
        <div class="card">
          <h2 style="margin-bottom:16px">Daily Active Users (30d)</h2>
          <canvas id="dauChart" height="200"></canvas>
        </div>
        <div class="card">
          <h2 style="margin-bottom:16px">Renders by Type (30d)</h2>
          <canvas id="typeChart" height="200"></canvas>
        </div>
      </div>

      <div class="chart-grid">
        <div class="card">
          <h2 style="margin-bottom:16px">Tier Distribution</h2>
          <canvas id="tierChart" height="200"></canvas>
        </div>
        <div class="card">
          <h2 style="margin-bottom:16px">Conversion Funnel</h2>
          <canvas id="funnelChart" height="200"></canvas>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-bottom:16px">Top 10 API Keys (30d)</h2>
        ${metrics.topApiKeys.length > 0
    ? `<table><thead><tr><th>Key Name</th><th>Renders</th></tr></thead><tbody>${topKeysRows}</tbody></table>`
    : '<p style="color:var(--muted)">No render activity in the last 30 days.</p>'}
      </div>

      <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
      <script>
        const accent = '#6c63ff', accent2 = '#00d4aa', warn = '#ffaa33', err = '#ff4466', muted = '#8888a0';
        const COLORS = [accent, accent2, warn, err, muted, '#44aaff', '#ff66cc', '#66ffaa'];
        Chart.defaults.color = '#e0e0e8';
        Chart.defaults.borderColor = '#1e1e2e';

        // DAU line chart
        new Chart(document.getElementById('dauChart'), {
          type: 'line',
          data: {
            labels: ${trendLabels},
            datasets: [{ label: 'DAU', data: ${trendData}, borderColor: accent, backgroundColor: accent + '22', tension: 0.3, fill: true, pointRadius: 3 }]
          },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8 } } } }
        });

        // Renders by type bar chart
        new Chart(document.getElementById('typeChart'), {
          type: 'bar',
          data: {
            labels: ${typeLabels},
            datasets: [{ label: 'Renders', data: ${typeData}, backgroundColor: COLORS, borderRadius: 4 }]
          },
          options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });

        // Tier distribution pie chart
        new Chart(document.getElementById('tierChart'), {
          type: 'pie',
          data: {
            labels: ${tierLabels},
            datasets: [{ data: ${tierData}, backgroundColor: COLORS }]
          },
          options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        });

        // Funnel bar chart (horizontal)
        new Chart(document.getElementById('funnelChart'), {
          type: 'bar',
          data: {
            labels: ${funnelLabels},
            datasets: [{ label: 'Users', data: ${funnelData}, backgroundColor: [accent, accent2, warn, err], borderRadius: 4 }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true } }
          }
        });
      </script>`;

    await req.session.save();
    return reply.type('text/html').send(adminLayout('Analytics', 'analytics', html, csrfToken));
  });

  // Storage cleanup
  app.post('/admin/storage/cleanup', { preHandler: requireAdmin }, async (req, reply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).redirect('/admin/storage');
    }

    const pool = getPool();
    // Get completed jobs older than 24h with result_path
    const oldJobs = await pool.query(
      `SELECT id, result_path FROM render_jobs
       WHERE status = 'completed' AND completed_at < NOW() - INTERVAL '24 hours' AND result_path IS NOT NULL`,
    );

    const storage = getStorageBackend();
    for (const row of oldJobs.rows) {
      try {
        await storage.delete(row.result_path);
      } catch { /* file may already be removed */ }
    }

    // Clear the result_path for cleaned entries
    if (oldJobs.rows.length > 0) {
      const ids = oldJobs.rows.map((r: { id: string }) => r.id);
      await pool.query(
        `UPDATE render_jobs SET result_path = NULL WHERE id = ANY($1)`,
        [ids],
      );
    }

    req.session.csrfToken = generateCsrfToken();
    await req.session.save();
    return reply.redirect('/admin/storage');
  });
}
