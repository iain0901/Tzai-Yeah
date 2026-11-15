"use client";

import { useEffect, useRef, useState } from "react";
import type { Participant } from "@/lib/contracts";
import NfcWriter, { useNfcSupport } from "./NfcWriter";

export type BatchParticipant = Pick<Participant, "id" | "name" | "house" | "householdNumber" | "url" | "linkActive">;
type Props = {
  participants: readonly BatchParticipant[];
  ensureUrl: (participantId: string) => Promise<string | null>;
};
type Queue = { ids: string[]; excludedInactive: number };
type Verification = { id: string; url: string; verified: boolean } | null;
const collator = new Intl.Collator("zh-Hant-TW", { numeric: true, sensitivity: "variant" });

function numberedHouse(value: string): number | null {
  const match = value.match(/^(?:第)?([0-9一二三四五六七八九十百零〇兩]+)(?:家)?$/);
  if (!match) return null;
  if (/^\d+$/.test(match[1])) return Number(match[1]);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0, digit = 0;
  for (const character of match[1]) {
    if (character === "十" || character === "百") { total += (digit || 1) * (character === "十" ? 10 : 100); digit = 0; }
    else digit = digits[character];
  }
  return total + digit;
}

export function isInactiveForBatch(person: BatchParticipant): boolean {
  // A person without a link is eligible: their link is provisioned only on their turn.
  return !!person.url && !person.linkActive;
}

export function compareHouseNames(first: string, second: string): number {
  const a = first.trim(), b = second.trim();
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const numericA = numberedHouse(a), numericB = numberedHouse(b);
  if (numericA !== null && numericB !== null) return numericA - numericB || collator.compare(a, b);
  if (numericA !== null) return -1;
  if (numericB !== null) return 1;
  return collator.compare(a, b);
}

export function createNfcQueue(participants: readonly BatchParticipant[], house: string | null = null): Queue {
  const selected = participants.map((person, index) => ({ person, index })).filter(({ person }) => house === null || person.house.trim() === house);
  const excludedInactive = selected.filter(({ person }) => isInactiveForBatch(person)).length;
  const eligible = selected.filter(({ person }) => !isInactiveForBatch(person));
  eligible.sort((left, right) => {
    const byHouse = compareHouseNames(left.person.house, right.person.house);
    if (byHouse) return byHouse;
    const numberA = left.person.householdNumber ?? Number.POSITIVE_INFINITY;
    const numberB = right.person.householdNumber ?? Number.POSITIVE_INFINITY;
    return (numberA === numberB ? 0 : numberA - numberB) || left.index - right.index;
  });
  return { ids: eligible.map(({ person }) => person.id), excludedInactive };
}

export default function NfcBatchWriter({ participants, ensureUrl }: Props) {
  const support = useNfcSupport();
  const [house, setHouse] = useState<string | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [index, setIndex] = useState(0);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [verification, setVerification] = useState<Verification>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const request = useRef(0);
  const pending = useRef(false);
  const currentIdRef = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current += 1; pending.current = false; currentIdRef.current = null; };
  }, []);

  const preview = createNfcQueue(participants, house);
  const houses = Array.from(new Set(participants.map(person => person.house.trim()))).sort(compareHouseNames);
  const currentId = queue?.ids[index] ?? null;
  // IDs/order stay frozen for this round, but permissions and roster details remain live.
  const current = participants.find(person => person.id === currentId);
  const completed = !!queue && index >= queue.ids.length;
  const blocked = !!currentId && (!current || isInactiveForBatch(current));
  const currentUrl = link?.id === currentId ? link.url : "";
  const staleUrl = !!current?.url && !!currentUrl && current.url !== currentUrl;
  const canAdvance = !!currentId && !!currentUrl && !loading && !blocked && !staleUrl && verification?.id === currentId && verification.url === currentUrl && verification.verified;

  async function provision(id: string) {
    if (pending.current) return;
    const livePerson = participants.find(person => person.id === id);
    if (!livePerson || isInactiveForBatch(livePerson)) { setLoading(false); setLink(null); setVerification(null); return; }
    pending.current = true;
    const sequence = ++request.current;
    setLoading(true); setLink(null); setVerification(null); setError("");
    try {
      // Called only from Start/Next/Retry; callback identity changes never provision another link.
      const url = await ensureUrl(id);
      if (!mounted.current || request.current !== sequence || currentIdRef.current !== id) return;
      if (!url) throw new Error("暫時無法取得這位參加者的專屬連結。請確認後重試，本輪不會跳過他。");
      setLink({ id, url });
    } catch (reason) {
      if (mounted.current && request.current === sequence && currentIdRef.current === id) setError(reason instanceof Error ? reason.message : "連結準備失敗，請重試。");
    } finally {
      if (mounted.current && request.current === sequence) { pending.current = false; setLoading(false); }
    }
  }

  function start() {
    if (!support.ready || queue || pending.current || !preview.ids.length) return;
    const next = createNfcQueue(participants, house);
    if (!next.ids.length) return;
    currentIdRef.current = next.ids[0]; setQueue(next); setIndex(0);
    void provision(next.ids[0]);
  }
  function nextPerson() {
    if (!queue || !canAdvance || pending.current || currentIdRef.current !== currentId) return;
    const nextIndex = index + 1;
    // Clear synchronously so a second tap cannot advance twice with the old verification.
    currentIdRef.current = queue.ids[nextIndex] ?? null;
    setVerification(null); setLink(null); setError(""); setIndex(nextIndex);
    if (nextIndex < queue.ids.length) void provision(queue.ids[nextIndex]);
  }
  function onVerificationChange(verified: boolean, url: string) {
    if (!mounted.current || !currentId || currentIdRef.current !== currentId || currentUrl !== url) return;
    setVerification({ id: currentId, url, verified });
  }

  if (!queue) return <section className="ad-section" aria-label="連續寫卡準備">
    <p className="ad-dialog-copy">依家別、家內編號，逐一寫入每個人的專屬連結。每張卡驗證成功後，才能前往下一位。</p>
    <label className="ad-field"><span>這一輪要寫哪些人的卡片</span><select value={house === null ? "" : JSON.stringify(house)} onChange={event => setHouse(event.target.value ? JSON.parse(event.target.value) as string : null)}>
      <option value="">全部家別（{createNfcQueue(participants).ids.length} 位）</option>
      {houses.map(value => <option key={value} value={JSON.stringify(value)}>{value || "未填家別"}（{createNfcQueue(participants, value).ids.length} 位）</option>)}
    </select></label>
    <p className="ad-muted">本輪共 {preview.ids.length} 位。未填家別或家內編號者排在最後；同順位保留名單原順序。</p>
    {preview.excludedInactive > 0 && <p className="ad-inline-warning">另有 {preview.excludedInactive} 位的專屬連結已停用，不列入本輪。</p>}
    {!preview.ids.length && <p className="ad-muted">目前沒有可寫卡的人員，請先檢查名單。</p>}
    {!support.ready && <p className="ad-muted" role="status">{support.message}</p>}
    <button type="button" className="ad-button ad-button-primary" disabled={!support.ready || !preview.ids.length} onClick={start}>開始連續寫卡</button>
  </section>;

  if (completed) return <section className="ad-section" aria-label="本輪寫卡完成">
    <h3>這一輪，都寫好了。</h3><p className="ad-success-text" role="status">已完成 {queue.ids.length} 位，每張卡都已讀回驗證。</p>
    {queue.excludedInactive > 0 && <p className="ad-muted">本輪另有 {queue.excludedInactive} 位的連結已停用，未列入。</p>}
    <p className="ad-muted">請確認卡套姓名與家內編號，再關閉這個視窗。寫卡已停止。</p>
  </section>;

  return <section className="ad-section" aria-label="連續寫卡進度">
    <div className="ad-summary-lines"><p><span>目前進度</span><strong>第 {index + 1} / {queue.ids.length} 位</strong></p><p><span>已完成</span><strong>{index} 位</strong></p></div>
    {queue.excludedInactive > 0 && <p className="ad-muted">本輪未列入 {queue.excludedInactive} 位連結已停用的人員。</p>}
    <div className="ad-profile-person"><div><h3>{current?.name || "這位人員已不在名單中"}</h3><p>{current?.house || "未填家別"}{current?.householdNumber != null ? ` · 家內 ${current.householdNumber} 號` : " · 未填家內編號"}</p></div></div>
    {blocked ? <p className="ad-inline-warning" role="alert">{current ? "這位參加者的專屬連結已停用。" : "這位參加者已從名單移除。"}本輪已停在這一位，請先確認人員資料；不會自動跳過。</p>
      : staleUrl ? <><p className="ad-inline-warning" role="alert">這位參加者的專屬連結已變更，已停止使用舊連結。請重新取得連結並驗證卡片。</p><button type="button" className="ad-button" onClick={() => currentId && void provision(currentId)}>重新取得目前連結</button></>
      : loading ? <p className="ad-muted" role="status">正在準備這位參加者的專屬連結…</p>
      : error ? <><p className="ad-inline-warning" role="alert">{error}</p><button type="button" className="ad-button" onClick={() => currentId && void provision(currentId)}>重試取得連結</button></>
      : currentUrl && <NfcWriter key={`${currentId}:${currentUrl}`} url={currentUrl} onVerificationChange={onVerificationChange} />}
    <p className="ad-muted">將這張卡放進 {current?.name || "這位參加者"} 的卡套。驗證成功後，再按下一位。</p>
    <div className="ad-dialog-actions"><button type="button" className="ad-button ad-button-primary" disabled={!canAdvance} onClick={nextPerson}>{index + 1 === queue.ids.length ? "完成，結束本輪" : "完成，下一位"}</button></div>
  </section>;
}
