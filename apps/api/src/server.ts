import { serve } from "@hono/node-server";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  charactersLatestQuerySchema,
  loginCodeTtlSeconds,
  playerRouteParamsSchema,
  updatePlayerDiscordBodySchema,
} from "@wow-dashboard/api-schema";
import { players } from "@wow-dashboard/db";
import { env } from "@wow-dashboard/env/server";
import { auth, type ApiAuthSession, type ApiAuthUser } from "./auth";
import { db } from "./db";
import { createLoginCode, redeemLoginCode } from "./lib/loginCodes";
import {
  readCharactersWithLatestSnapshot,
  readPlayerCharacters,
} from "./services/characters";
import { updatePlayerDiscordUserId } from "./services/players";

type AppBindings = {
  Variables: {
    session: ApiAuthSession | null;
    user: ApiAuthUser | null;
  };
};

export const app = new Hono<AppBindings>();

function serializeSession(session: ApiAuthSession) {
  return {
    id: session.id,
    userId: session.userId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
  };
}

function serializeUser(user: ApiAuthUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function readPlayerBinding(userId: string) {
  return db.query.players.findFirst({
    where: eq(players.userId, userId),
  });
}

function renderDevAuthPage(callbackUrl: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WoW Dashboard Auth Probe</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, #ffe4b8 0%, rgba(255, 228, 184, 0) 36%),
          linear-gradient(180deg, #faf7f1 0%, #efe9dd 100%);
        color: #1d1a15;
      }
      body {
        margin: 0;
        min-height: 100vh;
      }
      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 48px 24px 64px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: clamp(2rem, 4vw, 3.25rem);
        line-height: 1;
      }
      p {
        max-width: 70ch;
        color: #4e4538;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 24px 0 32px;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        font-weight: 600;
        color: #fff8ee;
        background: #8b4513;
        cursor: pointer;
      }
      button.secondary {
        color: #2c2419;
        background: #d9c7aa;
      }
      button:disabled {
        cursor: wait;
        opacity: 0.7;
      }
      .grid {
        display: grid;
        gap: 16px;
      }
      @media (min-width: 860px) {
        .grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      section {
        border: 1px solid rgba(79, 56, 34, 0.12);
        border-radius: 20px;
        padding: 20px;
        background: rgba(255, 250, 241, 0.84);
        box-shadow: 0 18px 48px rgba(69, 45, 20, 0.08);
        backdrop-filter: blur(8px);
      }
      h2 {
        margin: 0 0 12px;
        font-size: 1rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 0.925rem;
        line-height: 1.5;
      }
      code {
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      }
      .hint {
        margin-top: 24px;
        font-size: 0.925rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Battle.net Auth Probe</h1>
      <p>
        Development-only page for proving the Better Auth round-trip before the web and
        Electron clients are migrated. It signs in with Battle.net, checks the rebound
        <code>players</code> row, and exercises bearer auth against <code>/api/me</code>.
      </p>
      <div class="actions">
        <button id="signin">Sign In With Battle.net</button>
        <button id="refresh" class="secondary">Refresh Session</button>
        <button id="bearer" class="secondary">Call /api/me With Bearer</button>
      </div>
      <div class="grid">
        <section>
          <h2>Session Probe</h2>
          <pre id="session-output">Loading session state...</pre>
        </section>
        <section>
          <h2>Bearer Check</h2>
          <pre id="bearer-output">Bearer flow has not been exercised yet.</pre>
        </section>
      </div>
      <p class="hint">
        Expected Battle.net callback URI:
        <code>${callbackUrl}</code>
      </p>
    </main>
    <script>
      const signinButton = document.getElementById("signin");
      const refreshButton = document.getElementById("refresh");
      const bearerButton = document.getElementById("bearer");
      const sessionOutput = document.getElementById("session-output");
      const bearerOutput = document.getElementById("bearer-output");

      let currentState = null;

      async function fetchJson(url, init) {
        const response = await fetch(url, {
          credentials: "include",
          ...init,
          headers: {
            "content-type": "application/json",
            ...(init && init.headers ? init.headers : {}),
          },
        });

        let data = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }

        if (!response.ok) {
          throw new Error(JSON.stringify(data ?? { status: response.status }, null, 2));
        }

        return data;
      }

      async function loadSessionState() {
        sessionOutput.textContent = "Loading session state...";

        try {
          currentState = await fetchJson("/api/dev/session", { method: "GET" });
          sessionOutput.textContent = JSON.stringify(currentState, null, 2);
        } catch (error) {
          currentState = null;
          sessionOutput.textContent = String(error.message ?? error);
        }
      }

      async function startOAuth() {
        signinButton.disabled = true;

        try {
          const data = await fetchJson("/api/auth/sign-in/oauth2", {
            method: "POST",
            body: JSON.stringify({
              providerId: "battlenet",
              callbackURL: window.location.href,
            }),
          });

          window.location.assign(data.url);
        } catch (error) {
          signinButton.disabled = false;
          bearerOutput.textContent = String(error.message ?? error);
        }
      }

      async function runBearerCheck() {
        if (!currentState?.bearerToken) {
          bearerOutput.textContent = "No bearer token is available. Sign in first.";
          return;
        }

        bearerOutput.textContent = "Calling /api/me with Authorization: Bearer ...";

        try {
          const response = await fetch("/api/me", {
            method: "GET",
            headers: {
              authorization: "Bearer " + currentState.bearerToken,
            },
          });

          const data = await response.json();
          bearerOutput.textContent = JSON.stringify(
            {
              status: response.status,
              data,
            },
            null,
            2,
          );
        } catch (error) {
          bearerOutput.textContent = String(error.message ?? error);
        }
      }

      signinButton.addEventListener("click", startOAuth);
      refreshButton.addEventListener("click", loadSessionState);
      bearerButton.addEventListener("click", runBearerCheck);

      loadSessionState();
    </script>
  </body>
</html>`;
}

function formatValidationError(issues: { message: string }[]): string {
  return issues[0]?.message ?? "Invalid request";
}

app.use(
  "/api/*",
  cors({
    origin: env.SITE_URL,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
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

app.get("/dev/auth", (c) => {
  if (env.NODE_ENV !== "development") {
    return c.text("Not found", 404);
  }

  const callbackUrl = new URL("/api/auth/oauth2/callback/battlenet", env.BETTER_AUTH_URL).toString();

  return c.html(renderDevAuthPage(callbackUrl));
});

app.post("/api/auth/login-code", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const code = await createLoginCode({
    token: session.token,
    userId: user.id,
  });

  return c.json({
    code,
    expiresIn: loginCodeTtlSeconds,
  });
});

app.post("/api/auth/redeem-code", async (c) => {
  let body: { code?: unknown };
  try {
    body = (await c.req.json()) as { code?: unknown };
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const code = typeof body.code === "string" ? body.code : "";
  if (!code) {
    return c.json({ error: "code is required" }, 400);
  }

  const token = await redeemLoginCode(code);
  if (!token) {
    return c.json({ error: "Invalid or expired code" }, 401);
  }

  return c.json({ token });
});

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/api/dev/session", async (c) => {
  if (env.NODE_ENV !== "development") {
    return c.json({ error: "Not found" }, 404);
  }

  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const player = await readPlayerBinding(user.id);

  return c.json({
    session: serializeSession(session),
    user: serializeUser(user),
    bearerToken: session.token,
    player: player
      ? {
          id: player.id,
          userId: player.userId,
          battlenetAccountId: player.battlenetAccountId,
          battleTag: player.battleTag,
          discordUserId: player.discordUserId,
          legacyConvexId: player.legacyConvexId,
        }
      : null,
  });
});

app.get("/api/me", (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json({
    session: serializeSession(session),
    user: serializeUser(user),
  });
});

app.get("/api/characters/latest", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const searchParams = new URL(c.req.url).searchParams;
  const parsedQuery = charactersLatestQuerySchema.safeParse({
    characterId: searchParams.getAll("characterId"),
  });

  if (!parsedQuery.success) {
    return c.json({ error: formatValidationError(parsedQuery.error.issues) }, 400);
  }

  return c.json(await readCharactersWithLatestSnapshot(parsedQuery.data.characterId));
});

app.get("/api/players/:id/characters", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const parsedParams = playerRouteParamsSchema.safeParse(c.req.param());
  if (!parsedParams.success) {
    return c.json({ error: formatValidationError(parsedParams.error.issues) }, 400);
  }

  return c.json(await readPlayerCharacters(parsedParams.data.id));
});

app.patch("/api/players/:id/discord", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const parsedParams = playerRouteParamsSchema.safeParse(c.req.param());
  if (!parsedParams.success) {
    return c.json({ error: formatValidationError(parsedParams.error.issues) }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const parsedBody = updatePlayerDiscordBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return c.json({ error: formatValidationError(parsedBody.error.issues) }, 400);
  }

  try {
    const result = await updatePlayerDiscordUserId(
      parsedParams.data.id,
      parsedBody.data.discordUserId,
    );

    if (!result) {
      return c.json({ error: "Player not found." }, 404);
    }

    return c.json(result);
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      400,
    );
  }
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
