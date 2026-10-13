import { createClient } from "@supabase/supabase-js";

const url = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

let pendingAuthError = "";

function anonRole(key) {
  try {
    const part = key.split(".")[1];
    if (!part) return "";
    const base = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base + "=".repeat((4 - (base.length % 4)) % 4);
    const json = JSON.parse(atob(padded));
    return json.role || "";
  } catch {
    return "";
  }
}

export const isConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && anonRole(anonKey) === "anon";

export const supabase = isConfigured
  ? createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  })
  : null;

export function siteUrl() {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(base, location.origin).href;
}

export function takeAuthError() {
  const message = pendingAuthError;
  pendingAuthError = "";
  return message;
}

export async function settleAuth() {
  if (!supabase) return null;
  const params = new URLSearchParams(location.search);
  pendingAuthError = params.get("error_description") || "";
  const { data } = await supabase.auth.getSession();
  if (params.has("code") || params.has("error") || params.has("error_description")) {
    params.delete("code");
    params.delete("error");
    params.delete("error_description");
    const next = `${location.pathname}${params.toString() ? `?${params}` : ""}${location.hash}`;
    history.replaceState({}, "", next);
  }
  return data.session;
}
