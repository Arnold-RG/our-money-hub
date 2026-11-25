/** Public URL of RAGI. Production builds never fall back to localhost. */
export const PRODUCTION_RAGI_URL = "https://arnova-ragi.onrender.com";
export const DEV_RAGI_URL = "http://localhost:3410";

export function ragiPublicUrl(env: {
  NEXT_PUBLIC_RAGI_URL?: string;
  NODE_ENV?: string;
} = typeof process !== "undefined" ? process.env : {}): string {
  const explicit = (env.NEXT_PUBLIC_RAGI_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (env.NODE_ENV === "production") return PRODUCTION_RAGI_URL;
  return DEV_RAGI_URL;
}
