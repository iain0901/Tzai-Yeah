import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getRawDatabase, closeDatabase } from '../../lib/server/sqlite-runtime.mjs';
import { createLocalUser, getSessionSecret, publicOrigin } from '../../lib/server/auth-core.mjs';
import { importCards, seedCards } from './cards.mjs';
import { loadEnvironment } from './environment.mjs';

function privateDirectory(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(dir, 0o700);
}
export async function setup() {
  loadEnvironment();
  const origin = publicOrigin();
  const count = Number(process.env.INIT_CARD_COUNT ?? 150);
  if (!Number.isInteger(count) || count < 0 || count > 10000) throw new Error('INIT_CARD_COUNT 需為 0～10000 的整數。');
  privateDirectory(process.env.SECRETS_DIR);
  privateDirectory(path.dirname(process.env.DATABASE_PATH));
  const secretFile = process.env.SESSION_SECRET_FILE;
  if (!process.env.SESSION_SECRET && !existsSync(secretFile)) {
    privateDirectory(path.dirname(secretFile));
    try { writeFileSync(secretFile, randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  getSessionSecret(); // Fail early for absent/malformed user-provided secrets.
  const db = getRawDatabase();
  if (process.env.NFC_IMPORT_FILE) {
    const result = importCards(process.env.NFC_IMPORT_FILE);
    console.log(`NFC 匯入：新增 ${result.inserted} 張，既有卡片連結未變更。`);
  }
  const seeded = seedCards(count);
  if (seeded) console.log(`已建立 ${seeded} 張專屬 NFC 卡片。`);
  let createdAdmin = false;
  if (!db.prepare("SELECT id FROM auth_users WHERE role = 'admin' AND enabled = 1 LIMIT 1").get()) {
    const email = process.env.ADMIN_EMAIL || 'admin@tzai.local';
    const password = process.env.ADMIN_PASSWORD || randomBytes(24).toString('base64url');
    const credentialFile = path.join(process.env.SECRETS_DIR, 'admin-login.txt');
    // Never replace the first-login record silently.
    const target = existsSync(credentialFile) ? path.join(process.env.SECRETS_DIR, `admin-login-${Date.now()}.txt`) : credentialFile;
    writeFileSync(target, `載耶小屋・管理員首次登入\n\n管理入口：${origin}/admin\n帳號：${email}\n密碼：${password}\n\n登入後可在 /login 變更密碼。此檔為首次建立時的紀錄，變更密碼後不會同步更新。\n請將此檔存放於安全處，勿提交 GitHub 或提供給持卡者。\n`, { mode: 0o600, flag: 'wx' });
    try { await createLocalUser({ email, name: process.env.ADMIN_NAME || '載耶管理員', password, role: 'admin' }); }
    catch (error) { unlinkSync(target); throw error; }
    createdAdmin = true;
    console.log(`已建立管理員；首次登入資料存於 ${target}（不會輸出密碼）。`);
  }
  console.log(`本機資料庫已就緒；公開網址：${origin}`);
  return { createdAdmin, seeded };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length > 2) throw new Error('setup 不接受參數；匯入既有卡片請先執行 npm run cards:import -- cards.csv，或設定 NFC_IMPORT_FILE。');
    await setup();
  }
  catch (error) { console.error(`初始化失敗：${error.message}`); process.exitCode = 1; }
  finally { closeDatabase(); }
}
