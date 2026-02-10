import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createUser, verifyUser } from '../db/users.js';
import { escapeHtml, generateCsrfToken } from '../utils/html.js';

interface AuthBody {
  email: string;
  password: string;
  _csrf: string;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function loginHtml(csrfToken: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Login — ScreenForge</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0a0a0f;--surface:#12121a;--border:#1e1e2e;--text:#e0e0e8;--muted:#8888a0;--accent:#6c63ff;--err:#ff4466}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:40px;width:100%;max-width:400px}
  h1{font-size:1.5rem;margin-bottom:24px;text-align:center}
  label{display:block;margin-bottom:4px;font-size:.9rem;color:var(--muted)}
  input{width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:1rem;margin-bottom:16px}
  input:focus{outline:none;border-color:var(--accent)}
  button{width:100%;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}
  button:hover{opacity:.9}
  .error{color:var(--err);font-size:.9rem;margin-bottom:16px;text-align:center}
  .link{text-align:center;margin-top:16px;font-size:.9rem;color:var(--muted)}
  .link a{color:var(--accent);text-decoration:none}
</style></head><body>
<div class="card">
  <h1>Log In</h1>
  ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
  <form method="POST" action="/login">
    <input type="hidden" name="_csrf" value="${csrfToken}">
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required>
    <button type="submit">Log In</button>
  </form>
  <div class="link">Don't have an account? <a href="/register">Sign up</a></div>
</div></body></html>`;
}

function registerHtml(csrfToken: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Register — ScreenForge</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0a0a0f;--surface:#12121a;--border:#1e1e2e;--text:#e0e0e8;--muted:#8888a0;--accent:#6c63ff;--err:#ff4466}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:40px;width:100%;max-width:400px}
  h1{font-size:1.5rem;margin-bottom:24px;text-align:center}
  label{display:block;margin-bottom:4px;font-size:.9rem;color:var(--muted)}
  input{width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:1rem;margin-bottom:16px}
  input:focus{outline:none;border-color:var(--accent)}
  button{width:100%;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}
  button:hover{opacity:.9}
  .error{color:var(--err);font-size:.9rem;margin-bottom:16px;text-align:center}
  .link{text-align:center;margin-top:16px;font-size:.9rem;color:var(--muted)}
  .link a{color:var(--accent);text-decoration:none}
</style></head><body>
<div class="card">
  <h1>Create Account</h1>
  ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
  <form method="POST" action="/register">
    <input type="hidden" name="_csrf" value="${csrfToken}">
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required>
    <label for="password">Password (min 8 characters)</label>
    <input type="password" id="password" name="password" minlength="8" required>
    <button type="submit">Create Account</button>
  </form>
  <div class="link">Already have an account? <a href="/login">Log in</a></div>
</div></body></html>`;
}

function ensureCsrfToken(req: FastifyRequest): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  return req.session.csrfToken;
}

function verifyCsrf(req: FastifyRequest<{ Body: AuthBody }>): boolean {
  const token = req.body?._csrf;
  const expected = req.session.csrfToken;
  return !!token && !!expected && token === expected;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/login', async (req, reply) => {
    const token = ensureCsrfToken(req);
    await req.session.save();
    return reply.type('text/html').send(loginHtml(token));
  });

  app.get('/register', async (req, reply) => {
    const token = ensureCsrfToken(req);
    await req.session.save();
    return reply.type('text/html').send(registerHtml(token));
  });

  app.post('/register', async (req: FastifyRequest<{ Body: AuthBody }>, reply: FastifyReply) => {
    const { email, password } = req.body ?? {};

    if (!verifyCsrf(req)) {
      const token = ensureCsrfToken(req);
      req.session.csrfToken = generateCsrfToken();
      await req.session.save();
      return reply.status(403).type('text/html').send(registerHtml(token, 'Invalid form submission. Please try again.'));
    }

    if (!email || !validateEmail(email)) {
      const token = ensureCsrfToken(req);
      await req.session.save();
      return reply.status(400).type('text/html').send(registerHtml(token, 'Invalid email address'));
    }
    if (!password || password.length < 8) {
      const token = ensureCsrfToken(req);
      await req.session.save();
      return reply.status(400).type('text/html').send(registerHtml(token, 'Password must be at least 8 characters'));
    }

    try {
      const user = await createUser(email, password);
      req.session.userId = user.id;
      req.session.csrfToken = generateCsrfToken();
      await req.session.save();
      return reply.redirect('/dashboard');
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        const token = ensureCsrfToken(req);
        await req.session.save();
        return reply.status(409).type('text/html').send(registerHtml(token, 'Email already registered'));
      }
      throw err;
    }
  });

  app.post('/login', async (req: FastifyRequest<{ Body: AuthBody }>, reply: FastifyReply) => {
    const { email, password } = req.body ?? {};

    if (!verifyCsrf(req)) {
      const token = ensureCsrfToken(req);
      req.session.csrfToken = generateCsrfToken();
      await req.session.save();
      return reply.status(403).type('text/html').send(loginHtml(token, 'Invalid form submission. Please try again.'));
    }

    if (!email || !password) {
      const token = ensureCsrfToken(req);
      await req.session.save();
      return reply.status(400).type('text/html').send(loginHtml(token, 'Email and password required'));
    }

    const user = await verifyUser(email, password);
    if (!user) {
      const token = ensureCsrfToken(req);
      await req.session.save();
      return reply.status(401).type('text/html').send(loginHtml(token, 'Invalid email or password'));
    }

    req.session.userId = user.id;
    req.session.csrfToken = generateCsrfToken();
    await req.session.save();
    return reply.redirect('/dashboard');
  });

  app.post('/logout', async (req, reply) => {
    req.session.destroy();
    return reply.redirect('/');
  });
}
