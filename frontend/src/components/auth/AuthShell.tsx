"use client";
import type { ReactNode } from "react";
import { Globe2, Landmark, ShieldCheck, Sparkles } from "lucide-react";
import { Wordmark } from "@/components/layout/logo";

const FEATURES = [
  { icon: Landmark, title: "Double-entry ledger, balanced to the last grosz and franc" },
  { icon: Globe2, title: "Official FX from NBP, with ECB and BNR as fallbacks" },
  { icon: Sparkles, title: "Personal P&L, budgets and future-project funding" },
  { icon: ShieldCheck, title: "Argon2id, two-step sign-in and an audit log" },
];

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]" data-app="omh">
      <section className="relative hidden flex-col border-r p-12 lg:flex" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between gap-4">
          <Wordmark />
        </div>
        <div className="mt-16 max-w-lg">
          <h1 className="display max-w-xl text-[52px] leading-[1.02]">Everything you earn, spend, budget and subscribe to.</h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed" style={{ color: "var(--text2)" }}>
            One ledger for złoty, francs, euros, dollars and pounds. Personal and Arnova Group books stay apart. This sign-in is only for Our Money Hub.
          </p>
          <ul className="mt-8 space-y-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3 text-sm">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: "var(--s2)", color: "var(--accent)" }}>
                  <f.icon size={16} />
                </span>
                <span className="pt-2">{f.title}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-auto pt-12 text-xs" style={{ color: "var(--faint)" }}>Created by Arnold Rurangwa / Arnova Group</p>
      </section>
      <section className="flex flex-col items-center justify-center px-5 py-12" style={{ background: "var(--bg)" }}>
        <div className="mb-10 lg:hidden"><Wordmark /></div>
        <div className="w-full max-w-[400px]">{children}</div>
        <p className="mt-10 text-xs lg:hidden" style={{ color: "var(--faint)" }}>Created by Arnold Rurangwa / Arnova Group</p>
      </section>
    </div>
  );
}

export function ProviderButtons({ enabled }: { enabled: { github?: boolean } }) {
  const on = Boolean(enabled.github);
  const start = async () => {
    if (!on) return;
    const { api } = await import("@/lib/api");
    const r = await api<{ authorization_url: string }>("/auth/oauth/github/start", { method: "POST" });
    window.location.href = r.authorization_url;
  };
  return (
    <div className="space-y-2.5">
      <button type="button" onClick={start} disabled={!on} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: "var(--surface)", borderColor: "var(--border)", color: "inherit" }}
        aria-label="Continue with GitHub">
        <GitHubMark /> Continue with GitHub
      </button>
      {!on && (
        <p className="text-center text-xs" style={{ color: "var(--faint)" }}>GitHub sign-in stays off until the owner adds a GitHub OAuth app.</p>
      )}
    </div>
  );
}

export function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

export function Divider({ label = "or with email" }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs" style={{ color: "var(--faint)" }}>
      <span className="h-px flex-1" style={{ background: "var(--border)" }} />
      {label}
      <span className="h-px flex-1" style={{ background: "var(--border)" }} />
    </div>
  );
}
