"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Divider, ProviderButtons } from "@/components/auth/AuthShell";
import { api, ApiError } from "@/lib/api";
import { useApp } from "@/providers/app-provider";
import { Button, ErrorNote, Field, Input } from "@/components/ui";

interface AuthConfig {
  demo_login: boolean;
  registration_mode: string;
  owner_setup: boolean;
  providers: { google: boolean; apple: boolean };
}

const GENERIC = "Email or password is incorrect";

export default function LoginPage() {
  const router = useRouter();
  const { refreshMe } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<AuthConfig | null>(null);

  useEffect(() => {
    api<AuthConfig>("/auth/config").then(setCfg).catch(() => setCfg({
      demo_login: false, registration_mode: "closed", owner_setup: false, providers: { google: false, apple: false },
    }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ mfa_required?: boolean; mfa_enrolment_required?: boolean }>("/auth/login", { method: "POST", json: { email, password } });
      if (r.mfa_enrolment_required) { router.push("/verify?enrol=1"); return; }
      if (r.mfa_required) { router.push("/verify"); return; }
      await refreshMe();
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "Too many attempts. Try again later." : GENERIC);
    } finally { setBusy(false); }
  };

  const tryDemo = async () => {
    setBusy(true); setError(null);
    try {
      await api("/auth/demo", { method: "POST" });
      await refreshMe();
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Demo sign-in is not available");
    } finally { setBusy(false); }
  };

  return (
    <>
      <h1 className="display text-3xl">Sign in to Our Money Hub</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text2)" }}>Welcome back. This account is only for Our Money Hub — RAGI uses a separate sign-in.</p>
      <div className="mt-8">
        <ProviderButtons enabled={cfg?.providers ?? { google: false, apple: false }} />
      </div>
      <Divider />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Password">
          {(id) => (
            <div className="relative">
              <Input id={id} type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-16" />
              <button type="button" className="absolute right-2 top-1/2 min-h-11 -translate-y-1/2 text-xs" style={{ color: "var(--text2)" }} aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((v) => !v)}>{show ? "Hide" : "Show"}</button>
            </div>
          )}
        </Field>
        <div className="flex justify-end">
          <Link href="/forgot" className="text-xs font-medium" style={{ color: "var(--accent)" }}>Forgot password?</Link>
        </div>
        <ErrorNote error={error} />
        <Button type="submit" disabled={busy} className="h-12">{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
      {cfg?.demo_login && (
        <div className="mt-6 border-t pt-6" style={{ borderColor: "var(--border)" }}>
          <Button variant="secondary" className="w-full" onClick={tryDemo} disabled={busy}>Explore a private demo</Button>
          <p className="mt-2 text-center text-xs" style={{ color: "var(--faint)" }}>A fresh, empty workspace just for you. No sample figures.</p>
        </div>
      )}
      <p className="mt-6 text-xs" style={{ color: "var(--text2)" }}>
        Accounts are by invite only. Have an invite link? Open it to create your account.
        {cfg?.owner_setup && <>{" "}If you are setting this instance up, <Link href="/setup" className="underline">use the owner setup form</Link>.</>}
      </p>
    </>
  );
}
