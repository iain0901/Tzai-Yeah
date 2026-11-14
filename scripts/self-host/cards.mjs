import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getRawDatabase, closeDatabase } from '../../lib/server/sqlite-runtime.mjs';
import { publicOrigin } from '../../lib/server/auth-core.mjs';
import { loadEnvironment } from './environment.mjs';

// A CSV parser supporting BOM, quoted commas/newlines and escaped quotes, including Excel exports.
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || cell === '') quoted = !quoted;
      else throw new Error('CSV 引號格式不正確。');
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(cell); cell = '';
      if (char === '\n') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else cell += char;
  }
  if (quoted) throw new Error('CSV 引號未關閉。');
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function importCards(filename) {
  const rows = parseCsv(readFileSync(filename, 'utf8'));
  const headers = rows.shift()?.map(value => value.trim()) || [];
  const find = names => headers.findIndex(header => names.includes(header));
  const serialIndex = find(['卡套流水號', '卡號', 'serial']);
  const tokenIndex = find(['token']);
  const urlIndex = find(['NFC網址', 'NFC 網址', 'url', 'nfcUrl']);
  const activeIndex = find(['啟用', 'active']);
  if (serialIndex < 0 || (tokenIndex < 0 && urlIndex < 0)) throw new Error('CSV 需要「卡套流水號、NFC網址」或「serial、token」欄位。');
  if (!rows.length || rows.length > 10000) throw new Error('CSV 請包含 1～10000 張卡片。');
  const serials = new Set(), tokens = new Set();
  const cards = rows.map((row, index) => {
    const value = row[serialIndex]?.trim();
    if (!/^\d{1,5}$/.test(value || '') || Number(value) < 1) throw new Error(`CSV 第 ${index + 2} 列卡號不正確。`);
    const serial = String(Number(value)).padStart(3, '0');
    let token = tokenIndex >= 0 ? row[tokenIndex]?.trim() : '';
    if (!token && urlIndex >= 0) {
      try {
        const url = new URL(row[urlIndex]?.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.search || url.hash) throw new Error();
        token = /^\/t\/([a-f0-9]{48})\/?$/.exec(url.pathname)?.[1];
      } catch { /* Validate below without exposing the private token. */ }
    }
    if (!/^[a-f0-9]{48}$/.test(token || '')) throw new Error(`CSV 第 ${index + 2} 列 NFC 連結格式不正確。`);
    if (serials.has(serial) || tokens.has(token)) throw new Error(`CSV 第 ${index + 2} 列重複卡號或連結。`);
    serials.add(serial); tokens.add(token);
    const enabled = activeIndex < 0 ? '1' : row[activeIndex]?.trim().toLowerCase();
    if (!['', '1', '0', 'true', 'false', '是', '否'].includes(enabled)) throw new Error(`CSV 第 ${index + 2} 列啟用值不正確。`);
    return { serial, token, active: ['0', 'false', '否'].includes(enabled) ? 0 : 1 };
  });
  const db = getRawDatabase(); let inserted = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const card of cards) {
      const existing = db.prepare('SELECT serial, token FROM cards WHERE serial = ? OR token = ?').all(card.serial, card.token);
      if (existing.length) {
        if (existing.length === 1 && existing[0].serial === card.serial && existing[0].token === card.token) continue;
        throw new Error(`卡號 ${card.serial} 與既有資料不同；為保留已發出的 NFC 連結，匯入已取消。請用空白資料庫匯入，或先確認備份與卡片對應。`);
      }
      db.prepare('INSERT INTO cards(id, serial, token, active, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), card.serial, card.token, card.active, new Date().toISOString());
      inserted++;
    }
    db.exec('COMMIT'); return { inserted, total: cards.length };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function seedCards(count) {
  if (!Number.isInteger(count) || count < 0 || count > 10000) throw new Error('INIT_CARD_COUNT 需為 0～10000 的整數。');
  const db = getRawDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT COUNT(*) AS n FROM cards').get().n) { db.exec('COMMIT'); return 0; }
    const insert = db.prepare('INSERT INTO cards(id, serial, token, active, created_at) VALUES (?, ?, ?, 1, ?)');
    for (let number = 1; number <= count; number++) insert.run(randomUUID(), String(number).padStart(3, '0'), randomBytes(24).toString('hex'), new Date().toISOString());
    db.exec('COMMIT'); return count;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function exportCards(filename) {
  const cards = getRawDatabase().prepare('SELECT serial, token, active FROM cards ORDER BY CAST(serial AS INTEGER)').all();
  const origin = publicOrigin();
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  const csv = [['卡套流水號', 'NFC網址', '啟用', '姓名', '家別'], ...cards.map(card => [card.serial, `${origin}/t/${card.token}`, card.active, '', ''])].map(row => row.map(quote).join(',')).join('\r\n');
  mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
  writeFileSync(filename, '\uFEFF' + csv + '\r\n', { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(filename, 0o600);
  return cards.length;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    loadEnvironment();
    const [action, filename] = process.argv.slice(2);
    if (action === 'import' && filename) console.log(`已匯入 ${importCards(filename).inserted} 張新卡；既有連結保留。`);
    else if (action === 'export') {
      const target = filename || path.join(process.env.SECRETS_DIR, 'nfc-cards.csv');
      console.log(`已匯出 ${exportCards(target)} 張 NFC 連結至 ${path.resolve(target)}`);
    } else throw new Error('用法：npm run cards:import -- cards.csv 或 npm run cards:export -- output.csv');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { closeDatabase(); }
}
