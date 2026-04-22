import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "@wow-dashboard/env/server";
import { auth, type ApiAuthSession, type ApiAuthUser } from "./auth";
import { db } from "./db";

type AppBindings = {
  Variables: {
    session: ApiAuthSession | null;
    user: ApiAuthUser | null;
  };
};

export const app = new Hono<AppBindings>();

app.use(
  "/api/*",
  cors({
    origin: env.SITE_URL,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["Content-Length", "set-auth-token"],
    maxAge: 600,
    credentials: true,
  }),
);

app.use("/api/*", async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  c.set("session", session?.session ?? null);
  c.set("user", session?.user ?? null);

  await next();
});

app.get("/healthz", (c) => c.json({ ok: true }));
app.get("/readyz", async (c) => {
  try {
    await db.execute(sql`select 1`);
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false }, 503);
  }
});

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/api/me", (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json({
    session,
    user,
  });
});

function getPort() {
  const parsedPort = Number.parseInt(env.PORT, 10);
  return Number.isFinite(parsedPort) ? parsedPort : 3000;
}

if (import.meta.main) {
  const port = getPort();

  serve({
    fetch: app.fetch,
    port,
  });

  console.log(`[api] listening on http://localhost:${port}`);
}
