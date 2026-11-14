"use client";

import { useEffect, useRef, useState } from "react";
import { levelName, type TreeLevel } from "@/lib/tree-contracts";

const STAGES = [1, 2, 3, 4, 5, 6] as const;

/** Keep the previous illustration visible until the next image has decoded. */
export default function TreeStageArt({ level, pulse, animations }: { level: TreeLevel; pulse: number; animations: boolean }) {
  const [shown, setShown] = useState<TreeLevel>(level);
  const [failed, setFailed] = useState(false);
  const [attempts, setAttempts] = useState<Partial<Record<TreeLevel, number>>>({});
  const ready = useRef(new Set<TreeLevel>());
  const failures = useRef(new Set<TreeLevel>());
  const requested = useRef(level);
  const art = useRef<HTMLSpanElement>(null);
  requested.current = level;

  useEffect(() => {
    if (ready.current.has(level)) { setShown(level); setFailed(false); return; }
    if (!failures.current.has(level)) return;
    setFailed(true);
    if ((attempts[level] || 0) >= 2) return;
    const timer = setTimeout(() => {
      failures.current.delete(level);
      setFailed(false);
      setAttempts(previous => ({ ...previous, [level]: (previous[level] || 0) + 1 }));
    }, 1500);
    return () => clearTimeout(timer);
  }, [level, failed, attempts]);
  useEffect(() => {
    const element = art.current;
    if (!animations || !pulse || !element || !element.animate || matchMedia("(prefers-reduced-motion: reduce)").matches || element.closest(".motion-paused")) return;
    const animation = element.animate([
      { transform: "rotate(0) scale(1)" },
      { transform: "rotate(-4deg) scale(.96,1.015)", offset: .22 },
      { transform: "rotate(3deg) scale(1.04,.99)", offset: .48 },
      { transform: "rotate(-1.3deg) scale(.99,1.01)", offset: .72 },
      { transform: "rotate(0) scale(1)" },
    ], { duration: 650, easing: "cubic-bezier(.16,1,.3,1)" });
    return () => animation.cancel();
  }, [pulse, animations]);

  return <span ref={art} className="stg-stage-art" role="img" aria-label={`第 ${level} 階段・${levelName(level)}`} data-art-stage={shown}>
    {STAGES.map(stage => <img
      key={stage}
      className={`stg-stage-image ${stage === shown ? "is-current" : ""}`}
      src={`/assets/tree-stages/tree-stage-${stage}.webp${attempts[stage] ? `?retry=${attempts[stage]}` : ""}`}
      alt=""
      aria-hidden="true"
      width={512}
      height={768}
      decoding="async"
      fetchPriority={stage === level ? "high" : "low"}
      onLoad={() => { ready.current.add(stage); failures.current.delete(stage); if (requested.current === stage) { setShown(stage); setFailed(false); } }}
      onError={() => { failures.current.add(stage); if (requested.current === stage) setFailed(true); }}
    />)}
    {failed && !ready.current.has(shown) && <img className="stg-stage-fallback" src="/assets/christmas-tree.webp" alt="" aria-hidden="true"/>}
  </span>;
}
