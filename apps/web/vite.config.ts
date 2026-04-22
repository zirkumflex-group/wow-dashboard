import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart(),
    viteReact({
      exclude: ["./src/routes/__root.tsx"],
    }),
    nitro(),
  ],
  resolve: {
    alias: {
      // Nitro SSR was bundling the UMD tslib entry through the Radix dialog stack,
      // which crashes server startup when the shared Sheet component is loaded.
      tslib: "tslib/tslib.es6.mjs",
    },
    tsconfigPaths: true,
  },
  server: {
    port: 3001,
  },
  build: {
    chunkSizeWarningLimit: 5000,
  },
});
