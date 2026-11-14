import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { getRawDatabase } from './sqlite-runtime.mjs';
import { clientAddress } from './client-address.mjs';

const derive = promisify(scrypt);
const COOKIE = 'tzai_session';
const HASH_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const DUMMY_HASH = `scrypt-v1$${'00'.repeat(16)}$${'00'.repeat(32)}`;
export class AuthError extends Error {
  constructor(status, message, code = 'auth_error') { super(message); this.status = status; this.code = code; }
}
export function publicOrigin() {
  const raw = process.env.PUBLIC_ORIGIN || 'http://localhost:3000';
  let url;
  try { url = new URL(raw); } catch { throw new AuthError(503, 'PUBLIC_ORIGIN 設定不正確。', 'configuration_error'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new AuthError(503, 'PUBLIC_ORIGIN 請只填網站的完整來源網址。', 'configuration_error');
  return url.origin;
}
export function getSessionSecret() {
  let secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    const filename = process.env.SESSION_SECRET_FILE || path.resolve(process.env.SECRETS_DIR || 'secrets', 'session-secret');
    try { secret = readFileSync(filename, 'utf8').trim(); } catch { throw new AuthError(503, '登入密鑰尚未設定，請先執行 npm run setup。', 'configuration_error'); }
  }
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new AuthError(503, '登入密鑰格式不正確，請檢查伺服器設定。', 'configuration_error');
  return secret;
}
function secretDigest(token) { return createHmac('sha256', getSessionSecret()).update(token).digest('hex'); }
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new AuthError(400, '密碼請使用 12～128 個字元。', 'invalid_password');
}
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 32, HASH_OPTIONS);
  return `scrypt-v1$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || password.length > 128 || typeof hash !== 'string') return false;
  const parts = hash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt-v1' || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
  const candidate = await derive(password, parts[1], 32, HASH_OPTIONS);
  return timingSafeEqual(candidate, Buffer.from(parts[2], 'hex'));
}
function normalizeEmail(value) {
  if (typeof value !== 'string') throw new AuthError(400, '請填寫電子郵件。', 'invalid_email');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, '電子郵件格式不正確。', 'invalid_email');
  return email;
}
function normalizeName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60 || /[\u0000-\u001f\u007f]/.test(value)) throw new AuthError(400, '稱呼請填寫 1～60 個字。', 'invalid_name');
  return value.trim();
}
function publicUser(row) { return row ? { id: row.id, email: row.email, name: row.name, role: row.role } : null; }
export async function createLocalUser({ email, name, password, role = 'member' }) {
  const normalizedEmail = normalizeEmail(email), normalizedName = normalizeName(name);
  if (role !== 'admin' && role !== 'member') throw new AuthError(400, '帳號角色不正確。');
  const passwordHash = await hashPassword(password);
  const user = { id: randomUUID(), email: normalizedEmail, name: normalizedName, role };
  try { getRawDatabase().prepare('INSERT INTO auth_users(id,email,name,password_hash,role,enabled,created_at) VALUES (?,?,?,?,?,1,?)').run(user.id, user.email, user.name, passwordHash, role, new Date().toISOString()); }
  catch (error) { if (String(error).includes('UNIQUE constraint failed')) throw new AuthError(409, '這個電子郵件已建立帳號，請改用登入。', 'account_exists'); throw error; }
  return user;
}
export async function setUserPassword({ email, password }) {
  const db = getRawDatabase();
  const row = db.prepare('SELECT * FROM auth_users WHERE email=?').get(normalizeEmail(email));
  if (!row) throw new AuthError(404, '找不到這個帳號。', 'account_not_found');
  const hash = await hashPassword(password);
  db.exec('BEGIN IMMEDIATE');
  try { db.prepare('UPDATE auth_users SET password_hash=? WHERE id=?').run(hash, row.id); db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(row.id); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
  return publicUser(row);
}
function requestHeaders(requestOrHeaders) { return requestOrHeaders.headers || requestOrHeaders; }
function sessionToken(requestOrHeaders) {
  const raw = requestHeaders(requestOrHeaders).get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : null;
}
export function getSessionUser(requestOrHeaders) {
  const token = sessionToken(requestOrHeaders);
  if (!token) return null;
  const row = getRawDatabase().prepare('SELECT u.id,u.email,u.name,u.role FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1').get(secretDigest(token), Date.now());
  return publicUser(row);
}
function cookieValue(token, maxAge = SESSION_MS / 1000) {
  const secure = publicOrigin().startsWith('https://') ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function newSession(user) {
  const token = randomBytes(32).toString('hex');
  const db = getRawDatabase();
  const now = Date.now();
  db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(secretDigest(token), user.id, now + SESSION_MS, new Date(now).toISOString());
  db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(now);
  return cookieValue(token);
}
export function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const parsed = new URL(value, 'https://return.invalid');
    if (parsed.origin !== 'https://return.invalid' || parsed.pathname === '/login' || parsed.pathname.startsWith('/api/auth')) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return '/'; }
}
function rateLimit(scope, identity, maximum, windowMs) {
  const db = getRawDatabase(), now = Date.now();
  const key = `${scope}:${createHash('sha256').update(identity).digest('hex')}:${Math.floor(now / windowMs)}`;
  const row = db.prepare('INSERT INTO auth_limits(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').get(key, now + windowMs * 2);
  db.prepare('DELETE FROM auth_limits WHERE expires_at<=?').run(now);
  if (row.count > maximum) throw new AuthError(429, '嘗試次數較多，請稍候再試。', 'rate_limited');
}
export function assertAuthOrigin(request) {
  if (request.headers.get('origin') !== publicOrigin() || request.headers.get('sec-fetch-site') === 'cross-site') throw new AuthError(403, '請從本站重新開啟頁面後操作。', 'invalid_origin');
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw new AuthError(415, '請使用 JSON 格式送出。', 'invalid_content_type');
}
async function bodyFor(request) {
  if (Number(request.headers.get('content-length') || 0) > 16384) throw new AuthError(413, '送出的資料太長。');
  const text = await request.text();
  if (text.length > 16384) throw new AuthError(413, '送出的資料太長。');
  try { const body = JSON.parse(text); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw new AuthError(400, '送出的資料格式不正確。'); }
}
function reply(body, status = 200, cookie) {
  const headers = { 'Cache-Control': 'no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return Response.json(body, { status, headers });
}
export async function handleAuth(request) {
  try {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, '');
    if (request.method === 'GET' && pathname === '/api/auth/session') return reply({ user: getSessionUser(request), registrationOpen: process.env.ALLOW_REGISTRATION !== 'false' });
    if (request.method !== 'POST') return reply({ error: '找不到這個功能。', code: 'not_found' }, 404);
    assertAuthOrigin(request);
    const body = await bodyFor(request);
    if (pathname === '/api/auth/login' || pathname === '/api/auth/register') {
      const email = normalizeEmail(body.email);
      const registration = pathname.endsWith('/register');
      rateLimit('entry-network', clientAddress(request), 600, 15 * 60 * 1000);
      rateLimit(registration ? 'register-email' : 'login-email', email, registration ? 6 : 20, 15 * 60 * 1000);
      if (registration) {
        if (process.env.ALLOW_REGISTRATION === 'false') throw new AuthError(403, '目前暫停建立新帳號，請洽工作人員。', 'registration_disabled');
        getSessionSecret();
        const user = await createLocalUser({ email, name: body.name, password: body.password, role: 'member' });
        return reply({ user, returnTo: safeReturnPath(body.returnTo) }, 200, newSession(user));
      }
      const row = getRawDatabase().prepare('SELECT * FROM auth_users WHERE email=?').get(email);
      const verified = await verifyPassword(body.password, row?.password_hash || DUMMY_HASH);
      if (!row || !row.enabled || !verified) throw new AuthError(401, '電子郵件或密碼不正確。', 'invalid_credentials');
      const user = publicUser(row);
      return reply({ user, returnTo: safeReturnPath(body.returnTo) }, 200, newSession(user));
    }
    if (pathname === '/api/auth/logout') {
      const token = sessionToken(request);
      if (token) getRawDatabase().prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(secretDigest(token));
      return reply({ ok: true }, 200, cookieValue('', 0));
    }
    if (pathname === '/api/auth/password') {
      const user = getSessionUser(request);
      if (!user) throw new AuthError(401, '請先登入。', 'signin_required');
      rateLimit('password', user.id, 10, 15 * 60 * 1000);
      const row = getRawDatabase().prepare('SELECT password_hash FROM auth_users WHERE id=?').get(user.id);
      if (!await verifyPassword(body.currentPassword, row.password_hash)) throw new AuthError(401, '目前的密碼不正確。', 'invalid_credentials');
      await setUserPassword({ email: user.email, password: body.password });
      return reply({ ok: true, user, message: '密碼已更新，其他裝置的登入已結束。' }, 200, newSession(user));
    }
    return reply({ error: '找不到這個功能。', code: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof AuthError) return reply({ error: error.message, code: error.code }, error.status);
    console.error('Local authentication error', error instanceof Error ? error.name : 'unknown');
    return reply({ error: '登入服務暫時無法使用，請稍後重試。', code: 'server_error' }, 500);
  }
}
