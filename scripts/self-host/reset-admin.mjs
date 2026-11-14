import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getRawDatabase, closeDatabase } from '../../lib/server/sqlite-runtime.mjs';
import { setUserPassword } from '../../lib/server/auth-core.mjs';
import { loadEnvironment } from './environment.mjs';

try {
  loadEnvironment();
  const email = process.argv[2] || process.env.ADMIN_EMAIL || 'admin@tzai.local';
  const user = getRawDatabase().prepare("SELECT id FROM auth_users WHERE email = ? AND role = 'admin' AND enabled = 1").get(email.trim().toLowerCase());
  if (!user) throw new Error('找不到此管理員帳號；可把電子郵件作為指令參數傳入。');
  const password = randomBytes(24).toString('base64url');
  const target = path.join(process.env.SECRETS_DIR, `admin-reset-${Date.now()}.txt`);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, `帳號：${email}\n新密碼：${password}\n既有登入將失效。請妥善保管此檔。\n`, { mode: 0o600, flag: 'wx' });
  await setUserPassword({ email, password });
  console.log(`管理員密碼已重設；新密碼存於 ${target}。`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { closeDatabase(); }
