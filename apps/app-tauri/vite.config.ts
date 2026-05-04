import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: "../..",
  plugins: [tailwindcss(), react()],
  server: {
    port: 1420,
    strictPort: true,
  },
});
