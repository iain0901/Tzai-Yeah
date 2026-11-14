"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import "./animated-world.css";

export type AnimatedWorldProps = {
  onInvite: () => void;
  onFeedback?: (message: string) => void;
  soundEnabled?: boolean;
  compact?: boolean;
};

type Toy = "heart" | "gingerbread" | "gift";
type Burst = { id: number; toy: Toy };
type MotionStyle = CSSProperties & Record<`--${string}`, string | number>;

const HEART_MESSAGES = [
  "愛，是一起拼出的模樣。",
  "你就是剛剛好的那一片。",
  "這一晚，有你才完整。",
  "把一點溫暖，送給身邊的人。",
];
const STARS = [
  [8, 18, 16, 0], [89, 13, 11, 1.5], [95, 47, 20, .6],
  [5, 53, 9, 2.1], [19, 85, 9, 1.1], [52, 90, 15, 2.7],
  [79, 71, 8, .3], [66, 3, 8, 1.8], [29, 8, 6, 2.5],
] as const;
const PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const distance = 65 + (i % 3) * 22;
  return {
    "--burst-x": `${Math.cos(angle) * distance}px`,
    "--burst-y": `${Math.sin(angle) * distance - 22}px`,
    "--burst-turn": `${i % 2 ? 120 : -90}deg`,
    "--burst-delay": `${(i % 4) * 24}ms`,
    "--burst-size": `${i % 3 === 0 ? 15 : 8}px`,
  } as MotionStyle;
});

function PuzzlePiece() {
  return <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true"><path d="M6 7h15c-2 3-3 7-1 10 2 4 8 5 11 2 3-2 3-8 0-12h15v14c4-3 8-3 11-1 4 2 4 8 1 11-2 3-8 3-12 0v15H31c3 4 3 8 1 11-2 4-8 4-11 1-3-2-3-8 0-12H6V32c4 3 9 3 11 0 3-3 2-8-1-10-3-2-7-1-10 1V7Z" stroke="#412617" strokeWidth="2.3" strokeLinejoin="round"/></svg>;
}

function AnimatedWorld({ onInvite, onFeedback, soundEnabled = false, compact = false }: AnimatedWorldProps) {
  const [heartHit, setHeartHit] = useState(0);
  const [gingerbreadHit, setGingerbreadHit] = useState(0);
  const [giftHit, setGiftHit] = useState(0);
  const [burst, setBurst] = useState<Burst | null>(null);
  const sequence = useRef(0);
  const heartMessage = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const inviteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => () => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current.clear();
    const context = audio.current;
    audio.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  function later(callback: () => void, delay: number) {
    const timer = setTimeout(() => { timers.current.delete(timer); callback(); }, delay);
    timers.current.add(timer);
    return timer;
  }

  function chime(toy: Toy) {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audio.current || new AudioContextClass();
      audio.current = context;
      if (context.state === "suspended") void context.resume().catch(() => {});
      const notes = toy === "gift" ? [659.25, 880] : toy === "gingerbread" ? [783.99, 1046.5] : [523.25, 783.99];
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * .09;
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.055, start + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .38);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start);
        oscillator.stop(start + .4);
      });
    } catch { /* The visual interaction also works when audio is unavailable. */ }
  }

  function celebrate(toy: Toy) {
    const id = ++sequence.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      setBurst({ id, toy });
      later(() => setBurst(current => current?.id === id ? null : current), 1100);
    }
    chime(toy);
    return reduced;
  }

  function tapHeart() {
    setHeartHit(value => value + 1);
    onFeedback?.(HEART_MESSAGES[heartMessage.current++ % HEART_MESSAGES.length]);
    celebrate("heart");
  }

  function tapGingerbread() {
    setGingerbreadHit(value => value + 1);
    onFeedback?.("嗨！帶著你的笑容，一起來玩吧。");
    celebrate("gingerbread");
  }

  function tapGift() {
    setGiftHit(value => value + 1);
    onFeedback?.("一份暖暖的邀請，送給你。");
    const reduced = celebrate("gift");
    if (inviteTimer.current) { clearTimeout(inviteTimer.current); timers.current.delete(inviteTimer.current); }
    if (reduced) { inviteTimer.current = null; onInvite(); }
    else inviteTimer.current = later(() => { inviteTimer.current = null; onInvite(); }, 300);
  }

  return <div className={`animated-world${compact ? " animated-world--compact" : ""}`} role="group" aria-label="可以點按的聖誕小世界">
    <div className="aw-warmth" aria-hidden="true"/>
    <div className="aw-trail aw-trail--back" aria-hidden="true"/>
    <div className="aw-orbits" aria-hidden="true">
      {["coral", "sage", "blush"].map((color, index) => <div className={`aw-orbit aw-orbit--${index + 1}`} key={color}><div className={`aw-puzzle aw-puzzle--${color}`}><PuzzlePiece/></div><i className="aw-comet"/></div>)}
    </div>
    <button type="button" className="aw-toy aw-heart" aria-label="點點愛心，收下一句暖心的話" onClick={tapHeart}>
      <span className="aw-heart-float"><span key={heartHit} className={`aw-toy-response${heartHit ? " aw-heart-pop" : ""}`}><img src="/assets/heart.webp" alt="" width="800" height="800" draggable={false} fetchPriority="high"/></span></span>
    </button>
    <div className="aw-trail aw-trail--front" aria-hidden="true"/>
    <div className="aw-stars" aria-hidden="true">{STARS.map(([left, top, size, delay], index) => <span key={index} style={{ left: `${left}%`, top: `${top}%`, fontSize: size, "--twinkle-delay": `${delay}s` } as MotionStyle}>✦</span>)}</div>
    <button type="button" className="aw-toy aw-gingerbread" aria-label="和薑餅人打招呼" onClick={tapGingerbread}>
      <span className="aw-gingerbread-sway"><span key={gingerbreadHit} className={`aw-toy-response${gingerbreadHit ? " aw-gingerbread-jump" : ""}`}><img src="/assets/gingerbread-wave.webp" alt="" width="400" height="500" draggable={false}/></span></span>
    </button>
    <button type="button" className="aw-toy aw-gift" aria-label="打開禮物，查看聖誕邀請" onClick={tapGift}>
      <span className="aw-gift-rock"><span key={giftHit} className={`aw-toy-response${giftHit ? " aw-gift-pop" : ""}`}><img src="/assets/christmas-gift.webp" alt="" width="400" height="400" draggable={false}/></span></span>
    </button>
    {burst && <div key={burst.id} className={`aw-burst aw-burst--${burst.toy}`} aria-hidden="true">{PARTICLES.map((style, index) => <i key={index} style={style}>{index % 3 === 0 ? "✧" : "✦"}</i>)}</div>}
    <span className="aw-floor" aria-hidden="true"/>
  </div>;
}

export default memo(AnimatedWorld);
