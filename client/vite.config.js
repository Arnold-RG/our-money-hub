import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.VITE_BASE || "/";
const anonKey = String(process.env.VITE_SUPABASE_ANON_KEY || "").trim();

function jwtRole(key) {
  const part = String(key || "").split(".")[1];
  if (!part) return "";
  try {
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return json.role || "";
  } catch {
    return "";
  }
}

if (anonKey && jwtRole(anonKey) !== "anon") {
  throw new Error("VITE_SUPABASE_ANON_KEY must be the Supabase anon public key. Do not use the service role key.");
}

export default defineConfig({
  root,
  base,
  plugins: [
    react(),
    {
      name: "omh-csp",
      transformIndexHtml(html, ctx) {
        if (ctx.server) return html;
        const csp = [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src https://fonts.gstatic.com",
          "img-src 'self' data:",
          "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net https://open.er-api.com",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join("; ");
        return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
      },
    },
  ],
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
  },
});
