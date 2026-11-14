import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { getRawDatabase, closeDatabase } from '../../lib/server/sqlite-runtime.mjs';
import { setUserPassword } from '../../lib/server/auth-core.mjs';
import { loadEnvironment } from './environment.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('-') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args[0].trim())) throw new Error('請指定一般會員電子郵件：npm run account:reset -- member@example.com');
  const email = args[0].trim().toLowerCase();
  loadEnvironment();
  const user = getRawDatabase().prepare("SELECT id FROM auth_users WHERE email=? AND role='member' AND enabled=1").get(email);
  if (!user) throw new Error('找不到已啟用的一般會員帳號。管理員請使用 npm run admin:reset。');
  const password = randomBytes(24).toString('base64url');
  const target = path.join(process.env.SECRETS_DIR, `account-reset-${Date.now()}.txt`);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(path.dirname(target), 0o700);
  writeFileSync(target, `帳號：${email}\n新密碼：${password}\n\n此帳號的既有登入已失效。請私下交給本人，並請本人登入 /login 修改密碼。\n小卡認領及個人資料保持不變。此檔含密碼，請私人保管。\n`, { mode: 0o600, flag: 'wx' });
  try { await setUserPassword({ email, password }); }
  catch (error) { unlinkSync(target); throw error; }
  console.log(`會員密碼已重設；新密碼存於 ${target}，請私下交給本人。`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { closeDatabase(); }
