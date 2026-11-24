"use client";

import { useEffect } from "react";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog behaviour (WCAG 2.4.3 / 2.1.2): focus moves in, Tab is trapped, Esc closes,
 * the rest of the page is inert and does not scroll, and focus returns to the trigger on close.
 * The dialog must be rendered in a portal under <body> so its siblings can be made inert.
 */
export function useDialog(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void, portalRoot: () => HTMLElement | null) {
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const root = portalRoot();
    const others = Array.from(document.body.children).filter((el) => el !== root && !el.hasAttribute("inert")) as HTMLElement[];
    others.forEach((el) => el.setAttribute("inert", ""));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>("input,select,textarea") ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      others.forEach((el) => el.removeAttribute("inert"));
      document.body.style.overflow = overflow;
      trigger?.focus?.();
    };
  }, [open, onClose, ref, portalRoot]);
}

let portalEl: HTMLElement | null = null;
export function getPortal(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (!portalEl || !portalEl.isConnected) {
    portalEl = document.getElementById("omh-portal") ?? Object.assign(document.createElement("div"), { id: "omh-portal" });
    if (!portalEl.isConnected) document.body.appendChild(portalEl);
  }
  return portalEl;
}
