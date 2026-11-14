"use client";

import { useState } from "react";
import { ArrowUpRight, Images } from "lucide-react";
import type { EventConfig } from "@/lib/contracts";
import "./afterglow.css";

type AfterglowProps = {
  event: EventConfig;
  onRead: (title: string, text: string) => void;
};

/** One keepsake screen and one external album; a gallery is entirely optional. */
export default function Afterglow({ event, onRead }: AfterglowProps) {
  const [failedCover, setFailedCover] = useState("");
  const cover = event.gallery[0];
  const hasCover = !!cover?.url && cover.url !== failedCover;
  const message = event.afterMessage || "謝謝你，成為這一晚的其中一片。";
  const readNote = () => onRead("把這一晚，好好收藏。", message);

  return <section className="afterglow" aria-label="這一晚的回憶">
    <header className="afterglow-heading">
      <span className="app-eyebrow">A LITTLE PIECE OF US</span>
      <h1>這一晚，<br/><em>好好收藏。</em></h1>
      <button className="afterglow-message" onClick={readNote} aria-label={`讀完整回顧小箋：${message}`}>
        <span>{message}</span>
        <span className="afterglow-note-hint" aria-hidden="true">讀小箋 ↗</span>
      </button>
    </header>

    <div className="afterglow-scene">
      <div className="afterglow-halo" aria-hidden="true"/>
      <span className="afterglow-star afterglow-star-one" aria-hidden="true">✦</span>
      <span className="afterglow-star afterglow-star-two" aria-hidden="true">✧</span>
      <button className={`afterglow-keepsake ${hasCover ? "has-cover" : ""}`} onClick={readNote} aria-label="打開留給你的耶誕小箋">
        <span className="afterglow-picture">
          {hasCover ? <img className="afterglow-cover" src={cover.url} alt={cover.caption || "載耶晚會的相遇回憶"} onError={() => setFailedCover(cover.url)}/> : <img className="afterglow-heart" src="/assets/heart.webp" alt="拼起來的耶誕愛心"/>}
        </span>
        <span className="afterglow-card-caption">有你，這一晚才完整。</span>
        <span className="afterglow-card-date">TZAI YEAH <i>✦</i> {event.date.slice(5).replace("-", ".")}</span>
      </button>
      <img className="afterglow-gingerbread" src="/assets/gingerbread-wave.webp" alt="" aria-hidden="true"/>
      <img className="afterglow-gift" src="/assets/christmas-gift.webp" alt="" aria-hidden="true"/>
    </div>

    <div className="afterglow-actions">
      {event.albumUrl ? <>
        <a className="app-button cream afterglow-album" href={event.albumUrl} target="_blank" rel="noopener noreferrer"><Images size={20}/><span>打開我們的回憶</span><ArrowUpRight size={18}/></a>
        <p>照片與合照，都放在相簿裡。</p>
      </> : <div className="afterglow-pending" role="status"><Images size={19}/><div><strong>回憶正在整理</strong><p>準備好後，會在這裡等你。</p></div></div>}
    </div>
  </section>;
}
