"use client";
import { useEffect, useState } from "react";

/**
 * Read a one-time secret from the URL hash (preferred) or a ?token= query,
 * then immediately strip both so it cannot leak via Referer.
 */
export function useSecretFromFragment(queryKey = "token") {
  const [secret, setSecret] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get(queryKey) ?? "";
    const value = hash || fromQuery;
    if (hash || fromQuery || window.location.search.includes(queryKey)) {
      const url = new URL(window.location.href);
      url.hash = "";
      url.searchParams.delete(queryKey);
      const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "");
      window.history.replaceState(null, "", next);
    }
    if (value) setSecret(value);
    setReady(true);
  }, [queryKey]);

  return { secret, setSecret, ready };
}
