"use client";
import Link from "next/link";
import { useState } from "react";
import { ProviderButtons } from "@/components/auth/AuthShell";
import { api, ApiError } from "@/lib/api";

export default function ForgotPage() {
  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"email" | "recovery">("email");

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/auth/password/forgot", { json: { identifier } });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "Too many attempts. Try again later." : "If an account exists for those details, we sent a reset code.");
      setSent(true);
    } finally { setBusy(false); }
  };

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "email") {
        await api("/auth/password/reset", { json: { identifier, code, password } });
      } else {
        await api("/auth/password/recovery", { json: { identifier, recovery_code: recovery, password } });
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That code didn't match or has expired");
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <>
        <h1 className="font-display text-3xl font-medium tracking-tight">Password updated</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--text2)" }}>You can sign in with your new password now.</p>
        <Link href="/login" className="btn btn-primary mt-8 flex h-12 w-full items-center justify-center">Back to sign in</Link>
      </>
    );
  }

  return (
    <>
      <Link href="/login" className="text-sm" style={{ color: "var(--text2)" }}>← Back to sign in</Link>
      <h1 className="mt-4 font-display text-3xl font-medium tracking-tight">Forgot your password?</h1>
      <p className="mt-3 text-sm" style={{ color: "var(--text2)" }}>
        Reset with a 6-digit email code, a one-time recovery code, or sign in with GitHub and then set a new password.
      </p>
      <div className="mt-6">
        <ProviderButtons enabled={{ github: true }} />
        <p className="mt-2 text-center text-xs" style={{ color: "var(--faint)" }}>GitHub sign-in only works after the owner adds an OAuth app. Then use Set a new password.</p>
      </div>
      <div className="mt-6 flex gap-2 text-sm">
        <button type="button" className="underline" onClick={() => setMode("email")}>Email code</button>
        <span style={{ color: "var(--faint)" }}>·</span>
        <button type="button" className="underline" onClick={() => setMode("recovery")}>Recovery code</button>
      </div>
      {mode === "email" && !sent && (
        <form onSubmit={requestCode} className="mt-4 space-y-4">
          <div>
            <label className="label" htmlFor="identifier">Email or username</label>
            <input id="identifier" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
          </div>
          <button className="btn btn-primary h-12 w-full" disabled={busy}>{busy ? "Sending…" : "Send reset code"}</button>
        </form>
      )}
      {mode === "email" && sent && (
        <form onSubmit={confirm} className="mt-4 space-y-4">
          <p className="text-sm" style={{ color: "var(--text2)" }}>If an account exists for those details, we sent a 6-digit code. It expires in 15 minutes and can be used once.</p>
          <div>
            <label className="label" htmlFor="code">Reset code</label>
            <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required minLength={6} maxLength={6} />
          </div>
          <div>
            <label className="label" htmlFor="password">New password</label>
            <input id="password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} />
          </div>
          {error && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
          <button className="btn btn-primary h-12 w-full" disabled={busy}>{busy ? "Updating…" : "Set new password"}</button>
        </form>
      )}
      {mode === "recovery" && (
        <form onSubmit={confirm} className="mt-4 space-y-4">
          <div>
            <label className="label" htmlFor="identifier2">Email or username</label>
            <input id="identifier2" className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="recovery">Recovery code</label>
            <input id="recovery" className="input" value={recovery} onChange={(e) => setRecovery(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="password2">New password</label>
            <input id="password2" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} />
          </div>
          {error && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
          <button className="btn btn-primary h-12 w-full" disabled={busy}>{busy ? "Updating…" : "Set new password"}</button>
        </form>
      )}
    </>
  );
}
