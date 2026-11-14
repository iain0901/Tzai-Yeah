"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createTreeShakeState, detectTreeShake } from "@/lib/tree-shake";

export type TreeShakeStatus = "idle" | "listening" | "denied" | "unavailable" | "paused";
type MotionPermissionClass = typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
const IDLE_MESSAGE = "可以輕輕左右搖，也可以直接點按耶誕樹。";

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
    if (mounted.current) { setStatus("paused"); setMessage("搖動已暫停，點按一樣可以讓樹長大。"); }
  }, [detach]);

  const start = useCallback(async () => {
    if (!enabled || !mounted.current || pending.current || active.current) return;
    if (document.visibilityState !== "visible") { setStatus("paused"); setMessage("回到遊戲後，按一下就能繼續搖樹。"); return; }
    const motion = window.DeviceMotionEvent as MotionPermissionClass | undefined;
    if (!window.isSecureContext || !motion) { setStatus("unavailable"); setMessage("這個瀏覽器無法感應搖動，直接點按耶誕樹也能玩。"); return; }
    detach();
    const run = generation.current;
    pending.current = true;
    try {
      if (typeof motion.requestPermission === "function") {
        // Do not defer this call: iOS requires this same user-activation turn.
        const permission = motion.requestPermission();
        setMessage("請允許動作感測，或直接點按耶誕樹。");
        const result = await permission;
        if (!mounted.current || generation.current !== run) return;
        if (result !== "granted") { pending.current = false; setStatus("denied"); setMessage("沒有開啟動作感測，點按耶誕樹一樣可以玩。"); return; }
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
          setMessage("輕輕左右搖一搖，或點按耶誕樹。");
        }
        if (result.shake) callback.current();
      };
      listener.current = onMotion;
      window.addEventListener("devicemotion", onMotion, { passive: true });
      setStatus("listening"); setMessage("正在感應手機動作，也可以先點按耶誕樹。");
      availabilityTimer.current = setTimeout(() => {
        if (!mounted.current || generation.current !== run || receivedData) return;
        detach(); setStatus("unavailable"); setMessage("目前沒有收到動作感測，直接點按耶誕樹就能繼續玩。");
      }, 3000);
    } catch {
      if (!mounted.current || generation.current !== run) return;
      detach(); setStatus("denied"); setMessage("暫時無法開啟動作感測，點按耶誕樹一樣可以玩。");
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
