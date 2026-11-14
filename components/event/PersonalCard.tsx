"use client";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, Copy, Link2, RotateCcw } from "lucide-react";
import type { EventConfig, PublicCard } from "@/lib/contracts";
import "./personal-card.css";

export default function PersonalCard({ card, event, token, demo, onEdit, onRead }: { card: PublicCard | null; event: EventConfig; token: string; demo: boolean; onEdit: () => void; onRead: (title: string, text: string) => void }) {
  const [flipped, setFlipped] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2200); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    if (demo || !token) { onRead("同一張小卡，一直陪著你。", "正式小卡的專屬網址會一直沿用，從活動邀請、分組揭曉，到活動後的照片回顧。"); return; }
    try { await navigator.clipboard.writeText(`${location.origin}/t/${token}`); setCopied(true); }
    catch { onRead("你的小卡專屬連結", `${location.origin}/t/${token}`); }
  }
  const personal = event.phase === "after" && card;
  return <section className="personal-card" aria-label="我的紀念小卡">
    <header className="personal-card-heading"><span className="app-eyebrow">A LITTLE PIECE OF US</span><h1>我的紀念小卡</h1><p>{card ? <>小卡 <b>#{card.serial}</b> · 這一晚的相遇紀念</> : "把這一晚，留在一張小卡裡。"}</p></header>
    <div className="app-pass-stage"><div className="personal-card-display"><button className={`app-card-flip ${flipped ? "is-flipped" : ""}`} onClick={() => setFlipped(v => !v)} aria-label={flipped ? "翻到小卡正面" : "翻到小卡背面"}><span className="app-card-inner"><img className="app-card-front" src="/assets/pass-front.jpg" alt="載耶紀念卡正面"/><img className="app-card-back" src="/assets/pass-back.webp" alt="載耶紀念卡背面"/></span><span className="app-card-shine" aria-hidden="true"/></button></div><span className="app-flip-hint"><RotateCcw size={13}/>點一下，翻轉小卡</span></div>
    <div className="personal-card-actions">
      {personal ? <><button className="personal-card-profile" onClick={() => onRead("我的紀念小卡", `${card.profile.displayName || `載耶小卡 #${card.serial}`}\n\n${card.profile.bio || event.afterMessage}`)}><span><strong>{card.profile.displayName || `載耶小卡 #${card.serial}`}</strong><small>{card.profile.bio || "留下一點自己，讓相遇繼續。"}</small></span><ArrowRight size={17}/></button>{card.profile.url && <a className="app-button cream" href={card.profile.url} target="_blank" rel="noopener noreferrer">來這裡找到我<ArrowUpRight size={17}/></a>}</> : <p>同一張小卡，陪你走過<br/>邀請、分組，到活動後的回憶。</p>}
      {card ? <button className={personal ? "app-text" : "app-button cream"} onClick={copy}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? "已複製專屬連結" : "複製小卡專屬連結"}</button> : <p className="personal-card-hint">從你的專屬連結進來，<br/>就能查看自己的小卡編號。</p>}
      {personal && <button className="app-text" onClick={onEdit}><Link2 size={15}/>{card.claimed ? "管理我的小卡" : "編輯個人介紹與連結"}</button>}
    </div>
  </section>;
}
