"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Fingerprint, Globe2, Landmark, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useApp } from "@/providers/app-provider";
import { Button, ErrorNote, Field, Input, Segmented } from "@/components/ui";
import { Wordmark } from "@/components/layout/logo";

export default function LoginPage() {
  const router = useRouter();
  const { refreshMe } = useApp();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState(false);
  const [demo, setDemo] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [ownerSetup, setOwnerSetup] = useState(false);
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ demo_login: boolean; registration_open: boolean; owner_setup?: boolean }>("/auth/config")
      .then((c) => {
        setDemo(c.demo_login);
        setRegOpen(c.registration_open);
        setOwnerSetup(Boolean(c.owner_setup));
      })
      .catch(() => {});
  }, []);

  const done = async () => {
    await refreshMe();
    router.replace("/dashboard");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mfa) {
        await api("/auth/mfa/verify", { method: "POST", json: { code } });
        return done();
      }
      if (mode === "register") {
        await api("/auth/register", { method: "POST", json: { email, password, display_name: name, ...(ownerSetup ? { setup_token: setupToken } : {}) } });
        return done();
      }
      const r = await api<{ mfa_required?: boolean }>("/auth/login", { method: "POST", json: { email, password } });
      if (r.mfa_required) {
        setMfa(true);
        return;
      }
      return done();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tryDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/demo", { method: "POST" });
      await done();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Story side */}
      <section className="relative hidden overflow-hidden border-r border-line lg:block">
        <div className="aurora" aria-hidden />
        <div className="grid-bg absolute inset-0" aria-hidden />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Wordmark />
          <div>
            <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="display max-w-xl text-[56px] leading-[1.02]">
              Everything you earn, spend, budget and subscribe to.
            </motion.h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">
              One ledger for złoty, francs, euros and dollars. Personal and Arnova Group books kept apart. Every AI agent spends only what its budget allows.
            </p>
            <ul className="mt-10 grid max-w-lg grid-cols-2 gap-3 text-sm">
              {[
                { i: Landmark, t: "Double-entry ledger", d: "Balanced to the last grosz and franc" },
                { i: Globe2, t: "Official FX rates", d: "NBP, ECB and BNR, dated and sourced" },
                { i: Sparkles, t: "AI spend guard", d: "Reserve before a run, settle after" },
                { i: ShieldCheck, t: "Private by design", d: "Argon2id, 2-step sign-in, audit log" },
              ].map(({ i: Icon, t, d }) => (
                <li key={t} className="card flex gap-3 p-4">
                  <Icon size={18} className="mt-0.5 shrink-0 text-accent" />
                  <span>
                    <span className="block font-medium">{t}</span>
                    <span className="block text-xs text-muted">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-faint">Created by Arnold Rurangwa / Arnova Group</p>
        </div>
      </section>

      {/* Form side */}
      <section className="relative flex items-center justify-center px-5 py-12">
        <div className="aurora opacity-30 lg:hidden" aria-hidden />
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Wordmark />
          </div>
          <h2 className="display text-3xl">{mfa ? "Two-step sign-in" : mode === "signin" ? "Welcome back" : "Create your hub"}</h2>
          <p className="mt-2 text-sm text-muted">
            {mfa ? "Enter the 6-digit code from your authenticator app." : mode === "signin" ? (regOpen ? "Sign in, or create the owner account for this hub." : "Sign in to your books.") : (ownerSetup ? "One-time owner setup. " : "") + "Personal and Business workspaces are created, empty and ready."}
          </p>
          {!mfa && regOpen && (
            <div className="mt-6">
              <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: "signin", label: "Sign in" }, { value: "register", label: "Create account" }]} />
            </div>
          )}
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            {mfa ? (
              <Field label="Authenticator code">{(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />}</Field>
            ) : (
              <>
                {mode === "register" && ownerSetup && (
                  <Field label="Owner setup token" hint="The one-time token from the server environment">
                    {(id) => <Input id={id} type="password" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} autoComplete="off" required />}
                  </Field>
                )}
                {mode === "register" && <Field label="Your name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />}</Field>}
                <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />}</Field>
                <Field label="Password" hint={mode === "register" ? "At least 12 characters" : undefined}>
                  {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 12 : undefined} required />}
                </Field>
              </>
            )}
            <ErrorNote error={error} />
            <Button type="submit" disabled={busy} className="mt-1 h-11" icon={mfa ? <Fingerprint size={16} /> : <ArrowRight size={16} />}>
              {mfa ? "Verify" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
          {demo && !mfa && (
            <div className="mt-6 border-t border-line pt-6">
              <Button variant="secondary" className="w-full" onClick={tryDemo} disabled={busy}>
                Explore a private demo
              </Button>
              <p className="mt-2 text-center text-xs text-faint">A fresh, empty workspace just for you. No sample figures.</p>
            </div>
          )}
          <p className="mt-10 text-center text-xs text-faint lg:hidden">Created by Arnold Rurangwa / Arnova Group</p>
        </motion.div>
      </section>
    </div>
  );
}
