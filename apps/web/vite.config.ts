import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Security headers — applied to the Vite dev server and production SSR server.
// For static hosting (CDN/reverse proxy), mirror these headers in your deployment config.
const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // unsafe-inline is required for the theme anti-flash inline script in __root.tsx
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' *.convex.cloud *.convex.site wss://*.convex.cloud;",
};

const securityHeadersPlugin = (): import("vite").Plugin => ({
  name: "security-headers",
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
        res.setHeader(header, value);
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((_req, res, next) => {
      for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
        res.setHeader(header, value);
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [tsconfigPaths(), tailwindcss(), tanstackStart(), viteReact(), securityHeadersPlugin()],
  server: {
    port: 3001,
  },
  ssr: {
    noExternal: ["@convex-dev/better-auth"],
  },
});
