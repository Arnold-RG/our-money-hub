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
        const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://jsonblob.com https://cdn.jsdelivr.net https://open.er-api.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
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
