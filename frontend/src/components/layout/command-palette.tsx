"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPortal, useDialog } from "@/lib/use-dialog";
import { useIsDesktop, useVisualViewportBox } from "@/lib/visual-viewport";
import { ArrowRight, Plus, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/providers/app-provider";
import { NAV } from "./nav";
import { cx } from "@/components/ui";

interface Hit { type: string; id: string; title: string; subtitle: string; href: string }

const ACTIONS = [
  { title: "Add a transaction", href: "/transactions?new=1", hint: "Income, expense or transfer" },
  { title: "Add an account", href: "/accounts?new=1", hint: "Bank, MoMo, cash, IKE…" },
  { title: "Add a subscription", href: "/subscriptions?new=1", hint: "AI, hosting, domains, client plans" },
  { title: "Create a budget", href: "/budgets?new=1", hint: "Category or AI spend guard" },
  { title: "Import CSV", href: "/transactions?import=1", hint: "Preview first, duplicates skipped" },
  { title: "Sync official exchange rates", href: "/settings#rates", hint: "NBP · ECB · BNR" },
];

export function CommandPalette() {
  const { paletteOpen: open, setPaletteOpen: setOpen, workspace } = useApp();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const isDesktop = useIsDesktop();
  const vv = useVisualViewportBox();
  useEffect(() => setMounted(true), []);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useDialog(dialogRef, open, close, getPortal);

  useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setIdx(0);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim() || !workspace) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<Hit[]>(`/search?q=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([]));
    }, 140);
    return () => clearTimeout(t);
  }, [q, workspace]);

  const items = useMemo(() => {
    const ql = q.toLowerCase();
    const pages = NAV.filter((n) => !ql || n.label.toLowerCase().includes(ql)).map((n) => ({ key: n.href, title: n.label, hint: "Go to page", href: n.href, group: "Pages" }));
    const acts = ACTIONS.filter((a) => !ql || a.title.toLowerCase().includes(ql)).map((a) => ({ key: a.href, title: a.title, hint: a.hint, href: a.href, group: "Actions" }));
    const found = hits.map((h) => ({ key: h.type + h.id, title: h.title, hint: h.subtitle, href: h.href, group: h.type[0].toUpperCase() + h.type.slice(1) + "s" }));
    return [...found, ...acts, ...pages];
  }, [q, hits]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && items[idx]) go(items[idx].href);
  };

  const results = (
    <ul className="min-h-0 flex-1 overflow-y-auto p-2" role="listbox" aria-label="Results">
      {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{q}”.</li>}
      {items.map((it, i) => (
        <li key={it.key + i}>
          {(i === 0 || items[i - 1].group !== it.group) && <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-[0.14em] text-faint">{it.group}</div>}
          <button
            type="button"
            role="option"
            aria-selected={i === idx}
            onMouseEnter={() => setIdx(i)}
            onClick={() => go(it.href)}
            className={cx("flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left", i === idx && "bg-surface-3")}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">{it.group === "Actions" ? <Plus size={15} /> : <ArrowRight size={15} />}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{it.title}</span>
              <span className="block truncate text-xs text-faint">{it.hint}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        isDesktop ? (
          <motion.div className="fixed inset-0 z-[70] flex items-start justify-center px-3 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={close} aria-hidden />
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Search and commands"
              className="glass-solid relative flex max-h-[min(32rem,80dvh)] w-full max-w-xl flex-col overflow-hidden rounded-[24px] shadow-2xl"
              initial={{ y: -12, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: -8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
              <div className="flex items-center gap-3 border-b border-line px-4">
                <Search size={18} className="shrink-0 text-faint" />
                <input
                  ref={inputRef}
                  data-autofocus
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setIdx(0); }}
                  onKeyDown={onKeyDown}
                  placeholder="Search accounts, payments, subscriptions… or type a command"
                  aria-label="Search"
                  className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
                />
                <kbd className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-xs text-faint">ESC</kbd>
              </div>
              {results}
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            className="fixed inset-x-0 z-[70] flex flex-col bg-[var(--s1)]"
            style={{ top: vv.top, height: vv.height || "100dvh" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Search and commands"
              className="flex min-h-0 flex-1 flex-col pt-[max(0.5rem,env(safe-area-inset-top))]"
              initial={{ y: 16 }}
              animate={{ y: 0 }}
              exit={{ y: 12 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
              <div className="flex items-center gap-2 border-b border-line px-3">
                <Search size={18} className="shrink-0 text-faint" />
                <input
                  ref={inputRef}
                  data-autofocus
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setIdx(0); }}
                  onKeyDown={onKeyDown}
                  placeholder="Search or a command"
                  aria-label="Search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  className="h-12 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
                />
                <button
                  type="button"
                  onClick={close}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-ink"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {results}
              </div>
            </motion.div>
          </motion.div>
        )
      )}
    </AnimatePresence>,
    getPortal()!,
  );
}
