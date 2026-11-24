"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Building2, ChevronDown, LogOut, Moon, Search, Sun, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/providers/app-provider";
import { CURRENCIES, type Currency } from "@/lib/money";
import { cx } from "@/components/ui";
import { DOCK, NAV } from "./nav";
import { Wordmark, Logo } from "./logo";
import { CommandPalette } from "./command-palette";

function WorkspaceSwitcher() {
  const { me, workspace, setWorkspaceId } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  if (!me || !workspace) return null;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-11 items-center gap-2 rounded-full border border-line bg-surface-2 pl-2 pr-3 text-sm font-medium hover:bg-surface-3"
      >
        <span className={cx("grid size-7 place-items-center rounded-full", workspace.kind === "business" ? "bg-accent-2/20 text-accent-2" : "bg-accent/15 text-accent")}>
          {workspace.kind === "business" ? <Building2 size={15} /> : <User size={15} />}
        </span>
        <span className="max-w-[9rem] truncate">{workspace.name}</span>
        <ChevronDown size={14} className="text-faint" />
      </button>
      {open && (
        <ul role="listbox" aria-label="Workspaces" className="glass absolute left-0 top-12 z-50 w-64 rounded-2xl p-1.5 shadow-2xl">
          {me.workspaces.map((w) => (
            <li key={w.id}>
              <button
                role="option"
                aria-selected={w.id === workspace.id}
                onClick={() => {
                  setWorkspaceId(w.id);
                  setOpen(false);
                }}
                className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-surface-3", w.id === workspace.id && "bg-surface-3")}
              >
                {w.kind === "business" ? <Building2 size={16} className="text-accent-2" /> : <User size={16} className="text-accent" />}
                <span className="flex-1">
                  <span className="block font-medium">{w.name}</span>
                  <span className="block text-xs text-faint">{w.kind === "business" ? "Business books · isolated" : "Personal books · isolated"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CurrencyLens({ compact }: { compact?: boolean }) {
  const { currency, setCurrency } = useApp();
  return (
    <div role="radiogroup" aria-label="Reporting currency" className="relative inline-flex rounded-full border border-line bg-surface-2 p-1 text-xs">
      {CURRENCIES.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={c === currency}
          onClick={() => setCurrency(c as Currency)}
          className={cx("relative z-10 rounded-full font-semibold tracking-wide transition-colors", compact ? "h-9 px-2.5" : "h-9 px-3", c === currency ? "text-accent-ink" : "text-muted hover:text-ink")}
        >
          {c === currency && <motion.span layoutId="lens" className="absolute inset-0 -z-10 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          {c}
        </button>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, theme, toggleTheme, signOut, setPaletteOpen } = useApp();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setPaletteOpen]);

  return (
    <div className="min-h-dvh lg:pl-[272px]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[272px] flex-col border-r border-line bg-surface/60 px-4 py-6 backdrop-blur-xl lg:flex">
        <div className="px-2">
          <Wordmark />
        </div>
        <nav aria-label="Main" className="mt-8 flex flex-1 flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cx("relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors", active ? "text-ink" : "text-muted hover:bg-surface-2 hover:text-ink")}>
                {active && <motion.span layoutId="side-active" className="absolute inset-0 -z-0 rounded-xl border border-line-strong bg-surface-2" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                <Icon size={18} className={cx("relative", active && "text-accent")} />
                <span className="relative">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="rounded-2xl border border-line bg-surface-2/60 p-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-accent/15 text-sm font-semibold text-accent">{me?.display_name?.[0]?.toUpperCase() ?? "·"}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{me?.display_name}</div>
              <div className="truncate text-xs text-faint">{me?.is_demo ? "Demo · private, empty" : me?.email}</div>
            </div>
            <button onClick={signOut} className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-ink" aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
        <p className="mt-4 px-2 text-xs leading-relaxed text-faint">Created by Arnold Rurangwa / Arnova Group</p>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <div className="lg:hidden">
            <Logo size={30} />
          </div>
          <WorkspaceSwitcher />
          <div className="flex-1" />
          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden h-11 w-64 items-center gap-2 rounded-full border border-line bg-surface-2 px-4 text-sm text-faint hover:bg-surface-3 md:flex"
            aria-label="Search (Ctrl+K)"
          >
            <Search size={15} />
            <span className="flex-1 text-left">Search everything…</span>
            <kbd className="rounded-md border border-line px-1.5 text-xs" aria-hidden>Ctrl K</kbd>
          </button>
          <button onClick={() => setPaletteOpen(true)} className="grid size-11 place-items-center rounded-full border border-line bg-surface-2 text-muted md:hidden" aria-label="Search">
            <Search size={17} />
          </button>
          <div className="hidden sm:block">
            <CurrencyLens />
          </div>
          <button onClick={toggleTheme} className="grid size-11 place-items-center rounded-full border border-line bg-surface-2 text-muted hover:text-ink" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <main id="main" className="dock-safe mx-auto max-w-[1240px] px-4 pt-6 sm:px-6 lg:px-8">
        <motion.div key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
          {children}
        </motion.div>
        <footer className="mt-14 hidden border-t border-line py-6 text-xs text-faint lg:block">Our Money Hub · Created by Arnold Rurangwa / Arnova Group</footer>
      </main>

      {/* Mobile translucent dock (smartphones only) */}
      <nav aria-label="Main" className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 lg:hidden">
        <div className="glass mx-auto flex max-w-md items-center justify-between rounded-[26px] px-2 py-1.5 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.55)]">
          {DOCK.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href) || (href === "/more" && ["/accounts", "/subscriptions", "/reports", "/settings"].some((p) => pathname.startsWith(p)));
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} className="relative flex h-14 min-w-[44px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[20px] text-xs font-medium">
                {active && <motion.span layoutId="dock-active" className="absolute inset-1 rounded-[18px] bg-accent/15" transition={{ type: "spring", stiffness: 520, damping: 38 }} />}
                <Icon size={21} className={cx("relative", active ? "text-accent" : "text-muted")} strokeWidth={active ? 2.3 : 1.8} />
                <span className={cx("relative", active ? "text-ink" : "text-muted")}>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      <CommandPalette />
    </div>
  );
}
