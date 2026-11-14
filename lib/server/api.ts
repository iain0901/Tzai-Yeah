import { database, type SqlDatabase, type SqlPreparedStatement } from "./database";
import { getSessionUser, publicOrigin } from "./auth";
import type { AdminData, Card, EventConfig, Group, Participant, Profile, PublicEventData, UserIdentity } from "../contracts";
import { ApiFault, csvCell, DEFAULT_EVENT, EMPTY_PROFILE, idValue, parseProfile, randomToken, sha256, textValue, validateEvent } from "./validation";
import { gameMemory, getGame, postGame } from "./game";
import { getTree, getTreeLeaderboard, postTree } from "./tree";

type Row = Record<string, unknown>;
type Publication = { version: number; publishedAt: string | null; assignments: Record<string, Group> };
const NO_PUBLICATION: Publication = { version: 0, publishedAt: null, assignments: {} };
const responseHeaders = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Vary": "Cookie" };

function db(): SqlDatabase {
  return database();
}
function householdNumberValue(value: unknown, house: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || !house) throw new ApiFault(400, "家內編號須為正整數，並填寫家別。", "invalid_household_number");
  return value;
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: responseHeaders }); }
function userFor(request: Request): UserIdentity | null {
  return getSessionUser(request);
}
function requireUser(request: Request) {
  const user = userFor(request);
  if (!user) throw new ApiFault(401, "請先登入，再繼續操作。", "signin_required");
  return user;
}
function requireAdmin(request: Request) {
  const user = requireUser(request);
  if (user.role !== "admin") throw new ApiFault(403, "這個帳號沒有管理權限。", "admin_required");
  return user;
}
function csrf(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== publicOrigin() || request.headers.get("sec-fetch-site") === "cross-site") throw new ApiFault(403, "請從本站重新開啟頁面後操作。", "invalid_origin");
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") || "")) throw new ApiFault(415, "請使用 JSON 格式送出。", "invalid_content_type");
}
async function bodyFor(request: Request): Promise<Row> {
  if (Number(request.headers.get("content-length") || 0) > 350000) throw new ApiFault(413, "資料太多，請分批匯入。");
  const text = await request.text();
  if (text.length > 350000) throw new ApiFault(413, "資料太多，請分批匯入。");
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new ApiFault(400, "送出的資料格式不正確。"); }
}
function auditStatement(user: UserIdentity | string, action: string, detail: string, onlyIfChanged = false) {
  const sql = onlyIfChanged
    ? "INSERT INTO audit (id, actor, action, detail, created_at) SELECT ?, ?, ?, ?, ? WHERE changes()>0"
    : "INSERT INTO audit (id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?)";
  return db().prepare(sql).bind(crypto.randomUUID(), typeof user === "string" ? user : user.email, action, detail, new Date().toISOString());
}
function settingStatement(id: string, value: unknown) {
  return db().prepare("INSERT INTO settings (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").bind(id, JSON.stringify(value));
}
async function settingsData(): Promise<{ event: EventConfig; publication: Publication }> {
  const result = await db().prepare("SELECT id,value FROM settings WHERE id IN ('event','publication')").all<{ id: string; value: string }>();
  let event = { ...DEFAULT_EVENT };
  let publication = { ...NO_PUBLICATION };
  for (const row of result.results) {
    if (row.id === "event") event = { ...DEFAULT_EVENT, ...JSON.parse(row.value) };
    if (row.id === "publication") publication = JSON.parse(row.value);
  }
  event.publishedAt = publication.publishedAt;
  event.publishedVersion = publication.version;
  return { event, publication };
}
async function publicCardRow(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) throw new ApiFault(404, "找不到這張小卡，請重新感應或洽工作人員。", "card_not_found");
  const row = await db().prepare("SELECT c.id,c.serial,c.active,b.participant_id,p.owner_id,p.profile,p.claim_hash,p.claim_created_at FROM cards c LEFT JOIN card_bindings b ON b.card_id=c.id LEFT JOIN participants p ON p.id=b.participant_id WHERE c.token=?").bind(token).first<Row>();
  if (!row) throw new ApiFault(404, "找不到這張小卡，請重新感應或洽工作人員。", "card_not_found");
  if (!row.active) throw new ApiFault(410, "這張小卡已停用，請洽工作人員協助。", "card_inactive");
  return row;
}
function storedProfile(value: unknown): Profile | null {
  try {
    const profile = JSON.parse(String(value));
    if (!profile || typeof profile !== "object" || Array.isArray(profile) || typeof profile.displayName !== "string" || typeof profile.bio !== "string" || typeof profile.url !== "string" || !["page", "redirect"].includes(profile.mode)) return null;
    parseProfile(profile);
    return { displayName: profile.displayName, bio: profile.bio, url: profile.url, mode: profile.mode };
  } catch { return null; }
}
function cardProfile(row: Row, includeSaved = true): Profile {
  const profile = (includeSaved ? storedProfile(row.profile) : null) || { ...EMPTY_PROFILE };
  return { ...profile, displayName: profile.displayName.trim() || `#${row.serial}` };
}
function requireBoundCard(row: Row) {
  if (!row.participant_id) throw new ApiFault(409, "這張小卡還在等主辦配對，完成後就能編輯個人介紹。", "unbound_card");
}
async function publicEvent(url: URL): Promise<PublicEventData> {
  const token = url.searchParams.get("token");
  const [{ event, publication }, row] = await Promise.all([settingsData(), token ? publicCardRow(token) : null]);
  if (!row) return { event, card: null };
  const participantId = row.participant_id as string | null;
  const visibleGroup = event.phase === "live" && event.revealOpen && participantId ? publication.assignments[participantId] || null : null;
  return { event, card: { serial: String(row.serial), active: true, bound: !!participantId, group: visibleGroup, profile: cardProfile(row, event.phase === "after"), claimed: !!row.owner_id } };
}
async function adminData(request: Request): Promise<AdminData> {
  const user = requireAdmin(request);
  const [{ event, publication }, allCards, allParticipants, allGroups, audit] = await Promise.all([
    settingsData(),
    db().prepare("SELECT c.*,b.participant_id FROM cards c LEFT JOIN card_bindings b ON b.card_id=c.id ORDER BY CAST(c.serial AS INTEGER)").all<Row>(),
    db().prepare("SELECT p.id,p.name,p.house,p.household_number,p.group_id,p.checked_in_at,p.owner_id,p.claim_hash,p.profile,b.card_id,c.token AS card_token,c.active AS card_active FROM participants p LEFT JOIN card_bindings b ON b.participant_id=p.id LEFT JOIN cards c ON c.id=b.card_id ORDER BY p.created_at,p.name").all<Row>(),
    db().prepare("SELECT * FROM groups ORDER BY name").all<Group>(),
    db().prepare("SELECT id,actor,action,detail,created_at AS createdAt FROM audit ORDER BY created_at DESC LIMIT 30").all<AdminData["audit"][number]>(),
  ]);
  const origin = publicOrigin();
  const cards: Card[] = allCards.results.map(r => ({ id: String(r.id), serial: String(r.serial), token: String(r.token), url: `${origin}/t/${r.token}`, active: !!r.active, participantId: r.participant_id as string | null, createdAt: String(r.created_at) }));
  const participants: Participant[] = allParticipants.results.map(r => {
    return { id: String(r.id), name: String(r.name), house: String(r.house), householdNumber: r.household_number as number | null, groupId: r.group_id as string | null, cardId: r.card_id as string | null, checkedInAt: r.checked_in_at as string | null, claimed: !!r.owner_id, hasClaimCode: !!r.claim_hash, profile: storedProfile(r.profile), url: r.card_token ? `${origin}/t/${r.card_token}` : null, linkActive: !!r.card_active };
  });
  return { event, cards, participants, groups: allGroups.results, user, audit: audit.results, stats: { cards: cards.length, participants: participants.length, bound: cards.filter(c => c.participantId).length, grouped: participants.filter(p => p.groupId).length, checkedIn: participants.filter(p => p.checkedInAt).length, published: Object.keys(publication.assignments).length } };
}
async function ensureParticipantLink(body: Row, user: UserIdentity) {
  const participantId = idValue(body.participantId);
  if (!participantId || !await db().prepare("SELECT id FROM participants WHERE id=?").bind(participantId).first()) throw new ApiFault(404, "找不到參加者。");
  const readBoundCard = () => db().prepare("SELECT c.id,c.token,c.active FROM card_bindings b JOIN cards c ON c.id=b.card_id WHERE b.participant_id=?").bind(participantId).first<Row>();
  const linkResult = (card: Row, created: boolean) => {
    if (!card.active) throw new ApiFault(409, "這位參加者的連結已停用，請先在連結設定中確認。", "link_inactive");
    return { ok: true as const, message: created ? "專屬連結已建立。" : "已取得原本的專屬連結。", url: `${publicOrigin()}/t/${card.token}`, participantId, cardId: String(card.id), created };
  };
  const existing = await readBoundCard();
  if (existing) return linkResult(existing, false);

  // Allocate a fresh link rather than reuse an unbound card that may already be printed or shared.
  // Both guards run in one transaction, so a concurrent assignment wins without an orphan card.
  const cardId = crypto.randomUUID();
  const results = await db().batch([
    db().prepare("INSERT INTO cards (id,serial,token,active,created_at) SELECT ?,printf('%03d',(SELECT COALESCE(MAX(CAST(serial AS INTEGER)),0)+1 FROM cards)),?,1,? WHERE EXISTS(SELECT 1 FROM participants WHERE id=?) AND NOT EXISTS(SELECT 1 FROM card_bindings WHERE participant_id=?)").bind(cardId, randomToken(), new Date().toISOString(), participantId, participantId),
    db().prepare("INSERT INTO card_bindings (card_id,participant_id) SELECT id,? FROM cards WHERE id=? AND active=1 AND NOT EXISTS(SELECT 1 FROM card_bindings WHERE participant_id=?)").bind(participantId, cardId, participantId),
    auditStatement(user, "ensureParticipantLink", `participant=${participantId};card=${cardId}`, true),
  ]);
  const bound = await readBoundCard();
  if (!bound) throw new ApiFault(409, "參加者資料剛剛有變更，請重新整理後再試。", "conflict");
  return linkResult(bound, results[1].meta.changes > 0);
}
async function saveParticipant(body: Row, user: UserIdentity) {
  const suppliedId = idValue(body.id);
  const id = suppliedId || crypto.randomUUID();
  const name = textValue(body.name, "姓名", 80, true);
  const house = textValue(body.house, "家別", 80);
  const current = suppliedId ? await db().prepare("SELECT p.id,p.household_number,p.group_id,b.card_id FROM participants p LEFT JOIN card_bindings b ON b.participant_id=p.id WHERE p.id=?").bind(id).first<Row>() : null;
  if (suppliedId && !current) throw new ApiFault(404, "找不到參加者。");
  const householdNumber = householdNumberValue("householdNumber" in body ? body.householdNumber : current?.household_number, house);
  const groupId = "groupId" in body ? idValue(body.groupId) : (current?.group_id as string || null);
  const cardId = "cardId" in body ? idValue(body.cardId) : (current?.card_id as string || null);
  if (groupId && !await db().prepare("SELECT id FROM groups WHERE id=?").bind(groupId).first()) throw new ApiFault(400, "指定的組別不存在。");
  if (cardId && ("cardId" in body)) {
    const card = await db().prepare("SELECT active FROM cards WHERE id=?").bind(cardId).first<{ active: number }>();
    if (!card || !card.active) throw new ApiFault(400, "請選擇有效的小卡。");
  }
  const statements = [suppliedId
    ? db().prepare("UPDATE participants SET name=?,house=?,household_number=?,group_id=? WHERE id=?").bind(name, house, householdNumber, groupId, id)
    : db().prepare("INSERT INTO participants (id,name,house,household_number,group_id,created_at) VALUES (?,?,?,?,?,?)").bind(id, name, house, householdNumber, groupId, new Date().toISOString())];
  if (current?.card_id !== cardId) {
    if (current?.card_id) statements.push(db().prepare("UPDATE cards SET active=0 WHERE id=?").bind(current.card_id));
    statements.push(db().prepare("DELETE FROM card_bindings WHERE participant_id=?").bind(id));
    if (cardId) statements.push(db().prepare("INSERT INTO card_bindings (card_id,participant_id) VALUES (?,?)").bind(cardId, id));
  }
  statements.push(auditStatement(user, "saveParticipant", `participant=${id}`));
  await db().batch(statements);
  return { ok: true, message: "參加者資料已儲存。" };
}
async function importParticipants(body: Row, user: UserIdentity) {
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 500) throw new ApiFault(400, "每次請匯入 1～500 位參加者。");
  const hash = await sha256(JSON.stringify(body.rows));
  const importId = `import:${hash}`;
  if (await db().prepare("SELECT id FROM settings WHERE id=?").bind(importId).first()) return { ok: true, message: "這批名單已匯入，沒有重複新增。", count: 0 };
  const [groups, cards] = await Promise.all([db().prepare("SELECT id FROM groups").all<{ id: string }>(), db().prepare("SELECT c.id,c.serial,c.active,b.participant_id FROM cards c LEFT JOIN card_bindings b ON b.card_id=c.id").all<Row>()]);
  const groupIds = new Set(groups.results.map(g => g.id));
  const cardMap = new Map(cards.results.map(c => [String(c.serial), c]));
  const usedCards = new Set<string>();
  const statements: SqlPreparedStatement[] = [];
  for (const [index, entry] of body.rows.entries()) {
    if (!entry || typeof entry !== "object") throw new ApiFault(400, `第 ${index + 1} 列資料格式不正確。`);
    const row = entry as Row;
    const name = textValue(row.name, `第 ${index + 1} 列姓名`, 80, true);
    const house = textValue(row.house, `第 ${index + 1} 列家別`, 80);
    const householdNumber = householdNumberValue(row.householdNumber, house);
    const groupId = idValue(row.groupId);
    if (groupId && !groupIds.has(groupId)) throw new ApiFault(400, `第 ${index + 1} 列的組別不存在。`);
    const serial = textValue(row.cardSerial, "卡套流水號", 8).padStart(3, "0");
    const card = serial === "000" ? null : cardMap.get(serial);
    if (serial !== "000" && (!card || !card.active || card.participant_id || usedCards.has(String(card.id)))) throw new ApiFault(409, `第 ${index + 1} 列的卡片不存在、已停用或重複綁定。`, "card_conflict");
    const id = crypto.randomUUID();
    statements.push(db().prepare("INSERT INTO participants (id,name,house,household_number,group_id,created_at) VALUES (?,?,?,?,?,?)").bind(id, name, house, householdNumber, groupId, new Date().toISOString()));
    if (card) { usedCards.add(String(card.id)); statements.push(db().prepare("INSERT INTO card_bindings (card_id,participant_id) VALUES (?,?)").bind(card.id, id)); }
  }
  statements.push(db().prepare("INSERT INTO settings (id,value) VALUES (?,?)").bind(importId, JSON.stringify({ count: body.rows.length, at: new Date().toISOString() })), auditStatement(user, "importParticipants", `count=${body.rows.length}`));
  await db().batch(statements);
  return { ok: true, message: `已匯入 ${body.rows.length} 位參加者。`, count: body.rows.length };
}
async function adminAction(request: Request, body: Row) {
  const user = requireAdmin(request);
  const action = textValue(body.action, "操作", 40, true);
  if (action === "saveParticipant") return saveParticipant(body, user);
  if (action === "importParticipants") return importParticipants(body, user);
  if (action === "ensureParticipantLink") return ensureParticipantLink(body, user);
  if (action === "saveEvent") {
    const { event } = await settingsData();
    const next = validateEvent(event, body.event);
    await db().batch([settingStatement("event", next), auditStatement(user, action, `phase=${next.phase};reveal=${next.revealOpen}`)]);
    return { ok: true, message: "活動設定已儲存。" };
  }
  if (action === "generateCards") {
    const count = body.count ?? 150;
    if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 500) throw new ApiFault(400, "卡片總數請填寫 1～500。");
    const existing = await db().prepare("SELECT serial FROM cards").all<{ serial: string }>();
    const serials = new Set(existing.results.map(c => c.serial));
    const statements: SqlPreparedStatement[] = [];
    for (let i = 1; i <= Number(count); i++) {
      const serial = String(i).padStart(3, "0");
      if (!serials.has(serial)) statements.push(db().prepare("INSERT OR IGNORE INTO cards (id,serial,token,active,created_at) VALUES (?,?,?,1,?)").bind(crypto.randomUUID(), serial, randomToken(), new Date().toISOString()));
    }
    if (!statements.length) return { ok: true, message: "指定數量的小卡已存在，原有網址保持不變。", count: 0 };
    const added = statements.length;
    statements.push(auditStatement(user, action, `target=${count};added=${added}`));
    await db().batch(statements);
    return { ok: true, message: `已新增 ${added} 張小卡，原有網址保持不變。`, count: added };
  }
  if (action === "saveGroup") {
    const id = idValue(body.id) || crypto.randomUUID();
    const name = textValue(body.name, "組名", 60, true);
    const location = textValue(body.location, "集合地點", 120);
    const note = textValue(body.note, "組別提醒", 500);
    const color = textValue(body.color, "組別顏色", 7) || "#c55b4f";
    if (!/^#[a-fA-F0-9]{6}$/.test(color)) throw new ApiFault(400, "組別顏色格式不正確。");
    await db().batch([db().prepare("INSERT INTO groups (id,name,location,note,color) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,location=excluded.location,note=excluded.note,color=excluded.color").bind(id, name, location, note, color), auditStatement(user, action, `group=${id}`)]);
    return { ok: true, message: "組別草稿已儲存，發布後參加者才會看到更新。" };
  }
  if (action === "deleteGroup") {
    const id = idValue(body.id);
    if (!id) throw new ApiFault(400, "請指定組別。");
    await db().batch([db().prepare("UPDATE participants SET group_id=NULL WHERE group_id=?").bind(id), db().prepare("DELETE FROM groups WHERE id=?").bind(id), auditStatement(user, action, `group=${id}`)]);
    return { ok: true, message: "已移除組別草稿；原組員現在尚未分組。請重新安排並發布。" };
  }
  if (action === "publishGroups") {
    const ungrouped = await db().prepare("SELECT COUNT(*) AS count FROM participants WHERE group_id IS NULL").first<{ count: number }>();
    if (ungrouped?.count) throw new ApiFault(409, `還有 ${ungrouped.count} 位參加者未分組，請完成後再發布。`, "incomplete_groups");
    const count = await db().prepare("SELECT COUNT(*) AS count FROM participants").first<{ count: number }>();
    if (!count?.count) throw new ApiFault(400, "請先新增參加者與分組。");
    // One SQL statement captures the complete assignment snapshot. Later draft edits cannot leak.
    const snapshot = db().prepare("INSERT INTO settings (id,value) SELECT 'publication',json_object('version',COALESCE((SELECT json_extract(value,'$.version') FROM settings WHERE id='publication'),0)+1,'publishedAt',?,'assignments',json((SELECT json_group_object(p.id,json_object('id',g.id,'name',g.name,'location',g.location,'note',g.note,'color',g.color)) FROM participants p JOIN groups g ON p.group_id=g.id))) WHERE NOT EXISTS(SELECT 1 FROM participants WHERE group_id IS NULL) AND EXISTS(SELECT 1 FROM participants) ON CONFLICT(id) DO UPDATE SET value=excluded.value").bind(new Date().toISOString());
    const results = await db().batch([snapshot, auditStatement(user, action, `participants=${count.count}`, true)]);
    if (!results[0].meta.changes) throw new ApiFault(409, "名單剛剛有變更，請確認所有人都已分組後再發布。", "incomplete_groups");
    return { ok: true, message: "分組已完整發布。活動中開啟揭曉後，參加者即可查看。", count: count.count };
  }
  if (action === "setCardActive") {
    const id = idValue(body.cardId);
    if (!id || typeof body.active !== "boolean") throw new ApiFault(400, "卡片設定不正確。");
    const exists = await db().prepare("SELECT id FROM cards WHERE id=?").bind(id).first();
    if (!exists) throw new ApiFault(404, "找不到小卡。");
    await db().batch([db().prepare("UPDATE cards SET active=? WHERE id=?").bind(body.active ? 1 : 0, id), auditStatement(user, action, `card=${id};active=${body.active}`)]);
    return { ok: true, message: body.active ? "小卡已啟用。" : "小卡已停用。" };
  }
  if (action === "checkIn" || action === "issueClaimCode") {
    const id = idValue(body.participantId);
    const person = id ? await db().prepare("SELECT id,owner_id FROM participants WHERE id=?").bind(id).first<Row>() : null;
    if (!person) throw new ApiFault(404, "找不到參加者。");
    if (action === "checkIn") {
      if ("checkedIn" in body && typeof body.checkedIn !== "boolean") throw new ApiFault(400, "報到狀態不正確。");
      const at = body.checkedIn === false ? null : new Date().toISOString();
      await db().batch([db().prepare("UPDATE participants SET checked_in_at=? WHERE id=?").bind(at, id), auditStatement(user, action, `participant=${id};checkedIn=${!!at}`)]);
      return { ok: true, message: at ? "已完成報到。" : "已取消報到。" };
    }
    if (person.owner_id && body.resetOwner !== true) throw new ApiFault(409, "這位參加者已認領。若要交還帳號，請明確選擇重設擁有者。", "already_claimed");
    const code = randomToken(16);
    const hash = await sha256(code);
    await db().batch([db().prepare("UPDATE participants SET claim_hash=?,claim_created_at=?,owner_id=CASE WHEN ?=1 THEN NULL ELSE owner_id END WHERE id=?").bind(hash, new Date().toISOString(), body.resetOwner === true ? 1 : 0, id), auditStatement(user, action, `participant=${id};reset=${body.resetOwner === true}`)]);
    return { ok: true, message: "認領碼只顯示這一次，請私下交給本人；有效期限為 30 天。", code };
  }
  throw new ApiFault(400, "不支援的管理操作。");
}
async function me(request: Request, url: URL) {
  const user = userFor(request);
  const token = url.searchParams.get("token");
  if (!token) throw new ApiFault(400, "請從自己的小卡開啟。");
  const row = await publicCardRow(token);
  requireBoundCard(row);
  const isOwner = !!user && row.owner_id === user.id;
  // Legacy account ownership remains informational; this active card URL grants access.
  return { user, isOwner, canEdit: true, serial: String(row.serial), bound: true, profile: cardProfile(row) };
}
async function claim(request: Request, body: Row) {
  const user = requireUser(request);
  const token = textValue(body.token, "小卡代碼", 48, true);
  const code = textValue(body.code, "認領碼", 80, true).toLowerCase().replace(/[\s-]/g, "");
  const row = await publicCardRow(token);
  if (!row.participant_id) throw new ApiFault(409, "這張小卡尚未配對參加者，請洽工作人員。", "unbound_card");
  if (row.owner_id) throw new ApiFault(409, row.owner_id === user.id ? "這張小卡已經是你的了。" : "這張小卡已被認領，請洽工作人員核對。", "already_claimed");
  const now = Date.now();
  const bucket = await sha256(`claim:${row.participant_id}:${Math.floor(now / 3600000)}`);
  await db().prepare("INSERT INTO claim_attempts (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1").bind(bucket, now + 3600000).run();
  const attempts = await db().prepare("SELECT count FROM claim_attempts WHERE key=?").bind(bucket).first<{ count: number }>();
  if ((attempts?.count || 0) > 8) throw new ApiFault(429, "嘗試次數較多，請稍後再試或洽工作人員。", "too_many_attempts");
  const hash = await sha256(code);
  const created = Date.parse(String(row.claim_created_at || ""));
  if (!row.claim_hash || row.claim_hash !== hash || !Number.isFinite(created) || now - created > 30 * 86400000) throw new ApiFault(400, "認領碼不正確或已過期，請向工作人員確認。", "invalid_claim_code");
  const result = await db().prepare("UPDATE participants SET owner_id=?,claim_hash=NULL,claim_created_at=NULL WHERE id=? AND owner_id IS NULL AND claim_hash=?").bind(user.id, row.participant_id, hash).run();
  if (!result.meta.changes) throw new ApiFault(409, "認領碼已被使用，請重新整理頁面。", "claim_conflict");
  await db().batch([auditStatement(user, "claim", `participant=${row.participant_id}`), db().prepare("DELETE FROM claim_attempts WHERE expires_at < ?").bind(now)]);
  return { ok: true, message: "認領成功，現在可以設定你的小卡。" };
}
async function saveProfile(request: Request, body: Row) {
  const token = textValue(body.token, "小卡代碼", 48, true);
  const row = await publicCardRow(token);
  requireBoundCard(row);
  const profile = parseProfile(body);
  // Prevent redirect loops back into this card or the same Site.
  if (profile.url && new URL(profile.url).origin === publicOrigin()) throw new ApiFault(400, "個人連結請填寫本站以外的網址。");
  // Recheck the token, activation and binding in the write itself. A concurrent
  // disable, token rotation or rebind must not write to the old participant.
  const result = await db().batch([db().prepare("UPDATE participants SET profile=? WHERE id=? AND EXISTS (SELECT 1 FROM card_bindings b JOIN cards c ON c.id=b.card_id WHERE b.participant_id=participants.id AND c.id=? AND c.token=? AND c.active=1)").bind(JSON.stringify(profile), row.participant_id, row.id, token), auditStatement(`card:${row.id}`, "saveProfile", `participant=${row.participant_id}`, true)]);
  if (!result[0].meta.changes) throw new ApiFault(409, "小卡狀態剛剛有變更，請重新讀取後再試。", "card_access_changed");
  return { ok: true, message: "個人連結已儲存，活動結束後會顯示在小卡上。" };
}
async function exportCsv(request: Request, url: URL) {
  const data = await adminData(request);
  const kind = url.searchParams.get("kind") || "cards";
  if (!["cards", "participants", "offline"].includes(kind)) throw new ApiFault(400, "匯出類型不正確。");
  const people = new Map(data.participants.map(p => [p.id, p]));
  const cards = new Map(data.cards.map(c => [c.id, c]));
  const groups = new Map(data.groups.map(g => [g.id, g]));
  const { publication } = await settingsData();
  let rows: unknown[][];
  if (kind === "cards") rows = [["卡套流水號", "NFC網址", "啟用", "姓名", "家別", "家內編號"], ...data.cards.map(c => [c.serial, c.url, c.active ? "是" : "否", c.participantId ? people.get(c.participantId)?.name : "", c.participantId ? people.get(c.participantId)?.house : "", c.participantId ? people.get(c.participantId)?.householdNumber : ""])];
  else rows = [["姓名", "家別", "家內編號", "系統編號", kind === "offline" ? "已發布組別" : "草稿組別", "集合地點"], ...data.participants.map(p => { const g = kind === "offline" ? publication.assignments[p.id] : groups.get(p.groupId || ""); return [p.name, p.house, p.householdNumber, cards.get(p.cardId || "")?.serial || "", g?.name || "尚未分組", g?.location || ""]; })];
  const csv = "\uFEFF" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
  return new Response(csv, { headers: { ...responseHeaders, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tzai-${kind}.csv"` } });
}
export async function handleApi(request: Request) {
  try {
    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, "");
    if (request.method === "GET") {
      if (route === "/api/tree") return await getTree(request, url);
      if (route === "/api/tree/leaderboard") return await getTreeLeaderboard(request, url);
      if (route === "/api/game") return await getGame(request, url);
      if (route === "/api/game/memory") return await gameMemory(request, url);
      if (route === "/api/event") return json(await publicEvent(url));
      if (route === "/api/admin") return json(await adminData(request));
      if (route === "/api/admin/export") return await exportCsv(request, url);
      if (route === "/api/me") return json(await me(request, url));
    }
    if (request.method === "POST") {
      csrf(request);
      const body = await bodyFor(request);
      if (route === "/api/tree") return await postTree(request, body);
      if (route === "/api/game") return await postGame(request, body);
      if (route === "/api/admin/action") return json(await adminAction(request, body));
      if (route === "/api/claim") return json(await claim(request, body));
      if (route === "/api/profile") return json(await saveProfile(request, body));
    }
    return json({ error: "找不到這個功能。", code: "not_found" }, 404);
  } catch (error) {
    if (error instanceof ApiFault) return json({ error: error.message, code: error.code }, error.status);
    if (String(error).includes("participants.house, participants.household_number")) return json({ error: "同一家別的家內編號已被使用。", code: "household_number_conflict" }, 409);
    if (String(error).includes("UNIQUE constraint failed")) return json({ error: "資料已被其他操作更新，或卡片已有人使用。請重新整理後再試。", code: "conflict" }, 409);
    if (String(error).includes("FOREIGN KEY constraint failed")) return json({ error: "相關資料已變更，請重新整理後再試。", code: "conflict" }, 409);
    console.error("Love Pass API error", error instanceof Error ? error.message : "unknown");
    return json({ error: "暫時無法完成操作，請稍後重試。", code: "server_error" }, 500);
  }
}
