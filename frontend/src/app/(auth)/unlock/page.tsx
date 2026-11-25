"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

export default function UnlockPage() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ available: boolean; display_name?: string }>("/auth/trusted-device")
      .then((r) => {
        if (!r.available) router.replace("/login");
        else setName(r.display_name || null);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/auth/unlock", { method: "POST", json: { code } });
      router.push("/dashboard");
    } catch (err) {
      setCode("");
      setError(err instanceof ApiError && err.status === 429
        ? "Too many wrong codes. Try again later."
        : "That code didn’t match");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="font-display text-3xl font-medium tracking-tight">Welcome back{name ? `, ${name}` : ""}</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text2)" }}>
        Enter the 6-digit code from your authenticator app to unlock this device.
      </p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="unlock-code">Authenticator code</label>
          <input
            id="unlock-code"
            className="input h-14 text-center text-2xl tracking-[0.4em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            pattern="[0-9]*"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            aria-invalid={!!error}
            autoFocus
            required
          />
          <p className="mt-2 text-xs" style={{ color: "var(--faint)" }}>{code.length} of 6 digits entered</p>
        </div>
        {error && (
          <p role="alert" className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 12%, transparent)" }}>
            {error}
          </p>
        )}
        <button className="btn btn-primary h-12 w-full" disabled={busy || code.length !== 6}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
      <p className="mt-6 text-sm">
        <Link href="/login?password=1" className="underline" style={{ color: "var(--accent)" }}>Use password instead</Link>
      </p>
    </>
  );
}
