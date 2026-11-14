"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowRight, Check, ChevronLeft, Copy, DoorOpen, Lightbulb, Link2, LoaderCircle, Plus, RotateCcw, Share2, Sparkles, Star, Timer, TreePine, Users, Wifi, WifiOff } from "lucide-react";
import type { GameAction, GameResponse, GameRoomSnapshot } from "@/lib/game-contracts";
import "./coop-tree-game.css";

type Props = { token?: string; onWin?: () => void };
type ApiError = Error & { code?: string; status?: number };
type LampStyle = CSSProperties & { "--lamp-color": string; "--lamp-delay": string };

const LAMPS: readonly [number, number][] = [
  [45, 24], [56, 28],
  [35, 35], [48, 37], [64, 40],
  [29, 47], [42, 47], [57, 49], [70, 51],
  [23, 58], [35, 58], [47, 60], [60, 60], [75, 61],
  [17, 70], [29, 69], [41, 71], [53, 70], [66, 72], [81, 72],
  [29, 80], [43, 81], [57, 81], [72, 80],
];

function roomKey(token: string) { return `tzai-tree-room:${token || "guest"}`; }
function normalizeCode(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); }

export default function CoopTreeGame({ token = "", onWin }: Props) {
  return <CoopGameSession key={token || "guest"} token={token} onWin={onWin}/>;
}

function CoopGameSession({ token, onWin }: { token: string; onWin?: () => void }) {
  const [room, setRoom] = useState<GameRoomSnapshot | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(true);
  const [notice, setNotice] = useState("");
  const [shareFallback, setShareFallback] = useState(false);
  const [guide, setGuide] = useState(false);
  const [now, setNow] = useState(0);
  const [spark, setSpark] = useState(0);
  const mounted = useRef(false);
  const roomRef = useRef<GameRoomSnapshot | null>(null);
  const busyRef = useRef(false);
  const polling = useRef(false);
  const generation = useRef(0);
  const offset = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const winCallback = useRef(onWin);
  const reportedWin = useRef("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollController = useRef<AbortController | null>(null);

  useEffect(() => { winCallback.current = onWin; }, [onWin]);

  const acceptRoom = useCallback((next: GameRoomSnapshot) => {
    if (!mounted.current) return;
    const previous = roomRef.current;
    if (previous?.code === next.code && next.revision < previous.revision) return;
    offset.current = next.serverNow - Date.now();
    setNow(next.serverNow);
    if (previous?.code === next.code && next.lit.length > previous.lit.length) setSpark(next.revision);
    roomRef.current = next;
    setRoom(next);
    setCode(next.code);
    setConnected(true);
    try { if (next.meId) sessionStorage.setItem(roomKey(token), next.code); } catch {}
    const win = `${next.code}:${next.round}`;
    if (next.status === "won" && reportedWin.current !== win) { reportedWin.current = win; winCallback.current?.(); }
  }, [token]);

  const getRoom = useCallback(async (roomCode: string, restore = false) => {
    if (polling.current || busyRef.current || !mounted.current) return;
    polling.current = true;
    const epoch = generation.current;
    const controller = new AbortController();
    pollController.current = controller; controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`/api/game?room=${encodeURIComponent(roomCode)}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json() as GameResponse & { error?: string; code?: string };
      if (!mounted.current || generation.current !== epoch) return;
      if (!response.ok) {
        if (["join_required", "room_not_found", "room_expired"].includes(body.code || "")) {
          roomRef.current = null; setRoom(null); setCode(roomCode); setShareFallback(false);
          try { sessionStorage.removeItem(roomKey(token)); } catch {}
        }
        throw Object.assign(new Error(body.error || "暫時無法連上房間。"), { code: body.code, status: response.status });
      }
      acceptRoom(body.room); setError("");
    } catch (cause) {
      if (!mounted.current || generation.current !== epoch) return;
      const failure = cause as ApiError;
      setConnected(false);
      setError(failure.name === "AbortError" ? "連線有點慢，按「重新連線」試試。" : failure.message || "連線中斷，請再試一次。");
    } finally {
      clearTimeout(timeout); controllers.current.delete(controller);
      if (pollController.current === controller) pollController.current = null;
      polling.current = false;
      if (mounted.current && restore) setRestoring(false);
    }
  }, [acceptRoom, token]);

  useEffect(() => {
    mounted.current = true;
    const ownedControllers = controllers.current;
    const start = setTimeout(() => {
      const invited = normalizeCode(new URLSearchParams(location.search).get("room") || "");
      let remembered = "";
      try { remembered = normalizeCode(sessionStorage.getItem(roomKey(token)) || ""); } catch {}
      if (invited.length === 6 && invited !== remembered) { setCode(invited); setNotice("朋友替你留了一盞燈，加入就能一起玩。"); setRestoring(false); return; }
      if (remembered.length === 6) { setCode(remembered); void getRoom(remembered, true); }
      else { if (invited) setCode(invited); setRestoring(false); }
    }, 0);
    return () => {
      mounted.current = false; generation.current += 1; clearTimeout(start);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      for (const controller of ownedControllers) controller.abort(); ownedControllers.clear();
    };
  }, [getRoom, token]);

  useEffect(() => {
    if (!room?.code || !room.meId) return;
    const roomCode = room.code;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try { if (document.visibilityState === "visible") await getRoom(roomCode); }
      finally { inFlight = false; if (!cancelled) timer = setTimeout(poll, 1800); }
    };
    const visible = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); void poll(); } };
    timer = setTimeout(poll, 1800);
    document.addEventListener("visibilitychange", visible);
    return () => { cancelled = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [room?.code, room?.meId, getRoom]);

  useEffect(() => {
    if (room?.status !== "playing") return;
    const interval = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => clearInterval(interval);
  }, [room?.status]);

  const send = useCallback(async (action: GameAction) => {
    if (busyRef.current) return;
    busyRef.current = true; generation.current += 1;
    const epoch = generation.current;
    pollController.current?.abort();
    setBusy(action.action); setError(""); setNotice("");
    const controller = new AbortController(); controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/api/game", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action), signal: controller.signal });
      const body = await response.json() as GameResponse & { error?: string; code?: string };
      if (!mounted.current || generation.current !== epoch) return;
      if (!response.ok) throw Object.assign(new Error(body.error || "剛剛沒有成功，再試一次。"), { code: body.code, status: response.status });
      if (action.action === "leave") {
        roomRef.current = null; setRoom(null); setShareFallback(false); setCode("");
        try { sessionStorage.removeItem(roomKey(token)); } catch {}
        setNotice("把這次相遇收好，下次再一起點燈。");
      } else { acceptRoom(body.room); setShareFallback(false); }
      setConnected(true); setGuide(false);
    } catch (cause) {
      if (!mounted.current || generation.current !== epoch) return;
      const failure = cause as ApiError;
      setError(failure.name === "AbortError" ? "還沒收到回應，請重新連線確認結果。" : failure.message || "暫時無法連線，請再試一次。");
      if (failure.name === "AbortError" || !failure.status || failure.status >= 500) setConnected(false);
      if (["room_expired", "room_not_found"].includes(failure.code || "")) { roomRef.current = null; setRoom(null); try { sessionStorage.removeItem(roomKey(token)); } catch {} }
    } finally {
      clearTimeout(timeout); controllers.current.delete(controller); busyRef.current = false;
      if (mounted.current) setBusy("");
    }
  }, [acceptRoom, token]);

  async function copy(kind: "code" | "link") {
    if (!room) return;
    const text = kind === "code" ? room.code : `${location.origin}/?room=${room.code}`;
    try { await navigator.clipboard.writeText(text); setNotice(kind === "code" ? "房間碼已複製，傳給朋友吧。" : "邀請連結已複製，傳給朋友吧。"); }
    catch { setShareFallback(true); setNotice("長按下方連結，就可以複製分享。"); }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => { if (mounted.current) setNotice(""); }, 4500);
  }

  const meIndex = room?.members.findIndex(member => member.id === room.meId) ?? -1;
  const me = room && meIndex >= 0 ? room.members[meIndex] : null;
  const ownBulbs = room && meIndex >= 0 ? Array.from({ length: room.total }, (_, i) => i).filter(i => i % room.members.length === meIndex) : [];
  const nextBulb = ownBulbs.find(i => !room?.lit.includes(i));
  const ownLit = ownBulbs.filter(i => room?.lit.includes(i)).length;
  const seconds = room?.endsAt ? Math.max(0, Math.ceil((room.endsAt - now) / 1000)) : 60;
  const canLight = room?.status === "playing" && nextBulb !== undefined && seconds > 0 && !busy;
  const isHost = !!room && room.meId === room.hostId;
  const finished = room?.status === "won" || room?.status === "lost";
  const inviteLink = room && typeof location !== "undefined" ? `${location.origin}/?room=${room.code}` : "";

  function light() { if (canLight && room && nextBulb !== undefined) void send({ action: "light", code: room.code, bulb: nextBulb }); }
  function join(event: FormEvent) { event.preventDefault(); if (code.length === 6) void send({ action: "join", code, ...(token ? { token } : {}) }); }

  return <section className={`ctg ${room ? `ctg-${room.status}` : "ctg-entry"}`} aria-label="一起點亮耶誕樹">
    <header className="ctg-heading">
      <div className="ctg-topline"><span>{room ? "A LITTLE LIGHT FROM EACH OF US" : "BETTER TOGETHER"}</span><button className="ctg-help" onClick={() => setGuide(v => !v)} aria-label={guide ? "關閉遊戲說明" : "查看遊戲說明"}>{guide ? <ChevronLeft size={17}/> : "玩法"}</button></div>
      <h1>{guide ? "把一點光，交給彼此。" : room?.status === "won" ? "我們，把耶誕點亮了！" : room?.status === "lost" ? "再一起試一次，好嗎？" : room?.status === "playing" ? "輪到你，送上一點光。" : room ? "等朋友，一起點亮。" : "一起點亮耶誕樹"}</h1>
      {room && !guide ? <div className="ctg-room-line"><button onClick={() => void copy("code")} aria-label={`複製房間碼 ${room.code}`}><span>房間</span><strong>{room.code}</strong><Copy size={13}/></button><span className={`ctg-connection ${connected ? "" : "ctg-offline"}`}>{connected ? <Wifi size={13}/> : <WifiOff size={13}/>}<span>{connected ? "同步中" : "等待連線"}</span></span></div> : !guide && <p>邀朋友加入同一房間，讓這棵樹亮起來。</p>}
    </header>

    <div className="ctg-middle">
      {guide ? <div className="ctg-guide"><div><Users/><h2>邀請 1～5 位朋友</h2><p>建立房間，傳送房間碼。大家到齊後，由房主開始。</p></div><div><Lightbulb/><h2>完成自己的點燈任務</h2><p>每個人有不同顏色。點樹或按下方按鈕，依序點亮自己的燈。</p></div><div><Star/><h2>60 秒，一起亮起 24 盞燈</h2><p>所有燈亮起就完成！從 NFC 小卡進來，還會留下點燈紀念。</p></div><button className="ctg-link" onClick={() => setGuide(false)}>我懂了，回到耶誕樹<ArrowRight size={16}/></button></div> : <>
        {room?.status === "playing" && <div className="ctg-round-bar"><span><Lightbulb size={14}/><b>{room.lit.length}</b> / {room.total}</span><span className={seconds <= 10 ? "ctg-time-low" : ""}><Timer size={14}/><b>{seconds}</b> 秒</span></div>}
        <div className="ctg-tree-space"><TreeScene room={room} nextBulb={nextBulb} canLight={!!canLight} onLight={light} spark={spark}/></div>
        {room?.status === "lobby" && <div className="ctg-member-list" aria-label="房間裡的朋友">{room.members.map(member => <span key={member.id} className={member.id === room.meId ? "ctg-member-me" : ""}><i style={{ background: member.color }}/>{member.id === room.meId ? "你" : member.label}{member.id === room.hostId && <small>房主</small>}</span>)}<span className="ctg-member-count"><Users size={12}/>{room.members.length} / 6</span></div>}
        {room?.status === "playing" && <div className="ctg-my-task"><i style={{ background: me?.color || "#e7b85e" }}/><span>{nextBulb === undefined ? "你的燈都亮了，等夥伴一起完成！" : <>你的光 <b>{ownLit} / {ownBulbs.length}</b>・每一盞都很重要</>}</span></div>}
        {finished && <div className="ctg-result-note"><span>{room.status === "won" ? <><Check size={17}/>24 盞燈，每一盞都有你。</> : <><Lightbulb size={16}/>{room.lit.length} / 24 盞，差一點就完成了。</>}</span><p>{room.status === "won" ? room.meCardSerial ? `紀念已留在 #${room.meCardSerial} 的耶誕小屋。` : "用你的 NFC 小卡進來，下次就能收藏點燈紀念。" : "一起分工，再把小小的光聚在一起。"}</p></div>}
        {!room && <p className="ctg-tree-caption"><Sparkles size={13}/>2～6 人合作 · 60 秒點燈挑戰</p>}
      </>}
    </div>

    <footer className="ctg-controls">
      {error && <div className="ctg-feedback ctg-error" role="alert"><span>{error}</span>{room && <button onClick={() => void getRoom(room.code)} disabled={!!busy}>重新連線</button>}</div>}
      {!error && notice && <p className="ctg-feedback" role="status">{notice}</p>}
      {shareFallback && room && <input className="ctg-share-input" aria-label="邀請連結，可長按複製" readOnly value={inviteLink} onFocus={event => event.currentTarget.select()}/>}
      {restoring ? <div className="ctg-restoring" role="status"><LoaderCircle size={17}/>正在找回你們的耶誕樹…</div> : !room ? <>
        <button className="ctg-primary" disabled={!!busy} onClick={() => void send({ action: "create", ...(token ? { token } : {}) })}>{busy === "create" ? <LoaderCircle className="ctg-spinner" size={18}/> : <Plus size={18}/>}建立好友房間<ArrowRight size={18}/></button>
        <form className="ctg-join-form" onSubmit={join}><label htmlFor="tree-room-code" className="ctg-sr-only">好友房間碼</label><input id="tree-room-code" aria-label="好友房間碼" autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" maxLength={6} placeholder="輸入 6 碼房間號" value={code} onChange={event => setCode(normalizeCode(event.target.value))}/><button type="submit" disabled={code.length !== 6 || !!busy}>{busy === "join" ? <LoaderCircle className="ctg-spinner" size={17}/> : "加入"}<ArrowRight size={15}/></button></form>
      </> : room.status === "lobby" ? <>
        {isHost ? <button className="ctg-primary" disabled={room.members.length < 2 || !!busy} onClick={() => void send({ action: "start", code: room.code })}>{busy === "start" ? <LoaderCircle className="ctg-spinner" size={18}/> : <Lightbulb size={18}/>} {room.members.length < 2 ? "等一位朋友，就能開始" : `一起開始點燈 · ${room.members.length} 人`}<ArrowRight size={18}/></button> : <div className="ctg-wait-host"><span/>等待房主開始，準備送出你的光。</div>}
        <div className="ctg-secondary-row"><button onClick={() => void copy("link")}><Share2 size={15}/>邀請朋友</button><button onClick={() => void send({ action: "leave", code: room.code })} disabled={!!busy}><DoorOpen size={15}/>離開房間</button></div>
      </> : room.status === "playing" ? <button className="ctg-primary ctg-light-button" onClick={light} disabled={!canLight} style={{ "--my-color": me?.color || "#d96050" } as CSSProperties}>{busy === "light" ? <LoaderCircle className="ctg-spinner" size={19}/> : nextBulb === undefined ? <Check size={19}/> : <Lightbulb size={19}/>} {seconds === 0 ? "正在確認這一輪結果…" : nextBulb === undefined ? "你的光已送達，幫夥伴加油！" : "點亮我的下一盞燈"}</button> : <>
        {isHost ? <button className="ctg-primary" disabled={!!busy} onClick={() => void send({ action: "restart", code: room.code })}><RotateCcw size={17}/>{busy === "restart" ? "準備下一輪…" : "再一起點亮一棵樹"}</button> : <div className="ctg-wait-host"><Star size={16}/>等房主邀你再玩一輪。</div>}
        <div className="ctg-secondary-row"><button onClick={() => void copy("link")}><Link2 size={15}/>分享房間</button><button onClick={() => void send({ action: "leave", code: room.code })} disabled={!!busy}><DoorOpen size={15}/>離開房間</button></div>
      </>}
    </footer>
  </section>;
}

function TreeScene({ room, nextBulb, canLight, onLight, spark }: { room: GameRoomSnapshot | null; nextBulb: number | undefined; canLight: boolean; onLight: () => void; spark: number }) {
  const [artFailed, setArtFailed] = useState(false);
  const won = room?.status === "won";
  return <div className={`ctg-tree ${won ? "ctg-tree-complete" : ""}`}>
    <span className="ctg-tree-aura" aria-hidden="true"/>
    {artFailed ? <TreePine className="ctg-tree-fallback" strokeWidth={.8} aria-hidden="true"/> : <img src="/assets/christmas-tree.webp" className="ctg-tree-art" alt="" onError={() => setArtFailed(true)}/>}
    <Star className="ctg-tree-star" size={25} fill="currentColor" aria-hidden="true"/>
    <div className="ctg-lamps" aria-hidden="true">{LAMPS.map(([left, top], index) => {
      const lit = room?.lit.includes(index) || !room && index % 4 === 0;
      const member = room?.members[index % room.members.length];
      const style: LampStyle = { left: `${left}%`, top: `${top}%`, "--lamp-color": member?.color || ["#e9bd65", "#d96050", "#83a9bc"][index % 3], "--lamp-delay": `${index * -.17}s` };
      return <i key={index} className={`${lit ? "is-lit" : ""} ${index === nextBulb && room?.status === "playing" ? "is-next" : ""}`} style={style}/>;
    })}</div>
    {canLight && <button className="ctg-tree-hit" onClick={onLight} aria-label="點亮耶誕樹上的我的燈"/>}
    {spark > 0 && <div className="ctg-tree-spark" key={spark} aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <i key={i} style={{ "--spark-angle": `${i * 45}deg`, "--spark-distance": `${40 + i % 3 * 10}px` } as CSSProperties}>✦</i>)}</div>}
    {won && <div className="ctg-celebration" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ left: `${(i * 17 + 9) % 100}%`, animationDelay: `${i * -.31}s`, color: ["#f1ce82", "#d87861", "#a6c5a1"][i % 3] }}>✧</i>)}</div>}
  </div>;
}
