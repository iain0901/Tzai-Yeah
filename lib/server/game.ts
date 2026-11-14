import { database } from "./database";
import { clientAddress } from "./client-address.mjs";
import { GAME_MEMBER_COLORS, GAME_MAX_MEMBERS, GAME_ROUND_SECONDS, GAME_TOTAL_BULBS } from "../game-contracts";
import type { GameMemory, GameRoomSnapshot, GameStatus } from "../game-contracts";
import { ApiFault, randomToken, sha256, textValue } from "./validation";

const COOKIE = "tzai_game_session";
const ROOM_TTL = 12 * 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_CAS_ATTEMPTS = 12;
type Row = Record<string, unknown>;
type CardIdentity = { id: string; serial: string };
type Session = { hash: string; cookie: string | null };
type StoredMember = { id: string; label: string; color: string; sessionHash: string; cardId: string | null; cardSerial: string | null };
type StoredRoom = {
  code: string; status: GameStatus; revision: number; round: number; hostId: string;
  members: StoredMember[]; lit: number[]; startedAt: number | null; endsAt: number | null;
  expiresAt: number; completedAt: string | null; guestCounter: number;
};

function response(room: GameRoomSnapshot, session?: Session) {
  const headers: Record<string, string> = { "Cache-Control": "no-store, max-age=0", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  if (session?.cookie) headers["Set-Cookie"] = session.cookie;
  return Response.json({ room }, { headers });
}
function roomCode(value: unknown) {
  const code = textValue(value, "房間代碼", 6, true).toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new ApiFault(400, "請輸入 6 碼英文字母或數字的房間代碼。", "invalid_room_code");
  return code;
}
function generateCode() {
  // Rejection sampling keeps every nonambiguous character equally likely.
  let code = "";
  while (code.length < 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    for (const value of bytes) {
      if (value < 256 - (256 % CODE_ALPHABET.length)) code += CODE_ALPHABET[value % CODE_ALPHABET.length];
      if (code.length === 6) break;
    }
  }
  return code;
}
async function sessionFor(request: Request, create = false): Promise<Session> {
  const raw = request.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const secure = new URL(process.env.PUBLIC_ORIGIN || request.url).protocol === "https:" ? "; Secure" : "";
  const cookieFor = (secret: string) => `${COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ROOM_TTL / 1000}${secure}`;
  if (raw && /^[a-f0-9]{64}$/.test(raw)) return { hash: await sha256(raw), cookie: create ? cookieFor(raw) : null };
  if (!create) throw new ApiFault(403, "請先輸入房間代碼，加入朋友的房間。", "join_required");
  const secret = randomToken(32);
  return { hash: await sha256(secret), cookie: cookieFor(secret) };
}
async function cardFor(token: unknown): Promise<CardIdentity | null> {
  if (token == null || token === "") return null;
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) throw new ApiFault(404, "找不到這張小卡，請重新感應。", "card_not_found");
  const card = await database().prepare("SELECT id,serial,active FROM cards WHERE token=?").bind(token).first<{ id: string; serial: string; active: number }>();
  if (!card) throw new ApiFault(404, "找不到這張小卡，請重新感應。", "card_not_found");
  if (!card.active) throw new ApiFault(410, "這張小卡已停用；可以從活動首頁以訪客身分遊玩。", "card_inactive");
  return { id: card.id, serial: card.serial };
}
async function limit(scope: string, identity: string, maximum: number, windowMs: number) {
  const now = Date.now();
  const key = `game_rate:${scope}:${await sha256(identity)}:${Math.floor(now / windowMs)}`;
  const value = JSON.stringify({ count: 1, expiresAt: now + windowMs * 2 });
  const row = await database().prepare("INSERT INTO settings(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=json_set(settings.value,'$.count',json_extract(settings.value,'$.count')+1) RETURNING value").bind(key, value).first<{ value: string }>();
  if (!row || JSON.parse(row.value).count > maximum) throw new ApiFault(429, "操作有點快，請稍等一下再試。", "rate_limited");
}
function peer(request: Request) { return clientAddress(request); }
async function readRoom(code: string) {
  const row = await database().prepare("SELECT value FROM settings WHERE id=?").bind(`game_room:${code}`).first<{ value: string }>();
  if (!row) throw new ApiFault(404, "找不到這個房間，請確認朋友給你的代碼。", "room_not_found");
  const room = JSON.parse(row.value) as StoredRoom;
  if (room.expiresAt <= Date.now()) throw new ApiFault(410, "這個房間已結束，和朋友再開一間吧。", "room_expired");
  return { room, raw: row.value };
}
function snapshot(room: StoredRoom, sessionHash: string): GameRoomSnapshot {
  const me = room.members.find(member => member.sessionHash === sessionHash);
  return {
    code: room.code, status: room.status, revision: room.revision, round: room.round,
    hostId: room.hostId, meId: me?.id || null, meCardSerial: me?.cardSerial || null,
    members: room.members.map(({ id, label, color }) => ({ id, label, color })),
    lit: [...room.lit], startedAt: room.startedAt, endsAt: room.endsAt,
    total: GAME_TOTAL_BULBS, serverNow: Date.now(), expiresAt: room.expiresAt,
  };
}
function requireMember(room: StoredRoom, sessionHash: string) {
  const member = room.members.find(m => m.sessionHash === sessionHash);
  if (!member) throw new ApiFault(403, "你還沒加入這個房間，請先輸入房間代碼。", "join_required");
  return member;
}
function addMember(room: StoredRoom, session: Session, card: CardIdentity | null) {
  room.guestCounter++;
  const usedColors = new Set(room.members.map(m => m.color));
  const color = GAME_MEMBER_COLORS.find(c => !usedColors.has(c)) || GAME_MEMBER_COLORS[room.members.length % GAME_MEMBER_COLORS.length];
  const member: StoredMember = {
    id: randomToken(10), label: card ? `卡片 #${card.serial}` : `星光朋友${room.guestCounter}`,
    color, sessionHash: session.hash, cardId: card?.id || null, cardSerial: card?.serial || null,
  };
  room.members.push(member);
  return member;
}
async function compareAndSwap(previousRaw: string, room: StoredRoom): Promise<boolean> {
  const nextRaw = JSON.stringify(room);
  const roomKey = `game_room:${room.code}`;
  const statements = [database().prepare("UPDATE settings SET value=? WHERE id=? AND value=?").bind(nextRaw, roomKey, previousRaw)];
  if (room.status === "won") {
    const cardIds = [...new Set(room.members.map(m => m.cardId).filter((id): id is string => !!id))];
    const wins = cardIds.map(cardId => ({ key: `game_win:${cardId}:${room.code}:${room.round}`, cardId, value: { roomCode: room.code, round: room.round, completedAt: room.completedAt } }));
    // Both statements run in a single SQLite transaction. The exact state match guards a failed CAS,
    // and each card/room/round key makes repeated final-bulb requests idempotent.
    statements.push(database().prepare("INSERT OR IGNORE INTO settings(id,value) SELECT json_extract(j.value,'$.key'),json_extract(j.value,'$.value') FROM json_each(?) j WHERE (SELECT value FROM settings WHERE id=?)=? AND EXISTS(SELECT 1 FROM cards WHERE id=json_extract(j.value,'$.cardId') AND active=1)").bind(JSON.stringify(wins), roomKey, nextRaw));
  }
  const result = await database().batch(statements);
  return !!result[0].meta.changes;
}
type Mutation = (room: StoredRoom) => boolean;
async function updateRoom(code: string, session: Session, mutate: Mutation, joining = false) {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { room, raw } = await readRoom(code);
    if (!joining) requireMember(room, session.hash);
    // Time is authoritative on the server, including a sleeping tab's first poll.
    const expiredRound = room.status === "playing" && room.endsAt !== null && Date.now() >= room.endsAt;
    if (expiredRound) {
      room.status = "lost";
      room.revision++;
      if (await compareAndSwap(raw, room)) return room;
      continue;
    }
    const changed = mutate(room);
    if (!changed) return room;
    room.revision++;
    if (await compareAndSwap(raw, room)) return room;
  }
  throw new ApiFault(409, "朋友們正在一起點燈，請再試一次。", "room_conflict");
}

export async function getGame(request: Request, url: URL): Promise<Response> {
  const code = roomCode(url.searchParams.get("room"));
  const session = await sessionFor(request);
  await limit("poll", session.hash, 180, 60000);
  const room = await updateRoom(code, session, () => false);
  return response(snapshot(room, session.hash));
}
export async function gameMemory(_request: Request, url: URL): Promise<Response> {
  const card = await cardFor(url.searchParams.get("token"));
  if (!card) throw new ApiFault(400, "請從自己的小卡查看遊戲回憶。", "card_required");
  const row = await database().prepare("SELECT COUNT(*) AS wins,MAX(json_extract(value,'$.completedAt')) AS lastCompletedAt FROM settings WHERE id GLOB ?").bind(`game_win:${card.id}:*`).first<GameMemory>();
  return Response.json(row || { wins: 0, lastCompletedAt: null }, { headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
export async function postGame(request: Request, body: Row): Promise<Response> {
  const action = textValue(body.action, "遊戲操作", 20, true);
  if (!["create", "join", "start", "light", "leave", "restart"].includes(action)) throw new ApiFault(400, "找不到這個遊戲操作。", "invalid_game_action");
  if (JSON.stringify(body).length > 2048) throw new ApiFault(413, "遊戲資料格式太長。", "invalid_request");
  const session = await sessionFor(request, action === "create" || action === "join");
  await limit("action", session.hash, 160, 60000);
  if (action === "create") {
    await limit("create-ip", peer(request), 180, 3600000);
    await limit("create-session", session.hash, 6, 3600000);
    const card = await cardFor(body.token);
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateCode();
      const room: StoredRoom = { code, status: "lobby", revision: 1, round: 1, hostId: "", members: [], lit: [], startedAt: null, endsAt: null, expiresAt: Date.now() + ROOM_TTL, completedAt: null, guestCounter: 0 };
      room.hostId = addMember(room, session, card).id;
      const result = await database().prepare("INSERT OR IGNORE INTO settings(id,value) VALUES (?,?)").bind(`game_room:${code}`, JSON.stringify(room)).run();
      if (!result.meta.changes) continue;
      // Bound housekeeping to game-owned rows. Keep tiny expired-room tombstones so a code
      // cannot be reused and collide with a prior card/room/round win record.
      try {
        await database().batch([
          database().prepare("DELETE FROM settings WHERE id IN (SELECT id FROM settings WHERE id GLOB 'game_rate:*' AND json_extract(value,'$.expiresAt')<? LIMIT 200)").bind(Date.now()),
          database().prepare("UPDATE settings SET value=json_object('code',json_extract(value,'$.code'),'expiresAt',json_extract(value,'$.expiresAt'),'expired',1) WHERE id IN (SELECT id FROM settings WHERE id GLOB 'game_room:*' AND json_extract(value,'$.expiresAt')<? AND json_extract(value,'$.expired') IS NULL LIMIT 100)").bind(Date.now()),
        ]);
      } catch { console.warn("Game housekeeping deferred"); }
      return response(snapshot(room, session.hash), session);
    }
    throw new ApiFault(503, "房間正在準備中，請稍後再試。", "room_unavailable");
  }
  const code = roomCode(body.code);
  if (action === "join") {
    await limit("join-ip", peer(request), 300, 60000);
    await limit("join-session", session.hash, 30, 60000);
    const card = await cardFor(body.token);
    const room = await updateRoom(code, session, current => {
      const existing = current.members.find(m => m.sessionHash === session.hash);
      if (existing) {
        if (card && existing.cardId && card.id !== existing.cardId) throw new ApiFault(409, "這次遊戲已連結另一張小卡，請使用原本的小卡。", "card_conflict");
        if (card && !existing.cardId && current.status === "lobby") {
          existing.cardId = card.id; existing.cardSerial = card.serial; existing.label = `卡片 #${card.serial}`;
          return true;
        }
        return false;
      }
      if (current.status !== "lobby") throw new ApiFault(409, "這一局已經開始，請等朋友回到準備畫面再加入。", "round_started");
      if (current.members.length >= GAME_MAX_MEMBERS) throw new ApiFault(409, "房間已經有 6 位朋友，再開一間一起玩吧。", "room_full");
      addMember(current, session, card);
      return true;
    }, true);
    if (!room.members.some(m => m.sessionHash === session.hash)) throw new ApiFault(409, "這一局剛結束，請等房主重新準備再加入。", "round_finished");
    return response(snapshot(room, session.hash), session);
  }
  const mutate: Mutation = current => {
    const me = requireMember(current, session.hash);
    if (action === "leave") {
      if (current.status === "playing") throw new ApiFault(409, "這一局還在進行，完成後就能離開房間。", "round_started");
      current.members = current.members.filter(m => m.id !== me.id);
      if (current.hostId === me.id) current.hostId = current.members[0]?.id || "";
      if (!current.members.length) current.expiresAt = Date.now();
      return true;
    }
    if (action === "start" || action === "restart") {
      if (current.hostId !== me.id) throw new ApiFault(403, "請讓房主開始下一步。", "host_required");
      if (action === "restart") {
        if (current.status !== "won" && current.status !== "lost") throw new ApiFault(409, "這一局還沒結束，先一起完成它吧。", "round_unfinished");
        current.status = "lobby"; current.round++; current.lit = []; current.startedAt = null; current.endsAt = null; current.completedAt = null;
        return true;
      }
      if (current.status !== "lobby") throw new ApiFault(409, "這一局已經開始了。", "round_started");
      if (current.members.length < 2) throw new ApiFault(409, "再邀請一位朋友，就可以一起點亮聖誕樹。", "need_more_players");
      current.status = "playing"; current.startedAt = Date.now(); current.endsAt = current.startedAt + GAME_ROUND_SECONDS * 1000; current.lit = [];
      return true;
    }
    const bulb = body.bulb;
    if (!Number.isInteger(bulb) || Number(bulb) < 0 || Number(bulb) >= GAME_TOTAL_BULBS) throw new ApiFault(400, "找不到這盞燈。", "invalid_bulb");
    const myIndex = current.members.findIndex(m => m.id === me.id);
    if (Number(bulb) % current.members.length !== myIndex) throw new ApiFault(403, "這盞燈交給朋友，請點亮你的顏色。", "not_your_bulb");
    if (current.lit.includes(Number(bulb))) return false;
    if (current.status !== "playing") throw new ApiFault(409, "這一局還沒開始或已經結束。", "round_not_playing");
    const next = Array.from({ length: GAME_TOTAL_BULBS }, (_, index) => index).find(index => index % current.members.length === myIndex && !current.lit.includes(index));
    if (next !== bulb) throw new ApiFault(409, "先點亮正在等待你的那盞燈。", "out_of_order");
    current.lit = [...current.lit, Number(bulb)].sort((a, b) => a - b);
    if (current.lit.length === GAME_TOTAL_BULBS) { current.status = "won"; current.completedAt = new Date().toISOString(); }
    return true;
  };
  let room = await updateRoom(code, session, mutate);
  // A request can be the first observer of the deadline. Finish that state transition,
  // then honor leave as well, rather than returning success while retaining the member.
  if (action === "leave" && room.status === "lost" && room.members.some(member => member.sessionHash === session.hash)) {
    room = await updateRoom(code, session, mutate);
  }
  return response(snapshot(room, session.hash), session);
}
