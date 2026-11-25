"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useApp } from "@/providers/app-provider";
import { useSecretFromFragment } from "@/lib/useSecretFromFragment";
import { Button, ErrorNote, Field, Input } from "@/components/ui";

const GENERIC = "This invite can’t be used. Ask the owner for a new one.";

interface Preview {
  email: string; role: string; workspace_name?: string | null; expires_at: string;
}

export default function InvitePage() {
  const router = useRouter();
  const { refreshMe } = useApp();
  const { secret, ready } = useSecretFromFragment();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await api<Preview>("/auth/invite/preview", { method: "POST", json: secret ? { token: secret } : {} });
        if (!cancelled) setPreview(p);
      } catch {
        if (!cancelled) setError(GENERIC);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, secret]);

  const lengthOk = password.length >= 12 && password.length <= 128;
  const match = password.length > 0 && password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview) return;
    if (!lengthOk) { setError("Use a password of 12 to 128 characters."); return; }
    if (!match) { setError("Passwords don’t match. Check the last character."); return; }
    setBusy(true); setError(null);
    try {
      const r = await api<{ mfa_enrolment_required?: boolean }>("/auth/register", {
        method: "POST",
        json: { email: preview.email, password, display_name: name, invite_token: secret || undefined },
      });
      if (r.mfa_enrolment_required) router.push("/verify?enrol=1");
      else { await refreshMe(); router.replace("/dashboard"); }
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409
        ? "An account with this email already exists"
        : GENERIC);
    } finally { setBusy(false); }
  };

  if (loading) return <p className="text-sm">Checking this invite…</p>;

  if (!preview) {
    return (
      <>
        <h1 className="display text-3xl">This invite can’t be used</h1>
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--text2)" }}>{error || GENERIC}</p>
        <Link href="/login" className="mt-8 inline-block underline">Back to sign in</Link>
      </>
    );
  }

  return (
    <>
      <Link href="/login" className="text-sm" style={{ color: "var(--text2)" }}>← Back to sign in</Link>
      <h1 className="mt-4 display text-3xl">Create your account</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text2)" }}>
        This invite is for <b>{preview.email}</b> as <b>{preview.role}</b>
        {preview.workspace_name ? <> in <b>{preview.workspace_name}</b></> : null}. It lasts 72 hours and can be used once.
      </p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <Field label="Email">{(id) => <Input id={id} type="email" value={preview.email} readOnly autoComplete="username" />}</Field>
        <Field label="Your name">{(id) => <Input id={id} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
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
        <Button type="submit" disabled={busy} className="h-12">{busy ? "Creating…" : "Create account"}</Button>
      </form>
    </>
  );
}
