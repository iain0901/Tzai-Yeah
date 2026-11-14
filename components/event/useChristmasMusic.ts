"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Audio stays mounted while the app changes rooms; only a gesture starts it. */
export default function useChristmasMusic(suspended: boolean) {
  const ref = useRef<HTMLAudioElement>(null);
  const wanted = useRef(false); const interrupted = useRef(suspended); const generation = useRef(0);
  const [enabled, setEnabled] = useState(false); const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const start = useCallback(async () => {
    const audio = ref.current;
    if (!audio || !wanted.current || interrupted.current || document.hidden) return;
    const version = ++generation.current;
    if (audio.error) audio.load();
    audio.volume = .28; audio.loop = true; setLoading(true); setError("");
    try { await audio.play(); if (version !== generation.current && (!wanted.current || interrupted.current || document.hidden)) audio.pause(); }
    catch { if (version === generation.current) { wanted.current = false; setEnabled(false); setPlaying(false); setError("音樂還沒開始，點一下喇叭再試試。"); } }
    finally { if (version === generation.current) setLoading(false); }
  }, []);
  const toggle = useCallback(() => {
    if (wanted.current) { wanted.current = false; generation.current++; ref.current?.pause(); setEnabled(false); setPlaying(false); setLoading(false); setError(""); }
    else { wanted.current = true; setEnabled(true); void start(); }
  }, [start]);
  useEffect(() => {
    const audio = ref.current;
    const play = () => { setPlaying(true); setLoading(false); };
    const pause = () => setPlaying(false);
    const failure = () => { wanted.current = false; setEnabled(false); setPlaying(false); setLoading(false); setError("音樂暫時無法載入，點一下喇叭重試。"); };
    const visibility = () => { if (document.hidden) { generation.current++; audio?.pause(); setLoading(false); } else void start(); };
    audio?.addEventListener("playing", play); audio?.addEventListener("pause", pause); audio?.addEventListener("error", failure);
    document.addEventListener("visibilitychange", visibility);
    return () => { generation.current++; wanted.current = false; audio?.pause(); audio?.removeEventListener("playing", play); audio?.removeEventListener("pause", pause); audio?.removeEventListener("error", failure); document.removeEventListener("visibilitychange", visibility); };
  }, [start]);
  useEffect(() => { interrupted.current = suspended; if (suspended) { generation.current++; ref.current?.pause(); } else void start(); }, [suspended, start]);
  return { ref, enabled, playing, loading, error, toggle };
}
