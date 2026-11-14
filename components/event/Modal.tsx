"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
export default function Modal({ title, onClose, children, className = "" }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useCallback(() => {
    if (closeTimer.current) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || document.querySelector(".love-app.motion-paused")) { onClose(); return; }
    setClosing(true);
    closeTimer.current = setTimeout(onClose, 220);
  }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const cancel = (e: Event) => { e.preventDefault(); dismiss(); };
    dialog.addEventListener("cancel", cancel);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { if (closeTimer.current) clearTimeout(closeTimer.current); dialog.removeEventListener("cancel", cancel); dialog.close(); document.body.style.overflow = previousOverflow; };
  }, [dismiss]);
  return <dialog ref={ref} className={`event-modal ${className} ${closing ? "is-closing" : ""}`} aria-label={title} onClick={e => { if (e.target === e.currentTarget) dismiss(); }}>
    <button className="icon-button modal-close" aria-label="關閉" onClick={dismiss}><X size={22}/></button>{children}
  </dialog>;
}
