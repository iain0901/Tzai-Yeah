"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, Heart, House, Mail, MapPin, Menu, Music2, Pause, Play, Puzzle, RotateCcw, Ticket, Trees, Volume2, VolumeX } from "lucide-react";
import type { EventConfig, EventPhase, PublicEventData } from "@/lib/contracts";
import { DEFAULT_EVENT } from "@/lib/event-defaults";
import Modal from "./Modal";
import ProfileEditor from "./ProfileEditor";
import AnimatedWorld from "./AnimatedWorld";
import PersonalHouse from "./PersonalHouse";
import SoloTreeGame from "./SoloTreeGame";
import useChristmasMusic from "./useChristmasMusic";
import "./app-experience.css";

type Screen = "home" | "info" | "pass" | "game";
type Reading = { title: string; text: string };
function demoData(phase: EventPhase): PublicEventData {
  return { event: { ...DEFAULT_EVENT, phase, revealOpen: true, publishedVersion: 1 }, card: { serial: "027", active: true, bound: true, claimed: false, group: phase === "live" ? { id: "demo", name: "暖心薑餅組", location: "教育館・第六組區域", note: "帶著你的小卡，和新朋友打聲招呼。", color: "#c64b44" } : null, profile: { displayName: "", bio: "", url: "", mode: "page" } } };
}
function youtubeId(url: string): string | null {
  try { const u = new URL(url); const host = u.hostname.toLowerCase().replace(/^www\./, ""); let id = ""; if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0]; else if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) id = u.searchParams.get("v") || u.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1] || ""; return /^[\w-]{11}$/.test(id) ? id : null; } catch { return null; }
}
function displayDate(date: string) { const d = new Date(`${date}T12:00:00Z`); return Number.isNaN(d.getTime()) ? date : `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日・星期${["日", "一", "二", "三", "四", "五", "六"][d.getUTCDay()]}`; }
function calendarLink(event: EventConfig) { const compact = (time: string) => event.date.replaceAll("-", "") + "T" + time.replace(":", "") + "00"; return `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: "TEMPLATE", text: event.title, dates: `${compact(event.doors)}/${compact(event.end)}`, ctz: "Asia/Taipei", location: event.venue, details: `${event.subtitle}\n${event.doors} 入場，${event.start} 活動開始。` })}`; }
function Lights({ dancing }: { dancing: boolean }) { return <div className={`app-lights ${dancing ? "lights-dancing" : ""}`} aria-hidden="true"><svg viewBox="0 0 400 65" preserveAspectRatio="none"><path d="M-10 0 Q95 75 200 18 Q305 75 410 0" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>{[5, 17, 30, 43, 57, 70, 83, 95].map((left, i) => <i key={left} style={{ left: `${left}%`, top: `${[16, 36, 38, 26, 26, 38, 36, 16][i]}px`, animationDelay: `${i * .28}s` }}/>)}</div>; }

export default function EventExperience({ token = "", demo }: { token?: string; demo?: EventPhase }) {
  return <EventApp key={`${token}:${demo || "real"}`} token={token} demo={demo}/>;
}
function EventApp({ token, demo }: { token: string; demo?: EventPhase }) {
  const [data, setData] = useState<PublicEventData | null>(demo ? demoData(demo) : null);
  const [loading, setLoading] = useState(!demo); const [error, setError] = useState("");
  const [screen, setScreen] = useState<Screen>(demo === "live" ? "pass" : "home");
  const [menu, setMenu] = useState(false); const [intro, setIntro] = useState(false); const [video, setVideo] = useState(false); const [edit, setEdit] = useState(false);
  const [reading, setReading] = useState<Reading | null>(null);
  const [redirectStopped, setRedirectStopped] = useState(false); const [redirectPending, setRedirectPending] = useState(false);
  const [sound, setSound] = useState(false); const [motion, setMotion] = useState(true); const [lightParty, setLightParty] = useState(false);
  const [feedback, setFeedback] = useState("點點愛心，看看會發生什麼"); const [messageIndex, setMessageIndex] = useState(0);
  const [revealed, setRevealed] = useState(false); const [revealAnimating, setRevealAnimating] = useState(false); const [photoIndex, setPhotoIndex] = useState(0);
  const music = useChristmasMusic(video);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const request = useRef<AbortController | null>(null); const previousPhase = useRef<EventPhase | null>(null);
  const event = data?.event || DEFAULT_EVENT; const card = data?.card; const videoId = youtubeId(event.videoUrl);
  const finishReveal = useCallback(() => { if (revealTimer.current) clearTimeout(revealTimer.current); setRevealed(true); setRevealAnimating(false); try { localStorage.setItem(`tzai-revealed-${token || "demo"}-${event.publishedVersion}`, "1"); } catch {} }, [token, event.publishedVersion]);
  const closeIntro = useCallback(() => setIntro(false), []); const closeVideo = useCallback(() => setVideo(false), []); const closeEdit = useCallback(() => setEdit(false), []); const closeMenu = useCallback(() => setMenu(false), []); const closeReading = useCallback(() => setReading(null), []);
  const openIntro = useCallback(() => setIntro(true), []);
  const reload = useCallback(async () => {
    if (demo) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(""); const timeout = setTimeout(() => controller.abort(), 12000);
    try { const response = await fetch(`/api/event${token ? `?token=${encodeURIComponent(token)}` : ""}`, { cache: "no-store", signal: controller.signal }); const body = await response.json() as PublicEventData & { error?: string }; if (request.current !== controller) return; if (!response.ok) { if ([403,404,410].includes(response.status)) setData(null); throw new Error(body.error || "暫時無法讀取小卡"); } setData(body); }
    catch (e) { if (request.current === controller) setError(e instanceof Error && e.name !== "AbortError" ? e.message : "連線有點慢，請再試一次。"); } finally { clearTimeout(timeout); if (request.current === controller) setLoading(false); }
  }, [token, demo]);
  useEffect(() => { const start = setTimeout(() => void reload(), 0); return () => { clearTimeout(start); request.current?.abort(); request.current = null; }; }, [reload]);
  useEffect(() => { const onVisible = () => { if (document.visibilityState === "visible") void reload(); }; document.addEventListener("visibilitychange", onVisible); return () => document.removeEventListener("visibilitychange", onVisible); }, [reload]);
  useEffect(() => { if (data && previousPhase.current !== data.event.phase) { const first = previousPhase.current === null; previousPhase.current = data.event.phase; if (first && new URLSearchParams(location.search).get("play") === "1") setScreen("game"); else if (screen !== "game") setScreen(data.event.phase === "live" ? "pass" : "home"); } }, [data, screen]);
  useEffect(() => { const start = setTimeout(() => { if (new URLSearchParams(location.search).get("edit") === "1" && token) { setEdit(true); setScreen("pass"); } }, 0); return () => clearTimeout(start); }, [token]);
  useEffect(() => { const media = matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setMotion(!media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  useEffect(() => { if (!motion || screen !== "home" || intro || video || menu || reading || edit) return; const timer = setInterval(() => setMessageIndex(v => (v + 1) % 3), 5000); return () => clearInterval(timer); }, [motion, screen, intro, video, menu, reading, edit]);
  useEffect(() => { const start = setTimeout(() => { if (!card?.group) { setRevealed(false); setRevealAnimating(false); return; } if (screen !== "pass") return; try { if (localStorage.getItem(`tzai-revealed-${token || "demo"}-${event.publishedVersion}`) || !motion || matchMedia("(prefers-reduced-motion: reduce)").matches) { setRevealed(true); setRevealAnimating(false); return; } } catch { setRevealed(true); return; } setRevealed(false); setRevealAnimating(true); revealTimer.current = setTimeout(finishReveal, 1700); }, 0); return () => { clearTimeout(start); if (revealTimer.current) clearTimeout(revealTimer.current); }; }, [card?.group?.id, token, event.publishedVersion, finishReveal, screen, motion]);
  useEffect(() => () => { if (revealTimer.current) clearTimeout(revealTimer.current); }, []);
  useEffect(() => { let redirect: ReturnType<typeof setTimeout> | null = null; const start = setTimeout(() => { setRedirectPending(false); if (redirectStopped || edit || !card || event.phase !== "after" || card.profile.mode !== "redirect" || !card.profile.url || demo) return; const query = new URLSearchParams(location.search); if (query.has("edit") || query.has("stay") || query.get("play") === "1") return; setRedirectPending(true); redirect = setTimeout(() => { location.replace(card.profile.url); }, 2500); }, 0); return () => { clearTimeout(start); if (redirect) clearTimeout(redirect); }; }, [card, event.phase, demo, edit, redirectStopped]);
  function showReveal() { if (revealTimer.current) clearTimeout(revealTimer.current); setScreen("pass"); setRevealAnimating(true); revealTimer.current = setTimeout(finishReveal, motion ? 1700 : 0); }
  function go(next: Screen) { if (next === "game") setRedirectStopped(true); setScreen(next); closeMenu(); }
  function read(title: string, text: string) { setReading({ title, text }); }
  const messages = [event.welcome, `${event.date.slice(5).replace("-", ".")}・${event.doors} 開始入場`, "因為有你，拼圖才完整。"];
  const photo = event.gallery[photoIndex % Math.max(1, event.gallery.length)];
  const group = card?.group;
  return <div className={`love-app ${!motion ? "motion-paused" : ""}`}>
    <audio ref={music.ref} src="/assets/christmas-music-box.mp3" loop preload="none" aria-label="聖誕音樂盒背景音樂"/>
    <div className="app-ambient" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ left: `${7 + i * 8}%`, animationDelay: `${i * -1.7}s`, animationDuration: `${10 + i % 4 * 3}s` }}/>)}</div>
    <header className="app-header"><button className="app-brand" onClick={() => go("home")} aria-label="載耶首頁"><Puzzle size={24}/><span>載耶 <em>2026</em></span></button><div>{card && <span className="app-serial">#{card.serial}</span>}<button className={`app-icon ${music.playing ? "app-music-playing" : ""}`} onClick={music.toggle} aria-label={music.enabled ? "暫停聖誕音樂" : "播放聖誕音樂"} aria-pressed={music.enabled}>{music.enabled ? <Volume2 size={20}/> : <VolumeX size={20}/>}</button><button className="app-icon" onClick={() => setMenu(true)} aria-label="開啟選單"><Menu size={20}/></button></div></header>
    <div className="app-viewport"><Lights dancing={lightParty}/>{loading && <div className="app-loading" role="status" aria-label="正在讀取活動資訊"/>}{error && <div className="app-error" role="alert"><span>{error}</span><button onClick={reload}>重試</button></div>}{redirectPending && <div className="app-error" role="status"><span>即將開啟持卡者的個人連結。</span><button onClick={() => setRedirectStopped(true)}>留在這裡</button></div>}
      {demo && <div className="app-demo">示範畫面 {(["before","live","after"] as EventPhase[]).map((p, i) => <a href={`/demo?phase=${p}`} key={p} aria-current={demo === p ? "page" : undefined}>{["活動前","當天","活動後"][i]}</a>)}</div>}
      <main className={`app-screen app-screen-${screen}`} key={`${screen}-${event.phase}`} id="app-panel" aria-label={screen === "home" ? "聖誕邀請" : screen === "info" ? "活動資訊" : screen === "game" ? "搖搖耶誕樹" : "我的耶誕小屋"}>
        {screen === "home" && event.phase !== "after" && <>
          <div className="app-home-heading"><button className="app-world-label" onClick={() => { setLightParty(v => !v); setFeedback(lightParty ? "把暖暖的燈光，留給你。" : "燈光也跟著你，跳起舞來！"); }}>你的聖誕小世界 <span>✧</span></button><h1>{event.theme === "What is Love?" ? <>What is<br/><em>Love?</em></> : event.theme}</h1><p className="app-rotating-message" key={messageIndex}>{messages[messageIndex]}</p><button className="app-music-pill" onClick={music.toggle} aria-pressed={music.enabled}><Music2 size={13}/>{music.loading ? "音樂正在暖身…" : music.playing ? "聖誕音樂播放中" : "開啟聖誕音樂"}<span className={music.playing ? "music-bars is-playing" : "music-bars"} aria-hidden="true"><i/><i/><i/></span></button>{music.error && <span className="app-music-error" role="status">{music.error}</span>}</div>
          <div className="app-world-slot"><AnimatedWorld onInvite={openIntro} onFeedback={setFeedback} soundEnabled={sound}/></div>
          <div className="app-home-actions"><p className="app-tap-hint" aria-live="polite">{feedback}</p><button className="app-button cream" onClick={videoId ? () => setVideo(true) : openIntro}>{videoId ? <Play size={18} fill="currentColor"/> : <Mail size={19}/>} {videoId ? "觀看劇情預告" : "打開我的邀請"}<ArrowRight size={18}/></button>{videoId ? <button className="app-text" onClick={openIntro}>再看活動資訊動畫 <ArrowRight size={14}/></button> : <span className="app-date-note">{event.date.slice(5).replace("-", ".")} <b>✦</b> {event.doors} 入場</span>}</div>
        </>}
        {screen === "home" && event.phase === "after" && <>
          <div className="app-section-heading"><span className="app-eyebrow">A LITTLE PIECE OF US</span><h1>Love stays.</h1><button className="app-copy-button two-lines" onClick={() => read("謝謝你，來到這一晚。", event.afterMessage)}>{event.afterMessage}</button></div>
          {photo ? <div className="app-memory"><button className="app-photo" onClick={() => read("照片中的小故事", photo.caption || "一起把這一晚，好好收藏。") }><img src={photo.url} alt={photo.caption || `載耶活動照片 ${photoIndex + 1}`}/></button><p className="two-lines">{photo.caption || "把這一晚，好好收藏。"}</p><div className="app-pager"><button className="app-icon" aria-label="上一張照片" onClick={() => setPhotoIndex((photoIndex - 1 + event.gallery.length) % event.gallery.length)}><ChevronLeft/></button><span>{photoIndex % event.gallery.length + 1} / {event.gallery.length}</span><button className="app-icon" aria-label="下一張照片" onClick={() => setPhotoIndex((photoIndex + 1) % event.gallery.length)}><ChevronRight/></button></div></div> : <><div className="app-world-slot"><AnimatedWorld compact onInvite={() => go("pass")} onFeedback={setFeedback} soundEnabled={sound}/></div><p className="app-empty-note">照片正在整理中。<br/>再來感應小卡，一起重溫這一晚。</p></>}
          <div className="app-bottom-actions">{event.albumUrl ? <a className="app-button cream" href={event.albumUrl} target="_blank" rel="noopener noreferrer">打開活動相簿<ArrowUpRight size={18}/></a> : <button className="app-button cream" onClick={() => go("pass")}>打開我的紀念小卡<Heart size={18}/></button>}</div>
        </>}
        {screen === "info" && <>
          <div className="app-section-heading"><span className="app-eyebrow">SAVE THE DATE</span><h1>這一晚，我們見。</h1></div>
          <div className="app-info-wrap"><img className="app-ticket-ginger" src="/assets/gingerbread-wave.webp" alt=""/><article className="app-info-ticket"><div className="app-big-date">{event.date.slice(5).replace("-", ".")}</div><span className="app-weekday">{displayDate(event.date)}</span><div className="app-ticket-rule"/><div className="app-fact"><Ticket/><span><strong>{event.doors}</strong> 開始入場</span></div><div className="app-fact"><Clock3/><strong>{event.start} — {event.end}</strong></div><button className="app-fact app-place" onClick={() => read("今晚的相遇地點", `${event.venue}\n${event.address !== event.venue ? event.address : ""}`)}><MapPin/><span className="two-lines">{event.venue}</span><ChevronRight size={16}/></button><div className="app-ticket-rule"/><button className="app-event-name" onClick={() => read("這一晚，留給我們。", `${event.title}\n${event.subtitle}\n\n${event.welcome}`)}><span className="two-lines">{event.title}<br/>{event.subtitle}</span><ChevronRight size={16}/></button></article><img className="app-ticket-gift" src="/assets/christmas-gift.webp" alt=""/></div>
          <div className="app-twin-actions"><a className="app-button cream" href={calendarLink(event)} target="_blank" rel="noopener noreferrer"><CalendarDays size={19}/>加入行事曆</a><a className="app-button cream" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address || event.venue)}`} target="_blank" rel="noopener noreferrer"><MapPin size={19}/>查看地圖</a></div>
        </>}
        {screen === "pass" && event.phase === "live" && group && <>
          <div className="app-section-heading"><span className="app-eyebrow">YOUR CHRISTMAS TEAM</span><h1>你的夥伴，找到了。</h1></div>
          {!revealed || revealAnimating ? <div className={`app-reveal ${revealAnimating ? "is-revealing" : ""}`}><img src="/assets/heart.webp" alt="拼圖正在相聚"/><h2>你的那一片，就在這裡。</h2><p>{revealAnimating ? "正在拼出你們的相遇…" : "一起打開今晚的相遇。"}</p><button className="app-button cream" onClick={revealAnimating ? finishReveal : showReveal}>{revealAnimating ? "直接查看組別" : "揭曉我的組別"}<Puzzle size={19}/></button></div> : <><article className="app-group-ticket"><Puzzle className="app-group-mark" size={38}/><span className="app-eyebrow">NICE TO MEET YOU</span><button className="app-group-name" onClick={() => read("你的拼圖夥伴", group.name)}><span className="two-lines">{group.name}</span><ChevronRight size={16}/></button><div className="app-ticket-rule"/><small><MapPin size={15}/>集合地點</small><button className="app-group-place" onClick={() => read("集合地點", group.location || "請向現場工作人員確認集合位置")}><span className="two-lines">{group.location || "請向現場工作人員確認集合位置"}</span><ChevronRight size={16}/></button>{group.note && <button className="app-note-link" onClick={() => read("給你們的小提醒", group.note)}><Mail size={16}/>打開給你們的小提醒<ArrowRight size={15}/></button>}<span className="app-group-foot">小卡 #{card.serial} · 很高興遇見你。</span></article><button className="app-text" onClick={showReveal}><RotateCcw size={16}/>再看一次揭曉動畫</button></>}
        </>}
        {screen === "pass" && event.phase === "live" && !group && <>
          <div className="app-section-heading"><span className="app-eyebrow">A LITTLE SURPRISE</span><h1>相遇，正在路上。</h1></div><div className="app-world-slot"><AnimatedWorld compact onInvite={() => { void reload(); setFeedback("幫你再找找，今晚的拼圖夥伴。"); }} onFeedback={setFeedback} soundEnabled={sound}/></div><div className="app-waiting"><h2>{!token && !demo ? "用小卡，找到你的夥伴。" : !card?.bound ? "你的小卡，等著與你相遇。" : !event.revealOpen ? "拼圖夥伴，即將揭曉。" : "你的組別還在準備中。"}</h2><p>{!token && !demo ? "請感應 NFC 卡，開啟專屬網址。" : !card?.bound ? "請找工作人員確認領卡資料。" : !event.revealOpen ? "開放後再感應小卡，就能查看組別。" : "請找工作人員，我們會幫你找到夥伴。"}</p><button className="app-button cream" onClick={reload}><RotateCcw size={17}/>重新查看</button></div>
        </>}
        {screen === "pass" && event.phase !== "live" && <PersonalHouse card={card || null} event={event} token={token} demo={!!demo} onGame={() => go("game")} onRead={read} onEdit={() => demo ? read("這是一張示範小卡", "正式小卡可登入後認領與編輯。") : setEdit(true)}/>}
        {screen === "game" && <SoloTreeGame token={token} active={!menu && !intro && !video && !reading && !edit}/>}
      </main>
    </div>
    <nav className="app-dock" aria-label="主要導覽">{([{ id: "home", label: event.phase === "after" ? "回憶" : "邀請", Icon: event.phase === "after" ? Heart : Mail }, { id: "info", label: "活動", Icon: CalendarDays }, { id: "game", label: "搖樹", Icon: Trees }, { id: "pass", label: "小屋", Icon: House }] as const).map(({ id, label, Icon }) => <button key={id} aria-current={screen === id ? "page" : undefined} onClick={() => go(id)} className={screen === id ? "is-active" : ""}><Icon size={26} strokeWidth={1.7}/><span>{label}</span><i aria-hidden="true"/></button>)}</nav>
    {menu && <Modal title="小世界選單" onClose={closeMenu} className="app-dialog app-menu"><span className="app-eyebrow">MAKE YOURSELF AT HOME</span><h2>待在這裡，玩一下。</h2><nav><button onClick={() => { closeMenu(); openIntro(); }}><Mail/>重播邀請動畫<ChevronRight/></button>{videoId && <button onClick={() => { closeMenu(); setVideo(true); }}><Play/>觀看直式預告<ChevronRight/></button>}<button onClick={music.toggle}><Music2/>聖誕背景音樂<span>{music.enabled ? "ON" : "OFF"}</span></button><button onClick={() => setMotion(v => !v)}>{motion ? <Pause/> : <Play/>}{motion ? "暫停畫面動態" : "恢復畫面動態"}<span>{motion ? "ON" : "OFF"}</span></button><button onClick={() => setSound(v => !v)}>{sound ? <Volume2/> : <VolumeX/>}點按音效<span>{sound ? "ON" : "OFF"}</span></button><a href="/admin">工作人員入口<ArrowUpRight size={18}/></a></nav><p>聖誕音樂盒 · We Wish You a Merry Christmas</p></Modal>}
    {intro && <Modal title="載耶聖誕邀請" onClose={closeIntro} className="app-dialog app-invitation"><Invitation event={event} animate={motion} onInfo={() => { closeIntro(); go("info"); }}/></Modal>}
    {video && videoId && <Modal title="載耶直式劇情預告" onClose={closeVideo} className="app-dialog app-video"><h2>What is Love?</h2><div className="app-vertical-video"><iframe title="載耶直式劇情預告" src={`https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div><a className="app-text" href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer">在 YouTube 開啟<ArrowUpRight size={16}/></a></Modal>}
    {reading && <Modal title={reading.title} onClose={closeReading} className="app-dialog app-reader"><TextBook reading={reading}/></Modal>}
    {edit && token && <Modal title="管理我的載耶小卡" onClose={closeEdit} className="app-dialog app-profile-dialog"><ProfileEditor token={token} onSaved={reload}/></Modal>}
  </div>;
}

function Invitation({ event, animate, onInfo }: { event: EventConfig; animate: boolean; onInfo: () => void }) {
  const [step, setStep] = useState(0); const [auto, setAuto] = useState(true);
  useEffect(() => { if (!animate || !auto || step >= 2) return; const timer = setTimeout(() => setStep(s => s + 1), 3000); return () => clearTimeout(timer); }, [step, auto, animate]);
  const scenes = [{ title: event.theme, detail: "一片小小的拼圖，正在等你。", image: "/assets/heart.webp" }, { title: "在相遇裡，\n拼出愛的模樣。", detail: "和熟悉的朋友，也和還不認識的你。", image: "/assets/gingerbread-wave.webp" }, { title: `${event.date.slice(5).replace("-", ".")}，我們見。`, detail: `${event.doors} 入場 · ${event.start}—${event.end}\n${event.venue}`, image: "/assets/christmas-gift.webp" }];
  const scene = scenes[step];
  return <div className="app-invitation-content"><span className="app-eyebrow">A LITTLE INVITATION FOR YOU</span><div className="app-story-scene" key={step}><img src={scene.image} alt=""/><h2>{scene.title}</h2><p>{scene.detail}</p></div><div className="app-story-dots">{scenes.map((_, i) => <button aria-label={`邀請第 ${i + 1} 幕`} aria-current={step === i ? "step" : undefined} onClick={() => { setAuto(false); setStep(i); }} key={i}><span/></button>)}</div><button className="app-button cream" onClick={onInfo}>查看活動資訊<ArrowRight size={18}/></button>{step < 2 && <button className="app-text" onClick={() => { setAuto(false); setStep(step + 1); }}>下一幕<ChevronRight size={15}/></button>}</div>;
}
function TextBook({ reading }: { reading: Reading }) {
  const [page, setPage] = useState(0); const chars = Array.from(reading.text); const pages: string[] = [];
  let chunk = "", line = 0, column = 0;
  for (const char of chars) { chunk += char; column += 1; if (char === "\n" || column >= 14) { line += 1; column = 0; } if (line >= 6) { pages.push(chunk); chunk = ""; line = 0; column = 0; } }
  if (chunk) pages.push(chunk);
  if (!pages.length) pages.push("");
  return <><span className="app-eyebrow">A LITTLE NOTE FOR YOU</span><h2>{reading.title}</h2><p className="app-reader-text" key={page}>{pages[page]}</p><div className="app-pager"><button className="app-icon" aria-label="上一頁" onClick={() => setPage(p => p - 1)} disabled={!page}><ChevronLeft/></button><span>{page + 1} / {pages.length}</span><button className="app-icon" aria-label="下一頁" onClick={() => setPage(p => p + 1)} disabled={page === pages.length - 1}><ChevronRight/></button></div></>;
}
