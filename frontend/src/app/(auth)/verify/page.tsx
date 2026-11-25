"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApp } from "@/providers/app-provider";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { AuthenticatorQr } from "@/components/auth/AuthenticatorQr";

function VerifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refreshMe } = useApp();
  const enrol = params.get("enrol") === "1";
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startSetup = async () => {
    setError(null);
    try { setSetup(await api("/auth/mfa/setup", { method: "POST" })); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Could not start setup"); }
  };

  const done = async () => {
    await refreshMe();
    router.replace("/dashboard");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      if (enrol) {
        const r = await api<{ recovery_codes?: string[] }>("/auth/mfa/enable", { method: "POST", json: { code } });
        if (r.recovery_codes?.length) { setCodes(r.recovery_codes); setBusy(false); return; }
        return done();
      }
      if (backup) {
        await api("/auth/mfa/recovery", { method: "POST", json: { code } });
        return done();
      }
      await api("/auth/mfa/verify", { method: "POST", json: { code } });
      return done();
    } catch (err) {
      setCode("");
      setError(err instanceof ApiError && err.status === 429
        ? "Too many wrong codes. Sign in again later."
        : (backup ? "That backup code didn’t match" : "That code didn’t match"));
    } finally { setBusy(false); }
  };

  if (codes) {
    return (
      <>
        <h1 className="display text-3xl">Save your backup codes</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text2)" }}>Each code works once. Store them somewhere safe — Our Money Hub cannot email a reset.</p>
        <ul className="mt-6 grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((c) => <li key={c} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--s2)" }}>{c}</li>)}
        </ul>
        <Button className="mt-8 h-12 w-full" onClick={done}>I’ve saved these codes</Button>
      </>
    );
  }

  return (
    <>
      <Link href="/login" className="text-sm" style={{ color: "var(--text2)" }}>← Back to sign in</Link>
      <h1 className="mt-4 display text-3xl">{enrol ? "Set up two-step verification" : "Two-step verification"}</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text2)" }}>
        {enrol
          ? "Workspace owners must use an authenticator app before opening Our Money Hub."
          : "Enter the 6-digit code from your authenticator app."}
      </p>
      {enrol && !setup && <Button className="mt-8 h-12 w-full" onClick={startSetup}>Generate my secret</Button>}
      {enrol && setup && (
        <div className="mt-6 space-y-4 rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--s2)" }}>
          <div className="text-xs uppercase tracking-wide" style={{ color: "var(--faint)" }}>Scan this QR with your authenticator app</div>
          <AuthenticatorQr otpauthUri={setup.otpauth_uri} />
          <div>
            <div className="text-xs" style={{ color: "var(--faint)" }}>Can’t scan? Enter this key</div>
            <code className="mt-1 block break-all text-sm">{setup.secret}</code>
          </div>
          <a className="text-xs underline" href={setup.otpauth_uri}>Open in authenticator app</a>
        </div>
      )}
      {(!enrol || setup) && (
        <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
          <Field label={backup ? "Backup code" : "Verification code"} hint={backup ? undefined : `${code.length} of 6 digits entered · codes refresh every 30 seconds`}>
            {(id) => (
              <Input id={id} className="h-14 text-center text-2xl tracking-[0.4em]"
                inputMode={backup ? "text" : "numeric"} autoComplete="one-time-code"
                maxLength={backup ? 10 : 6}
                value={code} onChange={(e) => setCode(backup ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ""))}
                aria-invalid={!!error} autoFocus />
            )}
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" disabled={busy || (!backup && code.length !== 6)} className="h-12">{busy ? "Checking…" : "Verify"}</Button>
        </form>
      )}
      {!enrol && (
        <p className="mt-4 text-sm">
          <button type="button" className="underline" onClick={() => { setBackup((v) => !v); setCode(""); setError(null); }}>
            {backup ? "Use an authenticator code" : "Use a backup code"}
          </button>
        </p>
      )}
    </>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading…</p>}>
      <VerifyForm />
    </Suspense>
  );
}
