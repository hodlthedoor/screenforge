import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  createUser,
  verifyUser,
  verifyUserPassword,
  updateUserPassword,
  setPasswordResetToken,
  getUserByResetToken,
  getUserByEmailToken,
  markEmailVerified,
  getUserByEmail,
} from '../db/users.js';
import { escapeHtml, generateCsrfToken } from '../utils/html.js';
import { createExpiringToken, isExpired, PASSWORD_RESET_TTL } from '../auth/tokens.js';
import { getPool } from '../db/index.js';

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

function verifyCsrf(req: FastifyRequest): boolean {
  const body = req.body as Record<string, string> | undefined;
  const token = body?._csrf;
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

  // Change password (authenticated route)
  app.post('/auth/change-password', async (req: FastifyRequest<{ Body: { currentPassword: string; newPassword: string; _csrf: string } }>, reply: FastifyReply) => {
    const userId = req.session.userId;
    if (!userId) {
      return reply.status(401).send('Not authenticated');
    }

    if (!verifyCsrf(req)) {
      return reply.status(403).send('Invalid CSRF token');
    }

    const { currentPassword, newPassword } = req.body ?? {};

    if (!currentPassword || !newPassword) {
      return reply.status(400).send('Current and new password required');
    }

    if (newPassword.length < 8) {
      return reply.status(400).send('New password must be at least 8 characters');
    }

    // Verify current password
    const valid = await verifyUserPassword(userId, currentPassword);
    if (!valid) {
      return reply.status(401).send('Current password incorrect');
    }

    // Update password
    await updateUserPassword(userId, newPassword);

    // Invalidate current session after password change.
    req.session.destroy();

    return reply.redirect('/login');
  });

  // Forgot password - request reset token
  app.get('/auth/forgot-password', async (req, reply) => {
    const token = ensureCsrfToken(req);
    await req.session.save();

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Forgot Password — ScreenForge</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0a0a0f;--surface:#12121a;--border:#1e1e2e;--text:#e0e0e8;--muted:#8888a0;--accent:#6c63ff}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:40px;width:100%;max-width:400px}
  h1{font-size:1.5rem;margin-bottom:24px;text-align:center}
  label{display:block;margin-bottom:4px;font-size:.9rem;color:var(--muted)}
  input{width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:1rem;margin-bottom:16px}
  input:focus{outline:none;border-color:var(--accent)}
  button{width:100%;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}
  button:hover{opacity:.9}
  .link{text-align:center;margin-top:16px;font-size:.9rem;color:var(--muted)}
  .link a{color:var(--accent);text-decoration:none}
</style></head><body>
<div class="card">
  <h1>Forgot Password</h1>
  <p style="color:var(--muted);margin-bottom:24px;text-align:center">Enter your email and we'll send you a reset link.</p>
  <form method="POST" action="/auth/forgot-password">
    <input type="hidden" name="_csrf" value="${token}">
    <label for="email">Email</label>
    <input type="email" id="email" name="email" required>
    <button type="submit">Send Reset Link</button>
  </form>
  <div class="link"><a href="/login">Back to login</a></div>
</div></body></html>`;

    return reply.type('text/html').send(html);
  });

  app.post('/auth/forgot-password', async (req: FastifyRequest<{ Body: { email: string; _csrf: string } }>, reply: FastifyReply) => {
    if (!verifyCsrf(req)) {
      return reply.status(403).send('Invalid CSRF token');
    }

    const { email } = req.body ?? {};
    if (!email) {
      return reply.status(400).send('Email required');
    }

    // Always return success to avoid user enumeration
    const user = await getUserByEmail(email);
    if (user) {
      const { token, expiresAt } = createExpiringToken(PASSWORD_RESET_TTL);
      await setPasswordResetToken(email, token, expiresAt);
      // Phase 3: send email here
    }

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Reset Link Sent — ScreenForge</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0a0a0f;--surface:#12121a;--border:#1e1e2e;--text:#e0e0e8;--muted:#8888a0;--accent:#6c63ff}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:40px;width:100%;max-width:400px}
  h1{font-size:1.5rem;margin-bottom:24px;text-align:center}
  .link{text-align:center;margin-top:16px;font-size:.9rem;color:var(--muted)}
  .link a{color:var(--accent);text-decoration:none}
</style></head><body>
<div class="card">
  <h1>Check Your Email</h1>
  <p style="color:var(--muted);text-align:center">If an account exists for ${escapeHtml(email)}, we've sent a password reset link to that email.</p>
  <div class="link"><a href="/login">Back to login</a></div>
</div></body></html>`;

    return reply.type('text/html').send(html);
  });

  // Reset password - validate token and show form
  app.get('/auth/reset-password/:token', async (req: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const { token } = req.params;
    const user = await getUserByResetToken(token);

    if (!user) {
      return reply.status(400).send('Invalid or expired reset token');
    }

    // Check expiry
    const result = await getPool().query('SELECT password_reset_expires FROM users WHERE id = $1', [user.id]);
    const expiresAt = result.rows[0]?.password_reset_expires;
    if (isExpired(expiresAt)) {
      return reply.status(400).send('Reset token has expired');
    }

    const csrfToken = ensureCsrfToken(req);
    await req.session.save();

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Reset Password — ScreenForge</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0a0a0f;--surface:#12121a;--border:#1e1e2e;--text:#e0e0e8;--muted:#8888a0;--accent:#6c63ff}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:40px;width:100%;max-width:400px}
  h1{font-size:1.5rem;margin-bottom:24px;text-align:center}
  label{display:block;margin-bottom:4px;font-size:.9rem;color:var(--muted)}
  input{width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:1rem;margin-bottom:16px}
  input:focus{outline:none;border-color:var(--accent)}
  button{width:100%;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}
  button:hover{opacity:.9}
</style></head><body>
<div class="card">
  <h1>Reset Password</h1>
  <form method="POST" action="/auth/reset-password/${escapeHtml(token)}">
    <input type="hidden" name="_csrf" value="${csrfToken}">
    <label for="newPassword">New Password (min 8 characters)</label>
    <input type="password" id="newPassword" name="newPassword" minlength="8" required>
    <button type="submit">Reset Password</button>
  </form>
</div></body></html>`;

    return reply.type('text/html').send(html);
  });

  // Reset password - submit new password
  app.post('/auth/reset-password/:token', async (req: FastifyRequest<{ Params: { token: string }; Body: { newPassword: string; _csrf: string } }>, reply: FastifyReply) => {
    const { token } = req.params;
    const { newPassword } = req.body ?? {};

    if (!verifyCsrf(req)) {
      return reply.status(403).send('Invalid CSRF token');
    }

    if (!newPassword || newPassword.length < 8) {
      return reply.status(400).send('Password must be at least 8 characters');
    }

    const user = await getUserByResetToken(token);
    if (!user) {
      return reply.status(400).send('Invalid or expired reset token');
    }

    // Check expiry
    const result = await getPool().query('SELECT password_reset_expires FROM users WHERE id = $1', [user.id]);
    const expiresAt = result.rows[0]?.password_reset_expires;
    if (isExpired(expiresAt)) {
      return reply.status(400).send('Reset token has expired');
    }

    // Update password and clear reset token
    await updateUserPassword(user.id, newPassword);

    // Destroy current session (if any)
    req.session.destroy();

    return reply.redirect('/login');
  });

  // Email verification
  app.post('/auth/verify-email/:token', async (req: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const { token } = req.params;
    const user = await getUserByEmailToken(token);

    if (!user) {
      return reply.status(400).send('Invalid or expired verification token');
    }

    // Check expiry
    const result = await getPool().query('SELECT email_token_expires FROM users WHERE id = $1', [user.id]);
    const expiresAt = result.rows[0]?.email_token_expires;
    if (isExpired(expiresAt)) {
      return reply.status(400).send('Verification token has expired');
    }

    // Mark email verified
    await markEmailVerified(user.id);

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Email Verified — ScreenForge</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0a0a0f;--surface:#12121a;--border:#1e1e2e;--text:#e0e0e8;--muted:#8888a0;--accent:#6c63ff}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:40px;width:100%;max-width:400px;text-align:center}
  h1{font-size:1.5rem;margin-bottom:24px}
  .link{margin-top:16px;font-size:.9rem;color:var(--muted)}
  .link a{color:var(--accent);text-decoration:none}
</style></head><body>
<div class="card">
  <h1>Email Verified!</h1>
  <p style="color:var(--muted)">Your email has been successfully verified.</p>
  <div class="link"><a href="/login">Go to login</a></div>
</div></body></html>`;

    return reply.type('text/html').send(html);
  });
}
