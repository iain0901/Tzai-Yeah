"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export default function Modal({ title, onClose, children, className = "" }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const cancel = (e: Event) => { e.preventDefault(); onClose(); };
    dialog.addEventListener("cancel", cancel);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.removeEventListener("cancel", cancel); dialog.close(); document.body.style.overflow = previousOverflow; };
  }, [onClose]);
  return <dialog ref={ref} className={`event-modal ${className}`} aria-label={title} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <button className="icon-button modal-close" aria-label="關閉" onClick={onClose}><X size={22}/></button>{children}
  </dialog>;
}
