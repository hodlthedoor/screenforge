import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createUser, verifyUser } from '../db/users.js';

interface AuthBody {
  email: string;
  password: string;
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function loginHtml(error?: string): string {
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
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" required>
    <button type="submit">Log In</button>
  </form>
  <div class="link">Don't have an account? <a href="/register">Sign up</a></div>
</div></body></html>`;
}

function registerHtml(error?: string): string {
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
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required>
    <label for="password">Password (min 8 characters)</label>
    <input type="password" id="password" name="password" minlength="8" required>
    <button type="submit">Create Account</button>
  </form>
  <div class="link">Already have an account? <a href="/login">Log in</a></div>
</div></body></html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/login', async (_req, reply) => {
    return reply.type('text/html').send(loginHtml());
  });

  app.get('/register', async (_req, reply) => {
    return reply.type('text/html').send(registerHtml());
  });

  app.post('/register', async (req: FastifyRequest<{ Body: AuthBody }>, reply: FastifyReply) => {
    const { email, password } = req.body ?? {};

    if (!email || !validateEmail(email)) {
      return reply.status(400).send({ error: 'Invalid email address', statusCode: 400 });
    }
    if (!password || password.length < 8) {
      return reply.status(400).send({ error: 'Password must be at least 8 characters', statusCode: 400 });
    }

    try {
      const user = await createUser(email, password);
      req.session.userId = user.id;
      await req.session.save();
      return reply.redirect('/dashboard');
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        return reply.status(409).send({ error: 'Email already registered', statusCode: 409 });
      }
      throw err;
    }
  });

  app.post('/login', async (req: FastifyRequest<{ Body: AuthBody }>, reply: FastifyReply) => {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password required', statusCode: 400 });
    }

    const user = await verifyUser(email, password);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid email or password', statusCode: 401 });
    }

    req.session.userId = user.id;
    await req.session.save();
    return reply.redirect('/dashboard');
  });

  app.post('/logout', async (req, reply) => {
    req.session.destroy();
    return reply.redirect('/');
  });
}
