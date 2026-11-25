"use client";
import Link from "next/link";

export default function VerifyEmailPage() {
  return (
    <>
      <h1 className="display text-3xl">Email verification is off</h1>
      <p className="mt-3 text-sm" style={{ color: "var(--text2)" }}>
        This instance does not send verification emails. The owner can turn the feature on later; until then, there is nothing to check or resend.
      </p>
      <Link href="/login" className="mt-8 inline-block underline">Back to sign in</Link>
    </>
  );
}
