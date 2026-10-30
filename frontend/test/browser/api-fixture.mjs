// Browser contract fixture: no database, external network or real email.
import { createServer } from 'node:http';
const sessions = new Map();
const session = required => ({
  sub: '11111111-1111-4111-8111-111111111111',
  username: 'manager',
  role: 'MANAGER',
  expiresAt: Math.floor(Date.now() / 1000) + 28800,
  passwordChangeRequired: required
});
createServer(async (req, res) => {
  let status = 200,
    data = {};
  try {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const token = req.headers.authorization?.slice(7);
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/health/ready') data = { status: 'ok' };
    else if (path === '/auth/login') {
      if (!['manager', 'first-login'].includes(body.username) || body.password !== 'browser-private-password') {
        status = 401;
      } else {
        const accessToken = crypto.randomUUID();
        data = { ...session(body.username === 'first-login'), accessToken };
        sessions.set(accessToken, data);
      }
    } else if (path === '/auth/session') {
      data = sessions.get(token);
      if (!data) status = 401;
    } else if (path === '/auth/logout') {
      sessions.delete(token);
      data = { status: 'signed_out' };
    } else if (path === '/auth/change-password') {
      if (!sessions.has(token) || body.currentPassword !== 'browser-private-password') {
        status = 401;
      } else {
        const accessToken = crypto.randomUUID();
        sessions.delete(token);
        data = { ...session(false), accessToken };
        sessions.set(accessToken, data);
      }
    } else if (path === '/auth/request-password-reset') data = { status: 'code_requested' };
    else if (path === '/auth/reset-password') {
      if (body.code !== '123456') status = 400;
      else data = { status: 'password_reset' };
    } else {
      status = 503;
      data = { code: 'SERVICE_UNAVAILABLE' };
    }
  } catch {
    status = 400;
  }
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data ?? {}));
}).listen(17800, '127.0.0.1');
