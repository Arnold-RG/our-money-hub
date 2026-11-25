"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Divider, ProviderButtons } from "@/components/auth/AuthShell";
import { api, ApiError } from "@/lib/api";

interface AuthConfig {
  registration_mode: string;
  owner_setup: boolean;
  providers: { github?: boolean };
  private?: boolean;
  signup_enabled?: boolean;
}

export default function SignupPage() {
  const router = useRouter();
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    api<AuthConfig>("/auth/config").then(setCfg).catch(() => setCfg({
      registration_mode: "closed", owner_setup: false, providers: { github: false },
      private: true, signup_enabled: false,
    }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cfg && !cfg.signup_enabled) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ mfa_enrolment_required: boolean; recovery_codes: string[] | null }>("/auth/register", {
        json: { username, email, password, display_name: fullName },
      });
      if (r.recovery_codes?.length) setCodes(r.recovery_codes);
      else if (r.mfa_enrolment_required) router.push("/verify?enrol=1");
      else router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the account");
    } finally { setBusy(false); }
  };

  if (codes) {
    return (
      <>
        <h1 className="font-display text-3xl font-medium tracking-tight">Save your recovery codes</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--text2)" }}>
          Store these somewhere safe. Each code can be used once to reset your password or sign in if you lose your authenticator.
        </p>
        <ul className="mt-6 grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((c) => <li key={c} className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--s1)" }}>{c}</li>)}
        </ul>
        <button className="btn btn-primary mt-8 h-12 w-full" onClick={() => router.push("/dashboard")}>I have saved these codes</button>
      </>
    );
  }

  if (!cfg) return null;
  const closed = !cfg.signup_enabled;

  return (
    <>
      <Link href="/login" className="text-sm" style={{ color: "var(--text2)" }}>← Back to sign in</Link>
      <h1 className="mt-4 font-display text-3xl font-medium tracking-tight">Create account</h1>
      {closed ? (
        <p className="mt-2 text-sm" style={{ color: "var(--text2)" }} role="status">
          Sign-ups are off because this app is private.
        </p>
      ) : (
        <p className="mt-2 text-sm" style={{ color: "var(--text2)" }}>Username, email and a password (12–128 characters). Email is not verified yet because no mail domain is set for that.</p>
      )}
      {closed && cfg.owner_setup && (
        <p className="mt-3 text-sm">Setting this instance up for the first time? <Link href="/setup" className="underline">Create the owner account</Link> with the one-time setup token.</p>
      )}
      <div className="mt-8" style={closed ? { opacity: 0.45 } : undefined}>
        <ProviderButtons enabled={closed ? { github: false } : (cfg.providers ?? { github: false })} />
      </div>
      <Divider label="or create an account with email" />
      <fieldset disabled={closed} className="min-w-0 border-0 p-0" style={closed ? { opacity: 0.45 } : undefined}>
        <legend className="sr-only">{closed ? "Sign-up form, disabled because this app is private" : "Create account"}</legend>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="username">Username</label>
            <input id="username" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} disabled={closed} />
          </div>
          <div>
            <label className="label" htmlFor="full_name">Full name</label>
            <input id="full_name" className="input" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required disabled={closed} />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={closed} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} disabled={closed} />
          </div>
          {error && <p role="alert" className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</p>}
          <button className="btn btn-primary h-12 w-full" disabled={closed || busy}>{busy ? "Creating…" : "Create account"}</button>
        </form>
      </fieldset>
    </>
  );
}
