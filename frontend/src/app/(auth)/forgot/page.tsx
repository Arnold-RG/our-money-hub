"use client";
import Link from "next/link";

export default function ForgotPage() {
  return (
    <>
      <Link href="/login" className="text-sm" style={{ color: "var(--text2)" }}>← Back to sign in</Link>
      <h1 className="mt-4 display text-3xl">Forgot your password?</h1>
      <p className="mt-3 text-sm" style={{ color: "var(--text2)" }}>
        Our Money Hub can’t send reset emails yet. Ask the owner or an admin to reset it for you.
      </p>
      <ol className="mt-6 list-decimal space-y-3 pl-5 text-sm">
        <li><b>Contact the owner</b> the way you usually do, and say which email you sign in with.</li>
        <li><b>They reset it on the server</b> with a command-line tool, and give you the new password over a channel you trust.</li>
        <li><b>Sign in</b> with the new password (at least 12 characters, and no more than 128).</li>
      </ol>
    </>
  );
}
