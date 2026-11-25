"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Divider, ProviderButtons } from "@/components/auth/AuthShell";
import { api, ApiError } from "@/lib/api";

interface AuthConfig {
  registration_mode: string;
  owner_setup: boolean;
  providers: { github?: boolean }; signup_enabled?: boolean; private?: boolean;
}

const GENERIC = "Email or password is incorrect";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<AuthConfig | null>(null);

  useEffect(() => {
    api<AuthConfig>("/auth/config").then(setCfg).catch(() => setCfg({
      registration_mode: "closed", owner_setup: false, providers: { github: false },
    }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ mfa_required: boolean; mfa_enrolment_required: boolean; user: { role: string } | null }>("/auth/login", { json: { identifier, password } });
      if (r.mfa_enrolment_required) router.push("/verify?enrol=1");
      else if (r.mfa_required) router.push("/verify");
      else router.push("/dashboard");
    } catch (err) {
      // One generic message for unknown email, wrong password and lockout-adjacent failures.
      setError(err instanceof ApiError && err.status === 429 ? "Too many attempts. Try again later." : GENERIC);
    } finally { setBusy(false); }
  };

  return (
    <>
      <h1 className="font-display text-3xl font-medium tracking-tight">Sign in to Our Money Hub</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text2)" }}>Welcome back. Use your email, username, or GitHub. This sign-in is only for Our Money Hub.</p>
      <div className="mt-8">
        <ProviderButtons enabled={cfg?.providers ?? { github: false }} />
      </div>
      <Divider />
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="identifier">Email or username</label>
          <input id="identifier" className="input" type="text" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        </div>
        <div>
          <label className="label flex items-center justify-between" htmlFor="password">
            Password
            <Link href="/forgot" className="text-xs font-medium" style={{ color: "var(--accent)" }}>Forgot password?</Link>
          </label>
          <div className="relative">
            <input id="password" className="input pr-20" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button type="button" className="absolute right-2 top-1/2 min-h-11 min-w-11 -translate-y-1/2 text-xs" style={{ color: "var(--text2)" }} aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((v) => !v)}>{show ? "Hide" : "Show"}</button>
          </div>
        </div>
        {error && <p role="alert" className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 12%, transparent)" }}>{error}</p>}
        <button className="btn btn-primary h-12 w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="mt-6 flex items-start gap-2 text-xs" style={{ color: "var(--text2)" }}>
        {cfg?.signup_enabled ? (
          <>Need an account? <Link href="/signup" className="underline">Create account</Link>.</>
        ) : (
          <>This app is private and owner-only.</>
        )}
        {cfg?.owner_setup && <>{" "}If you are setting this instance up, <Link href="/setup" className="underline">use the owner setup form</Link>.</>}
      </p>
    </>
  );
}
