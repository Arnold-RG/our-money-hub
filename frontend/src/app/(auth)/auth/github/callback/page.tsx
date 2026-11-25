"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get("code") || "";
    const state = params.get("state") || "";
    if (!code || !state) {
      setError("GitHub sign-in could not be completed");
      return;
    }
    api<{ mfa_required: boolean; mfa_enrolment_required: boolean; user: { has_password?: boolean; role?: string } | null }>("/auth/oauth/github/callback", {
      json: { code, state },
    }).then((r) => {
      if (r.mfa_enrolment_required) router.replace("/verify?enrol=1");
      else if (r.mfa_required) router.replace("/verify");
      else if (r.user && r.user.has_password === false) router.replace("/set-password");
      else router.replace("/dashboard");
    }).catch((err) => {
      setError(err instanceof ApiError ? err.message : "GitHub sign-in could not be completed");
    });
  }, [params, router]);

  if (error) {
    return (
      <>
        <h1 className="font-display text-3xl font-medium tracking-tight">GitHub sign-in failed</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>{error}</p>
        <a href="/login" className="btn btn-primary mt-8 flex h-12 w-full items-center justify-center">Back to sign in</a>
      </>
    );
  }
  return <p className="text-sm" style={{ color: "var(--text2)" }}>Completing GitHub sign-in…</p>;
}

export default function GitHubCallbackPage() {
  return (
    <Suspense fallback={<p className="text-sm">Completing GitHub sign-in…</p>}>
      <CallbackInner />
    </Suspense>
  );
}
