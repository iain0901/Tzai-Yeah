"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createTreeShakeState, detectTreeShake } from "@/lib/tree-shake";

export type TreeShakeStatus = "idle" | "listening" | "denied" | "unavailable" | "paused";
type MotionPermissionClass = typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
const IDLE_MESSAGE = "點選上方按鈕並允許動作感測，再左右搖動手機；也可以直接點小樹。";

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
    if (!window.isSecureContext) { setStatus("unavailable"); setMessage("搖動需要 HTTPS 安全連線，請用瀏覽器開啟安全網址；也可以點小樹收集星光。"); return; }
    if (!motion) { setStatus("unavailable"); setMessage("此瀏覽器不支援動作感測，請用 Safari 或 Chrome 開啟，或直接點小樹收集星光。"); return; }
    const policy = (document as Document & { permissionsPolicy?: { allowsFeature: (name: string) => boolean }; featurePolicy?: { allowsFeature: (name: string) => boolean } }).permissionsPolicy
      ?? (document as Document & { featurePolicy?: { allowsFeature: (name: string) => boolean } }).featurePolicy;
    if (policy && !policy.allowsFeature("accelerometer")) { setStatus("unavailable"); setMessage("網頁的動作感測權限受到限制，請用瀏覽器直接開啟；也可以點小樹收集星光。"); return; }
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
        if (result !== "granted") { pending.current = false; setStatus("denied"); setMessage("動作感測未獲允許。請檢查瀏覽器或 iPhone 的動作與方向存取設定；也可以點小樹收集星光。"); return; }
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
        detach(); setStatus("unavailable"); setMessage("沒有收到手機動作，請檢查瀏覽器感測權限，或改用 Safari／Chrome 開啟；也可以點小樹收集星光。");
      }, 3000);
    } catch {
      if (!mounted.current || generation.current !== run) return;
      detach(); setStatus("denied"); setMessage("無法開啟手機動作，請檢查瀏覽器感測權限後再試，或直接點小樹收集星光。");
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
