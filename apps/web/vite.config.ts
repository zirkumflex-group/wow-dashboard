import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";


export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart(),
    viteReact({
      exclude: ["./src/routes/__root.tsx"],
      babel: {
        compact: true,
      },
    }),
    nitro({
      routeRules: {
        "/**": {
          headers: {
            "X-Frame-Options": "DENY",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            "Strict-Transport-Security":
              "max-age=31536000; includeSubDomains",
          },
        },
      },
    }),
  ],
  server: {
    port: 3001,
  },
  ssr: {
    noExternal: ["@convex-dev/better-auth"],
  },
  build: {
    chunkSizeWarningLimit: 5000,
  },
});
