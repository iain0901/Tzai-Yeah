import { database } from "./database";
import { clientAddress } from "./client-address.mjs";
import type { TreeLeaderboard, TreePlayer, TreeResponse } from "../tree-contracts";
import { treeLevel } from "../tree-contracts";
import { ApiFault, randomToken, sha256 } from "./validation";

const CAPACITY = 9;
const CREDIT_PER_MS = 3 / 1000;
const CAS_ATTEMPTS = 24;
type Row = Record<string, unknown>;
type Identity = { key: string; cardSerial: string };
type StoredTree = {
  id: string; name: string; growth: number; revision: number; createdAt: string; updatedAt: string;
  credit: number; creditAt: number; requests: Array<{ id: string; awarded: number }>;
};
type RankedRow = { value: string; card_serial: string; rank: number };
// Existing guest records remain stored, but only active cards participate in this event.
const RANKED = "WITH ranked AS (SELECT s.id AS storage_key,s.value,c.serial AS card_serial,ROW_NUMBER() OVER (ORDER BY CAST(json_extract(s.value,'$.growth') AS INTEGER) DESC,json_extract(s.value,'$.createdAt') ASC,json_extract(s.value,'$.id') ASC) AS rank FROM settings s JOIN cards c ON s.id='tree_player:card:' || c.id WHERE c.active=1)";

function reply(value: TreeResponse | TreeLeaderboard) {
  const headers: Record<string, string> = { "Cache-Control": "no-store, max-age=0", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  return Response.json(value, { headers });
}
async function identityFor(token: unknown): Promise<Identity | null> {
  if (token != null && token !== "") {
    if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) throw new ApiFault(404, "找不到這張小卡，請重新感應。", "card_not_found");
    const card = await database().prepare("SELECT id,serial,active FROM cards WHERE token=?").bind(token).first<{ id: string; serial: string; active: number }>();
    if (!card) throw new ApiFault(404, "找不到這張小卡，請重新感應。", "card_not_found");
    if (!card.active) throw new ApiFault(410, "這張小卡已停用，請洽工作人員協助。", "card_inactive");
    return { key: `tree_player:card:${card.id}`, cardSerial: card.serial };
  }
  return null;
}
function nickname(value: unknown): string {
  if (typeof value !== "string") throw new ApiFault(400, "幫耶誕樹取個 2～16 字的暱稱吧。", "invalid_name");
  const name = value.trim();
  const length = Array.from(name).length;
  if (length < 2 || length > 16 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name) || !/[^\p{White_Space}\p{Cf}]/u.test(name)) {
    throw new ApiFault(400, "暱稱請填寫 2～16 字，使用一般文字或表情符號。", "invalid_name");
  }
  for (const character of name) {
    const code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) throw new ApiFault(400, "暱稱含有無法使用的字元。", "invalid_name");
  }
  return name;
}
function publicPlayer(stored: StoredTree, rank: number, cardSerial: string): TreePlayer {
  return { id: stored.id, cardSerial, name: stored.name || `#${cardSerial}`, growth: stored.growth, heightCm: 30 + 2 * stored.growth, level: treeLevel(stored.growth), rank, revision: stored.revision, createdAt: stored.createdAt, updatedAt: stored.updatedAt };
}
async function rankedPlayer(identity: Identity | null): Promise<TreePlayer | null> {
  if (!identity) return null;
  const row = await database().prepare(`${RANKED} SELECT value,card_serial,rank FROM ranked WHERE storage_key=?`).bind(identity.key).first<RankedRow>();
  return row ? publicPlayer(JSON.parse(row.value), row.rank, row.card_serial) : null;
}
async function limit(scope: string, identity: string, count: number, windowMs: number) {
  const now = Date.now();
  const key = `tree_rate:${scope}:${await sha256(identity)}:${Math.floor(now / windowMs)}`;
  const row = await database().prepare("INSERT INTO settings(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=json_set(settings.value,'$.count',json_extract(settings.value,'$.count')+1) RETURNING value").bind(key, JSON.stringify({ count: 1, expiresAt: now + windowMs * 2 })).first<{ value: string }>();
  if (!row || JSON.parse(row.value).count > count) throw new ApiFault(429, "搖累了就休息一下，稍後再繼續吧。", "tree_rate_limited");
}
async function readStored(identity: Identity) {
  const row = await database().prepare("SELECT value FROM settings WHERE id=?").bind(identity.key).first<{ value: string }>();
  return row ? { raw: row.value, tree: JSON.parse(row.value) as StoredTree } : null;
}
async function compareAndSwap(identity: Identity, previous: string, tree: StoredTree) {
  const result = await database().prepare("UPDATE settings SET value=? WHERE id=? AND value=? AND EXISTS (SELECT 1 FROM cards WHERE active=1 AND 'tree_player:card:' || cards.id=?)").bind(JSON.stringify(tree), identity.key, previous, identity.key).run();
  return !!result.meta.changes;
}
async function ensureTree(request: Request, identity: Identity, name: string) {
  if (await readStored(identity)) return;
  await limit("register-ip", clientAddress(request), 600, 3600000);
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  const tree: StoredTree = { id: randomToken(16), name, growth: 0, revision: 1, createdAt: timestamp, updatedAt: timestamp, credit: CAPACITY, creditAt: now, requests: [] };
  // Concurrent first visits must keep whichever record won, including its public
  // player ID. Existing queued growth and request replay history depend on it.
  await database().prepare("INSERT OR IGNORE INTO settings(id,value) VALUES (?,?)").bind(identity.key, JSON.stringify(tree)).run();
  // Only expired solo-game rate counters are removed. Tree progress has no expiry.
  try { await database().prepare("DELETE FROM settings WHERE id IN (SELECT id FROM settings WHERE id GLOB 'tree_rate:*' AND json_extract(value,'$.expiresAt')<? LIMIT 100)").bind(now).run(); } catch { console.warn("Tree rate housekeeping deferred"); }
}

export async function getTree(request: Request, url: URL): Promise<Response> {
  const identity = await identityFor(url.searchParams.get("token"));
  if (identity) await ensureTree(request, identity, `#${identity.cardSerial}`);
  return reply({ player: await rankedPlayer(identity), serverNow: Date.now() });
}
export async function getTreeLeaderboard(request: Request, url: URL): Promise<Response> {
  const pageValue = url.searchParams.get("page") || "1";
  if (!/^\d{1,6}$/.test(pageValue) || Number(pageValue) < 1) throw new ApiFault(400, "排行榜頁碼不正確。", "invalid_page");
  const page = Number(pageValue);
  const identity = await identityFor(url.searchParams.get("token"));
  // The three reads share one SQLite transaction, so entries, total and myRank use the same snapshot.
  const results = await database().batch([
    database().prepare(`${RANKED} SELECT value,card_serial,rank FROM ranked ORDER BY rank LIMIT 5 OFFSET ?`).bind((page - 1) * 5),
    database().prepare(`${RANKED} SELECT value,card_serial,rank FROM ranked WHERE storage_key=?`).bind(identity?.key || ""),
    database().prepare(`${RANKED} SELECT COUNT(*) AS total FROM ranked`),
  ]);
  const rows = results[0].results as unknown as RankedRow[];
  const own = (results[1].results as unknown as RankedRow[])[0];
  const total = Number((results[2].results as unknown as Array<{ total: number }>)[0]?.total || 0);
  const player = own ? publicPlayer(JSON.parse(own.value), own.rank, own.card_serial) : null;
  return reply({ entries: rows.map(row => publicPlayer(JSON.parse(row.value), row.rank, row.card_serial)), page, pageSize: 5, total, myRank: player?.rank || null, player, serverNow: Date.now() });
}
export async function postTree(request: Request, body: Row): Promise<Response> {
  if (JSON.stringify(body).length > 2048) throw new ApiFault(413, "送出的資料太長，請重新操作。", "invalid_request");
  const action = body.action;
  if (action !== "register" && action !== "rename" && action !== "grow") throw new ApiFault(400, "找不到這個耶誕樹操作。", "invalid_tree_action");
  const identity = await identityFor(body.token);
  if (!identity) throw new ApiFault(403, "請從你的小卡專屬連結開啟遊戲。", "card_required");
  const name = action === "rename" || action === "register" && body.name != null ? nickname(body.name) : `#${identity.cardSerial}`;
  if (action === "grow" && (!Number.isInteger(body.count) || Number(body.count) < 1 || Number(body.count) > 12)) throw new ApiFault(400, "每次請送出 1～12 次搖動。", "invalid_count");
  if (action === "grow" && (typeof body.requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(body.requestId))) throw new ApiFault(400, "這次搖動的識別碼不正確，請再試一次。", "invalid_request_id");
  if (action === "register") {
    await ensureTree(request, identity, name);
    return reply({ player: await rankedPlayer(identity), serverNow: Date.now() });
  }
  await limit(action, identity.key, action === "rename" ? 20 : 360, 60000);
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const stored = await readStored(identity);
    if (!stored) throw new ApiFault(409, "請重新開啟你的小卡，找回專屬的小樹。", "tree_not_registered");
    const { tree, raw } = stored;
    let awarded: number | undefined;
    if (action === "rename") {
      if (tree.name === name) return reply({ player: await rankedPlayer(identity), serverNow: Date.now() });
      tree.name = name;
    } else {
      const replay = tree.requests.find(item => item.id === body.requestId);
      if (replay) return reply({ player: await rankedPlayer(identity), serverNow: Date.now(), awarded: replay.awarded });
      const now = Date.now();
      const available = Math.min(CAPACITY, tree.credit + Math.max(0, now - tree.creditAt) * CREDIT_PER_MS);
      awarded = Math.min(Number(body.count), Math.floor(available + 1e-9));
      tree.credit = available - awarded;
      tree.creditAt = now;
      tree.growth += awarded;
      tree.requests = [...tree.requests, { id: String(body.requestId), awarded }].slice(-32);
    }
    tree.revision++;
    tree.updatedAt = new Date().toISOString();
    if (!await compareAndSwap(identity, raw, tree)) {
      // A disabled/deleted card must fail immediately, rather than retrying a
      // write against an identity that is no longer allowed to play.
      await identityFor(body.token);
      continue;
    }
    return reply({ player: await rankedPlayer(identity), serverNow: Date.now(), ...(awarded === undefined ? {} : { awarded }) });
  }
  throw new ApiFault(409, "耶誕樹正在更新，請用同一次搖動再試一次。", "tree_conflict");
}
