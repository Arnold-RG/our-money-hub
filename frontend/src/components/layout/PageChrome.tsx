"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ChromeSlot({ className }: { className?: string }) {
  return <div id="page-chrome-slot" className={className} />;
}

export function ChromePortal({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setSlot(document.getElementById("page-chrome-slot")); }, []);
  if (!slot) return <div className="mb-4 flex min-w-0 items-center gap-3">{children}</div>;
  return createPortal(children, slot);
}
