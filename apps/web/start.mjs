// Production server entry.
// Uses srvx/node (transitive prod dep: web → @tanstack/react-start → h3 → srvx).
// srvx reads process.env.PORT automatically (defaults to 3000).
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "srvx/node";
import server from "./dist/server/server.js";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_DIR = join(ROOT, "dist/client");

const MIME = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

serve({
  async fetch(request) {
    const { pathname } = new URL(request.url);

    // Serve static client assets — content-hashed files are cached immutably.
    try {
      const file = await readFile(join(CLIENT_DIR, pathname));
      const type = MIME[extname(pathname)] ?? "application/octet-stream";
      return new Response(file, {
        headers: {
          "content-type": type,
          "cache-control": pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600",
        },
      });
    } catch {
      // Not a static file — fall through to SSR.
    }

    return server.fetch(request);
  },
});
