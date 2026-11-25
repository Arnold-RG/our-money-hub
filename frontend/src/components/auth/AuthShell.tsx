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
        <Wordmark />
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

export function ProviderButtons({ enabled }: { enabled: { google: boolean; apple: boolean } }) {
  return (
    <div className="space-y-2.5">
      <button type="button" disabled={!enabled.google} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: "var(--border)" }} aria-label="Continue with Google">
        <GoogleMark /> Continue with Google
      </button>
      <button type="button" disabled={!enabled.apple} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50" style={{ background: "var(--text)", color: "var(--bg)" }} aria-label="Continue with Apple">
        <AppleMark /> Continue with Apple
      </button>
      {(!enabled.google || !enabled.apple) && (
        <p className="text-center text-xs" style={{ color: "var(--faint)" }}>Google and Apple sign-in stay off until the owner adds client IDs.</p>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" fill="currentColor" aria-hidden="true">
      <path d="M12.73 9.55c.02 2.16 1.89 2.88 1.91 2.89-.02.05-.3 1.02-.98 2.02-.59.86-1.2 1.72-2.16 1.74-.94.02-1.24-.56-2.32-.56s-1.41.54-2.3.58c-.92.04-1.63-.93-2.23-1.79-1.23-1.76-2.17-4.97-.91-7.14.62-1.08 1.74-1.76 2.95-1.78.92-.02 1.78.62 2.32.62s1.54-.77 2.6-.66c.44.02 1.69.18 2.49 1.35-.06.04-1.49.87-1.47 2.73zM10.9 4.02c.5-.6.83-1.44.74-2.27-.71.03-1.57.47-2.08 1.07-.46.53-.86 1.39-.75 2.2.8.06 1.61-.41 2.09-1z"/>
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
