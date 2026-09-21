import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  root,
  base,
  plugins: [
    react(),
    {
      name: "omh-csp",
      transformIndexHtml(html, ctx) {
        if (ctx.server) return html;
        const csp = "default-src 'self'; script-src 'self' https://accounts.google.com https://connect.facebook.net https://appleid.cdn-apple.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://jsonblob.com https://bytebin.lucko.me https://cdn.jsdelivr.net https://open.er-api.com https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://graph.facebook.com https://appleid.apple.com https://login.microsoftonline.com; frame-src https://accounts.google.com https://appleid.apple.com https://www.facebook.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
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
