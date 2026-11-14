"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Copy, Heart, Link2, RotateCcw, Sparkles, Trees } from "lucide-react";
import type { EventConfig, PublicCard } from "@/lib/contracts";
import { formatTreeHeight, type TreePlayer } from "@/lib/tree-contracts";
import "./personal-house.css";

export default function PersonalHouse({ card, event, token, demo, onGame, onEdit, onRead }: { card: PublicCard | null; event: EventConfig; token: string; demo: boolean; onGame: () => void; onEdit: () => void; onRead: (title: string, text: string) => void }) {
  const [view, setView] = useState<"house" | "card">("house"); const [flipped, setFlipped] = useState(false); const [greeting, setGreeting] = useState(0);
  const [tree, setTree] = useState<TreePlayer | null>(null); const [treeLoading, setTreeLoading] = useState(!demo); const [memoryError, setMemoryError] = useState(false); const [retry, setRetry] = useState(0); const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (demo) return;
    let alive = true, busy = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function loadTree() {
      if (!alive || busy || document.visibilityState !== "visible") return;
      busy = true; controller = new AbortController();
      const current = controller;
      const timeout = setTimeout(() => current.abort(), 12000);
      try {
        const response = await fetch(`/api/tree${token ? `?token=${encodeURIComponent(token)}` : ""}`, { cache: "no-store", signal: current.signal });
        if (!response.ok) throw new Error();
        const result = await response.json() as { player: TreePlayer | null };
        if (alive) { setTree(result.player); setMemoryError(false); }
      } catch { if (alive) setMemoryError(true); }
      finally { clearTimeout(timeout); busy = false; if (alive) { setTreeLoading(false); timer = setTimeout(loadTree, 6000); } }
    }
    const visible = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); void loadTree(); } };
    timer = setTimeout(loadTree, 0);
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; controller?.abort(); if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [token, demo, retry]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2200); return () => clearTimeout(timer); }, [copied]);
  async function copy() { if (demo || !token) { onRead("同一張小卡，一直陪著你。", "正式小卡的專屬網址會一直沿用，從活動邀請、分組揭曉，到活動後的照片回顧。"); return; } try { await navigator.clipboard.writeText(`${location.origin}/t/${token}`); setCopied(true); } catch { onRead("收藏你的小屋網址", `${location.origin}/t/${token}`); } }
  const greetings = ["每一次相遇，都讓小屋亮一點。", "叩叩！很開心，你又回來了。", "一起收集，今年耶誕的溫暖。"];
  const phaseNote = event.phase === "before" ? "活動邀請準備好了，故事正要開始。" : event.phase === "live" ? "今晚的組別，會在活動畫面揭曉。" : "這一晚的回憶，已經替你收藏。";
  return <section className={`personal-house ${view === "card" ? "house-card-view" : ""}`} aria-label="我的耶誕小屋">
    {view === "house" ? <>
      <div className="house-heading"><span className="app-eyebrow">YOUR CHRISTMAS HOME</span><h1>我的耶誕小屋</h1><p>{card ? <>小卡 <b>#{card.serial}</b> 已在這裡 · 歡迎回來。</> : "這裡也為你留了一盞燈。"}</p><p className="house-phase-note">{phaseNote}</p></div>
      <div className="house-art-space"><button className="house-art" onClick={() => setGreeting(i => (i + 1) % greetings.length)} aria-label="敲敲我的耶誕小屋"><span className="house-window-glow" aria-hidden="true"/><img key={greeting} src="/assets/personal-house.webp" alt="暖暖亮燈的薑餅小屋"/><i aria-hidden="true">✧</i></button></div>
      <div className="house-keepsakes"><p className="house-greeting" aria-live="polite">{greetings[greeting]}</p><div className="house-memory"><Sparkles size={17}/>{memoryError ? <button onClick={() => setRetry(n => n + 1)}>小樹正在休息・重新讀取</button> : <span>{treeLoading ? "正在看看小樹長多高了…" : tree ? <><span className="house-tree-name">{tree.name}</span>的小樹 <strong>{formatTreeHeight(tree.heightCm)}</strong> · 第 {tree.rank} 名</> : "種下你的小樹，慢慢養出整片星光。"}</span>}</div><button className="app-button cream" onClick={onGame}><Trees size={19}/>{tree ? "去照顧我的耶誕樹" : "種下我的耶誕樹"}<ArrowRight size={17}/></button><button className="app-text" onClick={() => setView("card")}><Heart size={15}/>我的紀念小卡<ArrowRight size={15}/></button></div>
    </> : <>
      <button className="house-back" onClick={() => setView("house")}><ArrowLeft size={17}/>回到我的小屋</button><div className="house-heading"><span className="app-eyebrow">A LITTLE PIECE OF US</span><h1>{card ? `紀念小卡 #${card.serial}` : "一張小卡，一段相遇。"}</h1></div>
      <div className="app-pass-stage"><button className={`app-card-flip ${flipped ? "is-flipped" : ""}`} onClick={() => setFlipped(v => !v)} aria-label={flipped ? "翻到小卡正面" : "翻到小卡背面"}><span className="app-card-inner"><img className="app-card-front" src="/assets/pass-front.jpg" alt="載耶紀念卡正面"/><img className="app-card-back" src="/assets/pass-back.webp" alt="載耶紀念卡背面"/></span><span className="app-card-shine" aria-hidden="true"/></button><span className="app-flip-hint"><RotateCcw size={13}/>點一下，翻轉小卡</span></div>
      {event.phase === "after" && card ? <div className="app-personal"><button className="app-profile-name" onClick={() => onRead("我的紀念小卡", `${card.profile.displayName || `載耶小卡 #${card.serial}`}\n\n${card.profile.bio || event.afterMessage}`)}><strong className="two-lines">{card.profile.displayName || `載耶小卡 #${card.serial}`}</strong><span className="two-lines">{card.profile.bio || "留下一點自己，讓相遇繼續。"}</span><ArrowRight size={17}/></button>{card.profile.url && <a className="app-button cream" href={card.profile.url} target="_blank" rel="noopener noreferrer">來這裡找到我<ArrowUpRight size={17}/></a>}<button className="app-text" onClick={onEdit}><Link2 size={15}/>{card.claimed ? "管理我的小卡" : "編輯個人介紹與連結"}</button></div> : <div className="house-card-actions"><p>同一個小卡網址，陪你走過這一晚。<br/>從邀請、分組，到活動後的回憶。</p>{card ? <button className="app-button cream" onClick={copy}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? "已複製小屋網址" : "收藏我的小屋網址"}</button> : <span>已有專屬連結？從原連結進來，<br/>就能查看你的小卡。</span>}</div>}
    </>}
  </section>;
}
