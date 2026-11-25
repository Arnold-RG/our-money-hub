"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useSecretFromFragment } from "@/lib/useSecretFromFragment";
import { normalizeUsername, USERNAME_FIELD, USERNAME_HINT } from "@/lib/username";
import { useApp } from "@/providers/app-provider";
import { Button, ErrorNote, Field, Input } from "@/components/ui";

function SetupForm() {
  const router = useRouter();
  const { refreshMe } = useApp();
  const { secret, ready } = useSecretFromFragment();
  const [token, setToken] = useState("");
  useEffect(() => { if (secret) setToken(secret); }, [secret]);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    api<{ owner_setup: boolean }>("/auth/config").then((c) => setAvailable(c.owner_setup)).catch(() => setAvailable(false));
  }, []);

  const lengthOk = password.length >= 12 && password.length <= 128;
  const match = password.length > 0 && password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lengthOk) { setError("Use a password of 12 to 128 characters."); return; }
    if (!match) { setError("Passwords don’t match. Check the last character."); return; }
    setBusy(true); setError(null);
    try {
      const r = await api<{ mfa_enrolment_required?: boolean }>("/auth/register", {
        method: "POST",
        json: { setup_token: token, username: normalizeUsername(username), email, password, display_name: name },
      });
      if (r.mfa_enrolment_required) router.push("/verify?enrol=1");
      else { await refreshMe(); router.replace("/dashboard"); }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the owner account");
    } finally { setBusy(false); }
  };

  if (available === false) {
    return (
      <>
        <h1 className="display text-3xl">Owner setup isn’t available</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--text2)" }}>This instance already has an owner, or no setup token is configured. Ask the owner for an invite.</p>
        <Link href="/login" className="mt-8 inline-block underline">Back to sign in</Link>
      </>
    );
  }

  return (
    <>
      <Link href="/login" className="text-sm" style={{ color: "var(--text2)" }}>← Back to sign in</Link>
      <h1 className="mt-4 display text-3xl">Create the owner account</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text2)" }}>
        This is a one-time setup for this Our Money Hub instance. You’ll enrol two-step verification on the next screen. We never collect a password for you — you choose it here.
      </p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        {ready && token.length >= 32 ? (
          <input type="hidden" name="setup_token" value={token} autoComplete="off" />
        ) : ready ? (
        <Field label="Setup token" hint="The one-time token from the server environment. It is at least 32 characters.">
          {(id) => <Input id={id} autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required minLength={32} />}
        </Field>
        ) : null}
        <Field label="Your name">{(id) => <Input id={id} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
        <Field label="Username" hint={USERNAME_HINT}>
          {(id) => (
            <Input
              id={id}
              {...USERNAME_FIELD}
              value={username}
              onChange={(e) => setUsername(normalizeUsername(e.target.value))}
              onInvalid={(e) => { e.preventDefault(); setError(USERNAME_HINT); }}
              required
            />
          )}
        </Field>
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Password" hint="12–128 characters. No composition rules.">
          {(id) => (
            <div className="relative">
              <Input id={id} type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} className="pr-16" />
              <button type="button" className="absolute right-2 top-1/2 min-h-11 -translate-y-1/2 text-xs" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((v) => !v)}>{show ? "Hide" : "Show"}</button>
            </div>
          )}
        </Field>
        <Field label="Confirm password" error={confirm && !match ? "Passwords don’t match. Check the last character." : null}>
          {(id) => <Input id={id} type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" disabled={busy} className="h-12">{busy ? "Creating…" : "Create owner account"}</Button>
      </form>
    </>
  );
}

export default function SetupPage() {
  return <SetupForm />;
}
