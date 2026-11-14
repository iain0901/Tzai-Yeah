"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, Copy, Link2, RotateCcw } from "lucide-react";
import type { EventConfig, PublicCard } from "@/lib/contracts";
import Modal from "./Modal";
import "./personal-card.css";

export default function PersonalCard({ card, event, token, demo, onEdit, onRead }: { card: PublicCard | null; event: EventConfig; token: string; demo: boolean; onEdit: () => void; onRead: (title: string, text: string) => void }) {
  const [flipped, setFlipped] = useState(false);
  const [copied, setCopied] = useState(0);
  const [copying, setCopying] = useState(false);
  const [manualLink, setManualLink] = useState("");
  const closeCopy = useCallback(() => setManualLink(""), []);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(0), 4000); return () => clearTimeout(timer); }, [copied]);
  async function copy() {
    if (demo || !card || !token || copying) return;
    const url = `${location.origin}/t/${encodeURIComponent(token)}`;
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
      setCopied(value => value + 1);
      setManualLink("");
    } catch { setManualLink(url); }
    finally { setCopying(false); }
  }
  const personal = event.phase === "after" && card;
  return <section className="personal-card" aria-label="我的紀念小卡">
    <header className="personal-card-heading"><span className="app-eyebrow">A LITTLE PIECE OF US</span><h1>我的紀念小卡</h1><p>{card ? <>小卡 <b>#{card.serial}</b> · 這一晚的相遇紀念</> : "把這一晚，留在一張小卡裡。"}</p></header>
    <div className="app-pass-stage"><div className="personal-card-display"><button className={`app-card-flip ${flipped ? "is-flipped" : ""}`} onClick={() => setFlipped(v => !v)} aria-label={flipped ? "翻到小卡正面" : "翻到小卡背面"}><span className="app-card-inner"><img className="app-card-front" src="/assets/pass-front.jpg" alt="載耶紀念卡正面"/><img className="app-card-back" src="/assets/pass-back.webp" alt="載耶紀念卡背面"/></span><span className="app-card-shine" aria-hidden="true"/></button></div><span className="app-flip-hint"><RotateCcw size={13}/>點一下，翻轉小卡</span></div>
    <div className="personal-card-actions">
      {personal ? <><button className="personal-card-profile" onClick={() => onRead("我的紀念小卡", `${card.profile.displayName || `#${card.serial}`}\n\n${card.profile.bio || event.afterMessage}`)}><span><strong>{card.profile.displayName || `#${card.serial}`}</strong><small>{card.profile.bio || "留下一點自己，讓相遇繼續。"}</small></span><ArrowRight size={17}/></button>{card.profile.url && <a className="app-button cream" href={card.profile.url} target="_blank" rel="noopener noreferrer">來這裡找到我<ArrowUpRight size={17}/></a>}</> : <p>同一張小卡，陪你走過<br/>邀請、分組，到活動後的回憶。</p>}
      {card && !demo && token ? <><button className="app-button cream personal-card-copy" onClick={copy} disabled={copying}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? "已複製小卡連結" : copying ? "正在複製…" : "複製我的小卡連結"}</button><p className="personal-card-save-note" role="status">{copied ? "貼到私人筆記，就能把小卡收藏起來。" : "把連結留在身邊，隨時回到你的耶誕小世界。"}</p></> : <p className="personal-card-hint">{demo ? "這是示範小卡，專屬連結會留在你的正式小卡裡。" : <>從你的專屬連結進來，<br/>就能收藏自己的小卡。</>}</p>}
      {personal && <button className="app-text" onClick={onEdit}><Link2 size={15}/>{card.claimed ? "管理我的小卡" : "編輯個人介紹與連結"}</button>}
    </div>
    {manualLink && <Modal title="收藏我的小卡連結" onClose={closeCopy} className="app-dialog personal-card-copy-dialog"><span className="app-eyebrow">KEEP THIS LITTLE CHRISTMAS</span><h2>把這份相遇，留在身邊。</h2><p>長按下方網址，選擇複製，<br/>再貼到私人筆記收藏。</p><label htmlFor="personal-card-link">我的小卡連結</label><input id="personal-card-link" type="text" readOnly autoFocus value={manualLink} onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} spellCheck={false}/><button className="app-button cream" onClick={copy} disabled={copying}><Copy size={17}/>{copying ? "正在複製…" : "再試一次複製"}</button></Modal>}
  </section>;
}
