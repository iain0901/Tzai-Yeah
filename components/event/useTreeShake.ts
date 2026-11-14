"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createTreeShakeState, detectTreeShake } from "@/lib/tree-shake";

export type TreeShakeStatus = "idle" | "listening" | "denied" | "unavailable" | "paused";
type MotionPermissionClass = typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
const IDLE_MESSAGE = "輕輕左右搖動手機，把星光送給小樹。";

/**
 * Motion is optional. Call start directly from a click, never from an effect.
 * https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static
 * https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/accelerationIncludingGravity
 */
export function useTreeShake({ onShake, enabled }: { onShake: () => void; enabled: boolean }) {
  const [status, setStatus] = useState<TreeShakeStatus>("idle");
  const [message, setMessage] = useState(IDLE_MESSAGE);
  const callback = useRef(onShake);
  const mounted = useRef(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const active = useRef(false);
  const listener = useRef<((event: DeviceMotionEvent) => void) | null>(null);
  const availabilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { callback.current = onShake; }, [onShake]);
  const detach = useCallback(() => {
    generation.current += 1; pending.current = false; active.current = false;
    if (listener.current) window.removeEventListener("devicemotion", listener.current);
    listener.current = null;
    if (availabilityTimer.current) clearTimeout(availabilityTimer.current);
    availabilityTimer.current = null;
  }, []);
  const stop = useCallback(() => {
    detach();
    if (mounted.current) { setStatus("paused"); setMessage("搖動已暫停，小樹會等你回來。"); }
  }, [detach]);

  const start = useCallback(async () => {
    if (!enabled || !mounted.current || pending.current || active.current) return;
    if (document.visibilityState !== "visible") { setStatus("paused"); setMessage("回到遊戲後，就能繼續開啟搖動。"); return; }
    const motion = window.DeviceMotionEvent as MotionPermissionClass | undefined;
    if (!window.isSecureContext || !motion) { setStatus("unavailable"); setMessage("這個裝置暫時聽不到搖動。小樹會在這裡陪你。"); return; }
    detach();
    const run = generation.current;
    pending.current = true;
    try {
      if (typeof motion.requestPermission === "function") {
        // Do not defer this call: iOS requires this same user-activation turn.
        const permission = motion.requestPermission();
        setMessage("允許動作感測，就能把搖動變成星光。");
        const result = await permission;
        if (!mounted.current || generation.current !== run) return;
        if (result !== "granted") { pending.current = false; setStatus("denied"); setMessage("搖動尚未開啟，沒關係，我們慢慢來。"); return; }
      }
      if (!mounted.current || generation.current !== run || document.visibilityState !== "visible") return;
      pending.current = false; active.current = true;
      let detector = createTreeShakeState();
      let receivedData = false;
      const onMotion = (event: DeviceMotionEvent) => {
        if (!active.current || generation.current !== run || document.visibilityState !== "visible") return;
        const angle = window.screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
        const result = detectTreeShake(detector, {
          at: performance.now(), acceleration: event.acceleration,
          includingGravity: event.accelerationIncludingGravity,
          horizontalAxis: Math.abs(Math.round(angle / 90)) % 2 ? "y" : "x",
        });
        detector = result.state;
        if (result.usable && !receivedData) {
          receivedData = true;
          if (availabilityTimer.current) clearTimeout(availabilityTimer.current);
          availabilityTimer.current = null;
          setMessage("輕輕左右搖一搖，感受小樹的回應。");
        }
        if (result.shake) callback.current();
      };
      listener.current = onMotion;
      window.addEventListener("devicemotion", onMotion, { passive: true });
      setStatus("listening"); setMessage("正在聽你的節奏，試著輕輕左右搖動。");
      availabilityTimer.current = setTimeout(() => {
        if (!mounted.current || generation.current !== run || receivedData) return;
        detach(); setStatus("unavailable"); setMessage("暫時沒有收到手機動作。小樹仍在這裡，等你的星光。");
      }, 3000);
    } catch {
      if (!mounted.current || generation.current !== run) return;
      detach(); setStatus("denied"); setMessage("這次沒有連上手機動作，稍後可以再試一次。");
    }
  }, [enabled, detach]);

  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => { if (document.visibilityState === "hidden" && (active.current || pending.current)) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { mounted.current = false; document.removeEventListener("visibilitychange", onVisibility); detach(); };
  }, [detach, stop]);
  useEffect(() => {
    if (enabled) return;
    const shouldPause = active.current || pending.current;
    detach();
    if (!shouldPause) return;
    // Listener teardown is immediate; the status notification is lifecycle-safe.
    const notify = setTimeout(() => { if (mounted.current) { setStatus("paused"); setMessage("搖動已暫停，回到遊戲後可以重新開啟。"); } }, 0);
    return () => clearTimeout(notify);
  }, [enabled, detach]);

  return { status, start, stop, message };
}
export default useTreeShake;
