"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, ChevronDown, LogOut, Moon, Search, Sun, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/providers/app-provider";
import { SWITCHER_CURRENCIES, type Currency } from "@/lib/money";
import { cx } from "@/components/ui";
import { GROUPS, MORE, NAV } from "./nav";
import { Wordmark, Logo } from "./logo";
import { CommandPalette } from "./command-palette";
import { ChromeSlot } from "./PageChrome";
import { useWs } from "@/lib/hooks";
import type { BudgetView, Summary, Txn } from "@/lib/api";
import { Plus } from "lucide-react";

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

interface RateRow {
  base: string; quote: string; rate: string; effective_date: string | null;
  source: string | null; stale?: boolean; provider?: string | null;
}

function rateLine(code: Currency, rates: RateRow[] | undefined): { text: string; stale: boolean; empty: boolean } {
  if (code === "PLN") return { text: "Reporting default · Polish złoty", stale: false, empty: false };
  const rows = rates ?? [];
  const hit = rows.find((r) => (r.base === code && r.quote === "PLN") || (r.base === "PLN" && r.quote === code))
    ?? rows.find((r) => r.base === code || r.quote === code);
  if (!hit || !hit.rate) return { text: "No official rate on file", stale: false, empty: true };
  const src = hit.source || hit.provider || "official";
  const date = hit.effective_date ?? "date unknown";
  const stale = Boolean(hit.stale);
  return {
    text: `${hit.rate} ${hit.base}→${hit.quote} · ${src} · ${date}${stale ? " · older than 2 Polish business days" : ""}`,
    stale,
    empty: false,
  };
}

export function CurrencyLens({ compact }: { compact?: boolean }) {
  const { currency, setCurrency } = useApp();
  const { data: rates } = useWs<RateRow[]>("/exchange-rates");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const current = rateLine(currency, rates);
  return (
    <div ref={ref} className={cx("relative", compact && "scale-95")}>
      <button
        type="button"
        className="flex h-11 items-center gap-2 rounded-full border border-line bg-surface-2 px-3 text-sm font-medium"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Reporting currency"
        onClick={() => setOpen((v) => !v)}
      >
        {currency}
        <ChevronDown size={14} className="text-faint" />
      </button>
      {open && (
        <div className="glass absolute right-0 top-12 z-50 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl p-1.5 shadow-2xl" role="listbox" aria-label="Reporting currency">
          {SWITCHER_CURRENCIES.map((c) => {
            const info = rateLine(c as Currency, rates);
            return (
              <button
                key={c}
                role="option"
                aria-selected={c === currency}
                onClick={() => { setCurrency(c as Currency); setOpen(false); }}
                className={cx("flex w-full flex-col items-start rounded-xl px-3 py-2.5 text-left text-sm hover:bg-surface-3", c === currency && "bg-surface-3")}
              >
                <span className="font-medium">{c}</span>
                <span className={cx("mt-0.5 text-xs", info.stale ? "text-warning" : "text-faint")}>{info.text}</span>
              </button>
            );
          })}
          {(!rates || rates.length === 0) && (
            <p className="px-3 py-2 text-xs text-faint">No official rates on file yet. Sync from NBP (or ECB/BNR) in Settings. We never show sample rates.</p>
          )}
          {current.stale && (
            <p className="px-3 py-2 text-xs text-warning">The {currency} rate is older than 2 Polish business days. Amounts still convert, and the date is shown.</p>
          )}
        </div>
      )}
    </div>
  );
}


export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, theme, toggleTheme, signOut, setPaletteOpen } = useApp();
  const { data: s } = useWs<Summary>("/reports/summary", true);
  const { data: txns } = useWs<Txn[]>("/transactions?limit=100");
  const pendingTx = (txns ?? []).filter((t) => t.status === "pending" || t.status === "failed").length;
  const budgetAlerts = (s?.budgets ?? []).filter((b: BudgetView) => b.state !== "on_track").length;
  const counts: Record<string, number> = { pending_txns: pendingTx, budget_alerts: budgetAlerts };
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
  const initials = me?.display_name?.split(" ").map((p) => p[0]).join("").slice(0, 2) ?? "AR";

  return (
    <div className="app-shell">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink">
        Skip to content
      </a>
      <aside className="side hidden lg:flex">
        <div className="logo px-1 pb-4"><Wordmark /></div>
        <div className="logo-type px-1 pb-3"><WorkspaceSwitcher /></div>
        <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto">
          {GROUPS.map((g) => (
            <div key={g}>
              <div className="sec-label eyebrow px-3 pb-1.5 pt-3">{g}</div>
              {NAV.filter((n) => n.group === g).map((n) => {
                const { href, label, icon: Icon } = n;
                const countKey = "countKey" in n ? n.countKey : undefined;
                const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
                const count = countKey ? counts[countKey] : 0;
                return (
                  <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cx("nav-link", active && "on")} title={label}>
                    <Icon size={18} strokeWidth={active ? 2.3 : 1.8} />
                    <span className="logo-type">{label}</span>
                    {count > 0 && <span className="cnt" aria-label={`${count} needing attention`}>{count}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="me mt-auto flex items-center gap-2.5 border-t pt-3" style={{ borderColor: "var(--border)", color: "var(--side-text)" }}>
          <div className="grid h-9 w-9 place-items-center rounded-[10px] text-xs font-bold" style={{ background: "var(--s3)", color: "var(--text)" }}>{initials}</div>
          <div className="me-copy min-w-0 flex-1 text-xs">
            <div className="truncate font-medium">{me?.display_name}</div>
            <div className="truncate" style={{ color: "var(--side-text)" }}>{me?.is_demo ? "Demo · private" : me?.email}</div>
          </div>
          <button onClick={signOut} className="grid size-9 place-items-center rounded-lg text-muted hover:text-ink" aria-label="Sign out"><LogOut size={16} /></button>
        </div>
        <p className="credit pt-2 text-[10.5px]" style={{ color: "var(--side-text)" }}>Created by Arnold Rurangwa / Arnova Group</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col" style={{ background: "var(--bg)" }}>
        <header className="top flex flex-wrap items-center gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:gap-3 md:px-6">
          <div className="lg:hidden shrink-0"><Logo size={32} /></div>
          <ChromeSlot className="order-last flex w-full min-w-0 flex-col gap-3 lg:order-none lg:flex-1 lg:flex-row lg:items-center" />
          <button onClick={() => setPaletteOpen(true)} className="search-field hidden md:flex" aria-label="Search (Ctrl+K)">
            <Search size={16} />
            <span className="flex-1 text-left">Search…</span>
            <span className="kbd">⌘K</span>
          </button>
          <CurrencyLens compact />
          <button onClick={toggleTheme} className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-surface-2 text-ink hover:bg-surface-3" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>
        <main id="main" className="dock-safe flex min-h-0 flex-1 flex-col gap-4 px-4 pt-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:px-6">{children}</main>
      </div>

      <MobileDock onSearch={() => setPaletteOpen(true)} budgetAlerts={budgetAlerts} />
      <CommandPalette />
    </div>
  );
}

function MobileDock({ onSearch, budgetAlerts }: { onSearch: () => void; budgetAlerts: number }) {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const HomeIcon = NAV[0].icon;
  const ActivityIcon = NAV[2].icon;
  const BudgetIcon = NAV[3].icon;
  return (
    <>
      <nav aria-label="Main" className="tabbar lg:hidden">
        <Link href="/dashboard" className={cx("tab", pathname === "/dashboard" && "on")} aria-current={pathname === "/dashboard" ? "page" : undefined}>
          <HomeIcon size={18} /><span className="tab-label">Home</span>
        </Link>
        <Link href="/transactions" className={cx("tab", pathname.startsWith("/transactions") && "on")} aria-current={pathname.startsWith("/transactions") ? "page" : undefined}>
          <ActivityIcon size={18} /><span className="tab-label">Activity</span>
        </Link>
        <button type="button" className="tab" aria-label="Add" onClick={() => setMore(true)}>
          <span className="tab-new grid place-items-center"><Plus size={22} strokeWidth={2.4} /></span>
        </button>
        <Link href="/budgets" className={cx("tab", pathname.startsWith("/budgets") && "on")} aria-current={pathname.startsWith("/budgets") ? "page" : undefined}>
          <span className="relative">
            <BudgetIcon size={18} />
            {budgetAlerts > 0 && <span className="tbadge">{budgetAlerts}</span>}
          </span>
          <span className="tab-label">Budgets</span>
        </Link>
        <button type="button" className="tab" aria-label="Search" onClick={onSearch}>
          <Search size={18} /><span className="tab-label">Search</span>
        </button>
      </nav>
      {more && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden" onClick={() => setMore(false)}>
          <div className="card w-full min-w-0 max-w-md p-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Create or go to">
            <div className="mb-3 flex gap-2">
              <Link href="/transactions" className="btn btn-primary flex-1" onClick={() => setMore(false)}>Add payment</Link>
              <Link href="/accounts" className="btn flex-1" onClick={() => setMore(false)}>Add account</Link>
            </div>
            <div className="more-grid">
              {MORE.map((n) => (
                <Link key={n.href} href={n.href} onClick={() => setMore(false)} className="more-grid-item">
                  <n.icon size={18} style={{ color: "var(--primary-text)" }} />
                  {n.label}
                </Link>
              ))}
            </div>
            <button className="btn mt-3 w-full" onClick={() => setMore(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
