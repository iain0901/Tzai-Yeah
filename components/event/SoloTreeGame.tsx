"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Crown, Leaf, LoaderCircle, Pencil, RotateCcw, Smartphone, Star, TreePine, Trophy, WifiOff } from "lucide-react";
import { formatTreeHeight, levelName, type TreeAction, type TreeLeaderboard, type TreePlayer, type TreeResponse } from "@/lib/tree-contracts";
import useTreeShake from "./useTreeShake";
import useTreeSound from "./useTreeSound";
import { GrowthQueue, type GrowthSnapshot } from "./tree-growth-queue";
import "./solo-tree-game.css";
import TreeStageArt from "./TreeStageArt";

type SessionState = { player: TreePlayer | null; loading: boolean; error: string; pending: number; saving: boolean; retry: boolean; notice: string };
const INITIAL: SessionState = { player: null, loading: true, error: "", pending: 0, saving: false, retry: false, notice: "" };
const sessions = new Map<string, TreeSession>();

async function treeRequest<T>(url: string, action?: TreeAction, signal?: AbortSignal): Promise<T> {
  const ownController = signal ? null : new AbortController();
  const timeout = ownController ? setTimeout(() => ownController.abort(), 12000) : null;
  try {
    const response = await fetch(url, action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action), keepalive: true, signal: signal || ownController?.signal } : { cache: "no-store", signal: signal || ownController?.signal });
    const data = await response.json() as T & { error?: string; code?: string };
    if (!response.ok) throw Object.assign(new Error(data.error || "小樹暫時連不上，請再試一次。"), { status: response.status, code: data.code });
    return data;
  } finally { if (timeout) clearTimeout(timeout); }
}
function failureText(error: unknown) { return error instanceof Error && error.name !== "AbortError" ? error.message : "連線有點慢，小樹的成長還在等待儲存。"; }
function isCardIdentityError(error: unknown) { return ["card_not_found", "card_inactive", "card_required"].includes((error as { code?: string } | null)?.code || ""); }

// Web Locks serialize the canonical cross-tab queue, while requests keep their
// idempotency IDs outside the lock. Without Web Locks, pending work is tab-local.
class TreeSession {
  state: SessionState = { ...INITIAL };
  readonly token: string;
  private snapshot: GrowthSnapshot | null = null;
  private growthQueue: GrowthQueue | null = null;
  private identityReady = false;
  private listeners = new Set<(state: SessionState) => void>();
  private inFlight: Promise<void> | null = null;
  private loadFlight: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private lastInput = 0;
  private readonly storageKey: string;

  constructor(token: string) {
    this.token = token;
    this.storageKey = `tzai-tree-growth:${token || "guest"}`;
    const flushOnLeave = () => { void this.flush(); };
    window.addEventListener("pagehide", flushOnLeave);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushOnLeave(); });
    window.addEventListener("online", flushOnLeave);
    window.addEventListener("storage", event => {
      if (event.key !== this.storageKey || !this.growthQueue) return;
      const queue = this.growthQueue;
      void queue.refresh().then(snapshot => {
        if (queue !== this.growthQueue) return;
        const wasBatch = !!this.snapshot?.batch;
        this.updateSnapshot(snapshot);
        if (wasBatch && !snapshot.batch) void this.load();
        else if (this.state.pending && !this.flushTimer && !this.inFlight) this.schedule(1000);
      }).catch(() => this.publish({ error: "暫時讀不到待儲存的星光，請重新連線。", retry: true }));
    });
  }
  subscribe(listener: (state: SessionState) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(patch: Partial<SessionState> = {}) {
    this.state = { ...this.state, ...patch, pending: (this.snapshot?.waiting || 0) + (this.snapshot?.batch?.count || 0) };
    for (const listener of this.listeners) listener(this.state);
  }
  accept(player: TreePlayer | null) {
    if (!player) { if (!this.state.player) this.publish({ player: null }); return; }
    if (this.state.player?.id === player.id && player.revision < this.state.player.revision) return;
    if (this.state.player && this.state.player.id !== player.id) { this.snapshot = null; this.growthQueue = null; }
    this.publish({ player });
  }
  private updateSnapshot(snapshot: GrowthSnapshot) {
    if (snapshot.playerId !== this.state.player?.id) return;
    this.snapshot = snapshot;
    this.publish(!snapshot.waiting && !snapshot.batch && this.state.retry ? { retry: false, error: "" } : {});
  }
  private configureQueue() {
    if (this.growthQueue || !this.state.player) return;
    let tail = Promise.resolve();
    const serial = <T,>(work: () => T | Promise<T>): Promise<T> => {
      const next = tail.then(work, work); tail = next.then(() => undefined, () => undefined); return next;
    };
    const hasLocks = !!navigator.locks?.request;
    const lockName = `${this.storageKey}:${this.state.player.id}`;
    const transaction = async <T,>(work: () => T | Promise<T>): Promise<T> => hasLocks ? await navigator.locks.request(lockName, async () => await work()) : await serial(work);
    const storage = hasLocks ? localStorage : sessionStorage;
    this.growthQueue = new GrowthQueue(this.storageKey, this.state.player.id, storage, transaction, () => crypto.randomUUID());
  }
  private async refreshQueue() {
    this.configureQueue(); const queue = this.growthQueue;
    if (queue) { const snapshot = await queue.refresh(); if (queue === this.growthQueue) this.updateSnapshot(snapshot); }
  }
  private async clearOwner() {
    const oldQueue = this.growthQueue;
    this.snapshot = null; this.growthQueue = null; this.identityReady = false;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.publish({ player: null, retry: false, saving: false, error: "", notice: "" });
    if (oldQueue) await oldQueue.clear();
  }
  private suspendCard(error: unknown) {
    // Keep unacknowledged growth in storage for a later reactivation, but never
    // enqueue or retry against a card that the server has rejected.
    this.snapshot = null; this.growthQueue = null; this.identityReady = false;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.publish({ player: null, loading: false, retry: false, saving: false, error: failureText(error), notice: "" });
  }
  private schedule(delay: number) {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, delay);
  }
  async load() {
    if (this.loadFlight) return this.loadFlight;
    this.publish({ loading: !this.state.player, error: this.state.retry ? this.state.error : "" });
    this.loadFlight = (async () => {
      try {
        const result = await treeRequest<TreeResponse>(`/api/tree${this.token ? `?token=${encodeURIComponent(this.token)}` : ""}`);
        if (!result.player) await this.clearOwner(); else this.accept(result.player);
        this.identityReady = true;
        await this.refreshQueue(); this.publish({ loading: false, error: this.state.retry ? this.state.error : "" });
        if (this.state.player && this.state.pending) void this.flush();
      } catch (error) { if (isCardIdentityError(error)) this.suspendCard(error); else this.publish({ loading: false, error: failureText(error) }); }
      finally { this.loadFlight = null; }
    })();
    return this.loadFlight;
  }
  async name(action: "register" | "rename", name: string) {
    if (!this.identityReady) throw new Error("請先重新連線，找到你的小樹後再繼續。");
    let result: TreeResponse;
    try { result = await treeRequest<TreeResponse>("/api/tree", { action, name, ...(this.token ? { token: this.token } : {}) }); }
    catch (error) { if (isCardIdentityError(error)) this.suspendCard(error); throw error; }
    this.accept(result.player); await this.refreshQueue(); this.publish({ error: "", loading: false, notice: action === "register" ? "小樹種好了，第一點星光就交給你。" : "新的名字，已經掛上小樹了。" });
    return result.player;
  }
  async queue(): Promise<boolean> {
    if (!this.identityReady || !this.state.player || this.state.loading) return false;
    const now = Date.now();
    if (now - this.lastInput < 360) return false;
    this.lastInput = now;
    try {
      this.configureQueue(); const queue = this.growthQueue; if (!queue) return false;
      const result = await queue.enqueue(); if (queue !== this.growthQueue) return false;
      this.updateSnapshot(result.snapshot);
      if (!result.accepted) { this.publish({ notice: "先把這些星光存好，再繼續搖搖吧。" }); return false; }
      this.publish({ notice: "" });
      if (!this.flushTimer && !this.inFlight) this.schedule(1000);
      return true;
    } catch { this.publish({ error: "這個分頁暫時無法保存待送的星光，請重新整理再試。" }); return false; }
  }
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!this.state.player || !this.growthQueue) return Promise.resolve();
    const queue = this.growthQueue;
    this.inFlight = (async () => {
      let ok = false; let delay = 1000;
      try {
        const take = await queue.take();
        if (queue !== this.growthQueue) return;
        this.updateSnapshot(take.snapshot);
        const batch = take.batch;
        if (!batch) { ok = true; delay = Math.max(100, take.waitMs); return; }
        this.publish({ saving: true });
        const result = await treeRequest<TreeResponse>("/api/tree", { action: "grow", ...batch, ...(this.token ? { token: this.token } : {}) });
        if (queue !== this.growthQueue) return;
        this.accept(result.player);
        const acknowledged = await queue.acknowledge(batch.requestId);
        if (queue !== this.growthQueue) return;
        this.updateSnapshot(acknowledged); this.retryCount = 0; ok = true;
        this.publish({ saving: false, retry: false, error: "", notice: typeof result.awarded === "number" && result.awarded < batch.count ? `這次存入 ${result.awarded} 點星光，慢慢搖，小樹才跟得上。` : "" });
      } catch (error) {
        if (queue !== this.growthQueue) return;
        if (isCardIdentityError(error)) { this.suspendCard(error); return; }
        this.retryCount += 1; this.publish({ saving: false, retry: true, error: failureText(error) });
        if ((error as { code?: string }).code === "tree_not_registered") { await this.clearOwner(); void this.load(); }
      } finally {
        this.inFlight = null;
        if (this.state.pending) this.schedule(ok ? delay : Math.min(15000, 1500 * 2 ** Math.min(this.retryCount, 3)));
      }
    })();
    return this.inFlight;
  }
}

function useTreeSession(token: string) {
  const [state, setState] = useState<SessionState>({ ...INITIAL });
  const session = useRef<TreeSession | null>(null);
  useEffect(() => {
    let active = true; let unsubscribe = () => {};
    const start = setTimeout(() => {
      let current = sessions.get(token || "guest");
      if (!current) { current = new TreeSession(token); sessions.set(token || "guest", current); }
      session.current = current;
      unsubscribe = current.subscribe(next => { if (active) setState(next); });
      setState(current.state); void current.load();
    }, 0);
    return () => { active = false; clearTimeout(start); unsubscribe(); void session.current?.flush(); session.current = null; };
  }, [token]);
  return { state, session };
}

export default function SoloTreeGame({ token = "", onChange, active = true, animations = true }: { token?: string; onChange?: () => void; active?: boolean; animations?: boolean }) {
  return <SoloTreeSession key={token || "guest"} token={token} onChange={onChange} active={active} animations={animations}/>;
}

function SoloTreeSession({ token, onChange, active, animations }: { token: string; onChange?: () => void; active: boolean; animations: boolean }) {
  const { state, session } = useTreeSession(token);
  const [tab, setTab] = useState<"play" | "leaderboard">("play");
  const [name, setName] = useState(""); const [naming, setNaming] = useState(false); const [editing, setEditing] = useState(false); const [nameError, setNameError] = useState("");
  const [bounce, setBounce] = useState(0);
  const previousGrowth = useRef<number | null>(null); const callback = useRef(onChange);
  const player = state.player;
  const [soundOn, setSoundOn] = useState(false);
  const sound = useTreeSound();
  function grow() { void session.current?.queue().then(accepted => { if (accepted) { setBounce(n => n + 1); sound.chime(); } }); }
  function tapGrow() { sound.unlock(); grow(); }
  const motion = useTreeShake({ onShake: grow, enabled: active && !!player && tab === "play" && !editing });
  useEffect(() => { callback.current = onChange; }, [onChange]);
  useEffect(() => { if (!player) return; if (previousGrowth.current !== null && player.growth > previousGrowth.current) callback.current?.(); previousGrowth.current = player.growth; }, [player]);

  async function saveName(event: FormEvent) {
    event.preventDefault(); const trimmed = name.trim();
    if (Array.from(trimmed).length < 2 || Array.from(trimmed).length > 16) { setNameError("暱稱請填 2～16 個字。"); return; }
    if (naming || !session.current) return;
    setNaming(true); setNameError("");
    try { await session.current.name("rename", trimmed); setEditing(false); }
    catch (error) { setNameError(failureText(error)); }
    finally { setNaming(false); }
  }
  function editName() { if (player) setName(player.name); setNameError(""); setEditing(true); }
  // The scene stays fixed: only the illustration grows, leaving every control in place.
  const shape = player ? .46 + .5 * (1 - Math.exp(-player.growth / 85)) : .46;
  const thresholds = [0, 10, 30, 75, 150, 300];
  const stageStart = thresholds[(player?.level || 1) - 1];
  const nextStage = thresholds[player?.level || 1];
  const stageProgress = player ? nextStage ? (player.growth - stageStart) / (nextStage - stageStart) : 1 : 0;
  const motionLabel = motion.status === "listening" ? "搖動已開啟 · 暫停" : motion.status === "paused" ? "繼續搖搖手機" : motion.status === "denied" || motion.status === "unavailable" ? "再試一次搖動" : "開啟搖搖手機";
  const showForm = !player || editing;
  return <section className={`stg stg-view-${tab} ${showForm ? "stg-naming" : ""}`} aria-label="搖搖耶誕樹">
    <header className="stg-heading"><span>GROW A LITTLE CHRISTMAS</span><h1>搖搖耶誕樹</h1><p>{player ? "搖一搖，讓你的星光慢慢長大。" : "每張小卡，都有一棵專屬的小樹。"}</p></header>
    <nav className="stg-tabs" aria-label="耶誕樹遊戲分頁"><button className={tab === "play" ? "is-active" : ""} aria-current={tab === "play" ? "page" : undefined} onClick={() => setTab("play")}><TreePine size={17}/>遊玩</button><button className={tab === "leaderboard" ? "is-active" : ""} aria-current={tab === "leaderboard" ? "page" : undefined} onClick={() => { void session.current?.flush(); setEditing(false); setTab("leaderboard"); }}><Trophy size={17}/>排行榜</button></nav>
    {tab === "leaderboard" ? <TreeRanking token={token} player={player} onPlayer={next => session.current?.accept(next)} onPlay={() => setTab("play")}/> : <div className={`stg-play ${showForm ? "stg-play-form" : ""}`}>
      {!showForm && player && <div className="stg-player-heading"><button className="stg-name" onClick={editName} aria-label={`編輯暱稱，目前是${player.name}`}><span>{player.name}</span>{player.name !== `#${player.cardSerial}` && <small>#{player.cardSerial}</small>}<Pencil size={13}/></button><div className="stg-stats"><span><AnimatedHeight height={player.heightCm}/><small>小樹高度</small></span><span><strong className="stg-stat-change" key={`rank-${player.rank}`}>#{player.rank}</strong><small>目前排名</small></span><span><strong className="stg-stat-change" key={`level-${player.level}`}>{levelName(player.level)}</strong><small>第 {player.level} 階段</small></span></div><div className="stg-growth-meter" aria-label={nextStage ? `距離下一階段還有 ${nextStage - player.growth} 點星光` : "星光巨樹持續長高"}><div className="stg-growth-track" aria-hidden="true"><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, stageProgress))})` }}/></div><span>{nextStage ? `再 ${nextStage - player.growth} 點星光，迎接${levelName(player.level + 1)}` : "星光正盛，還能繼續長高。"}</span></div></div>}
      <div className={`stg-tree-space ${motion.status === "listening" ? "is-listening" : ""}`} style={{ "--tree-scale": shape, "--burst-y": `${92 - shape * 44}%` } as CSSProperties} data-growth-stage={player?.level || 0}><div className="stg-scene-halo" aria-hidden="true"/><div className="stg-scene-orbit" aria-hidden="true"/><div className="stg-tree-sizer"><button className="stg-tree" onClick={tapGrow} disabled={!player || editing || state.loading} aria-label={player ? "為我的耶誕樹收集星光" : "等待種下的小小耶誕樹"}><span className="stg-tree-growth"><span className="stg-aura" aria-hidden="true"/><span className="stg-tree-inner"><TreeStageArt level={player?.level || 1} pulse={bounce} animations={animations}/></span><span className="stg-tree-stars" aria-hidden="true">{[0,1,2,3,4,5].map(i => <i key={i} style={{ "--i": i } as CSSProperties}>✧</i>)}</span></span></button></div><span className="stg-ground" aria-hidden="true"/>{bounce > 0 && <div key={`spark-${bounce}`} className="stg-growth-burst" aria-hidden="true"><span className="stg-growth-ring"/>{[[-38,-42],[-18,-62],[14,-65],[40,-42],[-46,-9],[46,-8],[-25,12],[25,16]].map(([x,y], i) => <i key={i} style={{ "--burst-x": `${x}px`, "--burst-rise": `${y}px`, "--particle-delay": `${i * 17}ms` } as CSSProperties}>{i % 3 ? "·" : "✧"}</i>)}<b>+1</b></div>}</div>
      <div className="stg-play-controls">
        {state.loading ? <div className="stg-loading" role="status"><LoaderCircle size={17}/>正在找到你的小樹…</div> : !player ? <div className="stg-card-entry"><h2>{token ? "小樹正在等你。" : "你的小樹，住在小卡裡。"}</h2><p>{token ? "連線後，就能接著照顧自己的小樹。" : <>從你的專屬小卡連結進來，<br/>每一點星光都會為你留下。</>}</p>{state.error && <p className="stg-error" role="alert">{state.error}</p>}{token && <button className="stg-board-retry" onClick={() => void session.current?.load()}><RotateCcw size={15}/>重新找到我的小樹</button>}</div> : editing ? <form className="stg-name-form" onSubmit={saveName}><label htmlFor="solo-tree-name">{editing ? "替小樹換個暱稱" : "你想讓大家怎麼稱呼你？"}<small>{Array.from(name).length} / 16</small></label><div className="stg-name-input"><input id="solo-tree-name" value={name} onChange={event => setName(Array.from(event.target.value).slice(0,16).join(""))} autoComplete="nickname" placeholder="輸入 2～16 字暱稱" maxLength={32} disabled={naming}/>{editing && <button type="button" className="stg-cancel" onClick={() => setEditing(false)} disabled={naming}>取消</button>}</div>{(nameError || state.error) && <p className="stg-error" role="alert">{nameError || state.error}{state.error && !nameError && <button type="button" onClick={() => void session.current?.load()}>重試</button>}</p>}<button className="stg-primary" type="submit" disabled={naming || (!player && !!state.error) || Array.from(name.trim()).length < 2}>{naming ? <LoaderCircle className="stg-spinner" size={17}/> : <Leaf size={17}/>} {editing ? "儲存暱稱" : "種下我的耶誕樹"}<ArrowRight size={17}/></button><p className="stg-name-note">小卡編號不變，暱稱可以隨時修改。</p></form> : <>
          <div className={`stg-save-state ${state.retry ? "has-error" : ""}`} role="status">{state.retry ? <WifiOff size={12}/> : state.pending ? <LoaderCircle className="stg-spinner" size={12}/> : <Check size={12}/>}<span>{state.retry ? `${state.pending} 點星光等待重試` : state.pending ? `${state.pending} 點星光・${state.saving ? "儲存中" : "等待儲存"}` : "成長已儲存，下次回來繼續長大"}</span>{state.retry && <button onClick={() => void session.current?.flush()}>重試</button>}</div>
          {state.error && <p className="stg-error" role="alert">{state.error}</p>}
          <div className="stg-grow-actions"><button className={`stg-primary stg-shake-action ${motion.status === "listening" ? "is-listening" : ""}`} aria-pressed={motion.status === "listening"} onClick={() => { if (motion.status === "listening") motion.stop(); else { void motion.start(); sound.unlock(); } }}><span className="stg-phone-icon"><Smartphone size={21}/><i aria-hidden="true"/></span><span>{motionLabel}</span><span className="stg-shake-rhythm" aria-hidden="true"><i/><i/><i/><i/></span></button></div>
          <div className="stg-mobile-controls"><button type="button" onClick={tapGrow}>點一下收集星光</button><button type="button" aria-pressed={soundOn} onClick={() => { sound.toggle(!soundOn); setSoundOn(!soundOn); }}>遊戲音效：{soundOn ? "開" : "關"}</button></div>
          <p className="stg-motion-note" role="status">{(motion.status !== "idle" ? motion.message : state.notice || motion.message) || "輕輕左右搖動，讓星光慢慢長大。"}</p>
        </>}
      </div>
    </div>}
  </section>;
}

function AnimatedHeight({ height }: { height: number }) {
  const [shown, setShown] = useState(height);
  const current = useRef(height);
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    const from = current.current;
    if (from === height) return;
    let frame = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || !!element.current?.closest(".motion-paused");
    const began = performance.now();
    const animate = (now: number) => {
      const progress = reduced ? 1 : Math.min(1, (now - began) / 650);
      const value = Math.round(from + (height - from) * (1 - Math.pow(1 - progress, 3)));
      current.current = value; setShown(value);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [height]);
  return <strong ref={element} className="stg-height-value" aria-label={formatTreeHeight(height)}><span aria-hidden="true">{formatTreeHeight(shown)}</span></strong>;
}

function TreeRanking({ token, player, onPlayer, onPlay }: { token: string; player: TreePlayer | null; onPlayer: (player: TreePlayer | null) => void; onPlay: () => void }) {
  const [page, setPage] = useState(1); const [board, setBoard] = useState<TreeLeaderboard | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  const callback = useRef(onPlayer);
  useEffect(() => { callback.current = onPlayer; }, [onPlayer]);
  useEffect(() => {
    let active = true, inFlight = false; let timer: ReturnType<typeof setTimeout> | null = null; let controller: AbortController | null = null;
    const schedule = () => { timer = setTimeout(() => { if (document.visibilityState === "visible") void load(); else schedule(); }, 5000); };
    const load = async () => {
      if (!active || inFlight) return;
      inFlight = true; controller = new AbortController(); const timeout = setTimeout(() => controller?.abort(), 12000);
      try {
        const next = await treeRequest<TreeLeaderboard>(`/api/tree/leaderboard?${new URLSearchParams({ page: String(page), ...(token ? { token } : {}) })}`, undefined, controller.signal);
        if (!active) return; setBoard(next); setError(""); callback.current(next.player);
      } catch (cause) { if (active) setError(failureText(cause)); }
      finally { clearTimeout(timeout); inFlight = false; if (active) { setLoading(false); schedule(); } }
    };
    const begin = setTimeout(() => { setLoading(true); void load(); }, 0);
    const visible = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); void load(); } };
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; clearTimeout(begin); if (timer) clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visible); };
  }, [page, retry, token]);
  const totalPages = Math.max(1, Math.ceil((board?.total || 0) / 5));
  const own = board?.player || player;
  return <div className="stg-ranking"><div className="stg-ranking-intro"><span><Trophy size={14}/>誰的小樹，最靠近星星？</span><small>{board ? `${board.total} 棵小樹一起長大` : "正在看看大家的小樹"}</small></div>
    {error ? <div className="stg-board-empty"><WifiOff size={28}/><p>{error}</p><button className="stg-board-retry" onClick={() => setRetry(n => n + 1)}><RotateCcw size={15}/>重新讀取</button></div> : loading && !board ? <div className="stg-board-empty" role="status"><LoaderCircle className="stg-spinner" size={26}/><p>星光排行榜載入中…</p></div> : board?.entries.length ? <ol className="stg-ranking-list" start={(page - 1) * 5 + 1}>{board.entries.map(entry => <li key={entry.id} className={`${entry.rank <= 3 ? `stg-top-${entry.rank}` : ""} ${entry.id === own?.id ? "stg-own-row" : ""}`}><span className="stg-rank-place">{entry.rank <= 3 ? <Crown size={19}/> : <span>{entry.rank}</span>}{entry.rank <= 3 && <small>{entry.rank}</small>}</span><span className="stg-rank-name"><strong>{entry.name}</strong><small>{entry.id === own?.id ? "你的小樹・" : ""}#{entry.cardSerial} · {levelName(entry.level)}</small></span><span className="stg-rank-height">{formatTreeHeight(entry.heightCm)}<img className="stg-rank-tree" src={`/assets/tree-stages/tree-stage-${entry.level}.webp`} alt="" width={27} height={37}/></span></li>)}</ol> : <div className="stg-board-empty"><TreePine size={38}/><h2>第一棵小樹，會是你嗎？</h2><p>帶著你的小卡，開始收集星光。</p><button className="stg-board-retry" onClick={onPlay}>去種小樹<ArrowRight size={15}/></button></div>}
    <div className="stg-rank-bottom">{own ? <div className="stg-my-rank"><span><Star size={13}/>我的小樹</span><strong>第 {board?.myRank || own.rank} 名</strong><span>{formatTreeHeight(own.heightCm)}</span></div> : <button className="stg-join-ranking" onClick={onPlay}>回到我的小樹<ArrowRight size={15}/></button>}<div className="stg-rank-pages"><button aria-label="排行榜上一頁" disabled={page <= 1 || loading} onClick={() => { setPage(p => p - 1); setLoading(true); }}><ChevronLeft size={19}/></button><span>{page} / {totalPages}</span><button aria-label="排行榜下一頁" disabled={page >= totalPages || loading} onClick={() => { setPage(p => p + 1); setLoading(true); }}><ChevronRight size={19}/></button></div></div>
  </div>;
}
