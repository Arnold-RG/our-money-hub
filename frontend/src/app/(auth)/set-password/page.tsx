"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api("/auth/password/set", { json: { password } });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set the password");
    } finally { setBusy(false); }
  };

  return (
    <>
      <h1 className="font-display text-3xl font-medium tracking-tight">Set a new password</h1>
      <p className="mt-3 text-sm" style={{ color: "var(--text2)" }}>
        After signing in with GitHub you can choose a password so you can also sign in with email or username.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="password">New password</label>
          <input id="password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={128} />
        </div>
        {error && <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
        <button className="btn btn-primary h-12 w-full" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </>
  );
}
