"use client";
import { useEffect, useRef } from "react";

export default function useTreeSound() {
  const audio = useRef<AudioContext | null>(null);
  const enabled = useRef(false);
  useEffect(() => () => {
    const context = audio.current;
    audio.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);
  function unlock() {
    if (!enabled.current) return;
    try {
      const Context = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      const context = audio.current ??= new Context();
      if (context.state !== "running") void context.resume().catch(() => {});
    } catch { /* optional sound must never block play */ }
  }
  function toggle(value: boolean) {
    enabled.current = value;
    if (value) unlock();
    else if (audio.current?.state === "running") void audio.current.suspend().catch(() => {});
  }
  function chime() {
    const context = audio.current;
    if (!enabled.current || context?.state !== "running") return;
    try {
      [659.25, 987.77].forEach((frequency, i) => {
        const start = context.currentTime + i * .055;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, start);
        gain.gain.exponentialRampToValueAtTime(.055, start + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .23);
        oscillator.connect(gain).connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start);
        oscillator.stop(start + .24);
      });
    } catch { /* audio subsystem can be interrupted on mobile */ }
  }
  return { unlock, toggle, chime };
}
