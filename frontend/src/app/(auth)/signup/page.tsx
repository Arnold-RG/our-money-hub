"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function SignupPage() {
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    api<{ owner_setup: boolean }>("/auth/config").then((c) => setSetup(c.owner_setup)).catch(() => setSetup(false));
  }, []);
  return (
    <>
      <Link href="/login" className="text-sm" style={{ color: "var(--text2)" }}>← Back to sign in</Link>
      <h1 className="mt-6 display text-3xl">Invite required</h1>
      <p className="mt-3 text-sm" style={{ color: "var(--text2)" }}>
        Our Money Hub doesn’t have open sign-up. To get an account, ask the owner for an invite.
      </p>
      <div className="mt-6 rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--border)", background: "var(--s1)" }}>
        Signing in with Google or Apple won’t create an account without an invite.
      </div>
      {setup && (
        <p className="mt-4 text-sm">Setting this instance up for the first time? <Link href="/setup" className="underline">Create the owner account</Link> with the one-time setup token.</p>
      )}
      <Link href="/login" className="btn mt-8 flex h-12 w-full items-center justify-center" style={{ background: "var(--accent)", color: "var(--accent-ink, #fff)" }}>Back to sign in</Link>
    </>
  );
}
