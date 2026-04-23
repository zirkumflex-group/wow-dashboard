import { serve } from "@hono/node-server";
import { eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import {
  addonIngestBodySchema,
  characterDetailTimelineQuerySchema,
  characterMythicPlusQuerySchema,
  characterPageQuerySchema,
  characterRouteParamsSchema,
  characterSnapshotTimelineQuerySchema,
  charactersLatestQuerySchema,
  loginCodeTtlSeconds,
  playerRouteParamsSchema,
  updateCharacterBoosterBodySchema,
  updateCharacterSlotsBodySchema,
  updatePlayerDiscordBodySchema,
} from "@wow-dashboard/api-schema";
import { players } from "@wow-dashboard/db";
import { env } from "@wow-dashboard/env/server";
import { auth, type ApiAuthSession, type ApiAuthUser } from "./auth";
import { db } from "./db";
import { createLoginCode, redeemLoginCode } from "./lib/loginCodes";
import { ensureRedis } from "./lib/redis";
import { AddonIngestServiceError, ingestAddonData } from "./services/addonIngest";
import {
  readBoosterCharactersForExport,
  readCharacterDetailTimeline,
  readCharacterMythicPlus,
  readCharacterPage,
  readCharacterSnapshotTimeline,
  readCharactersWithLatestSnapshot,
  readMyCharactersWithSnapshot,
  readPlayerScoreboard,
  readPlayerCharacters,
  readScoreboardCharacters,
  requestCharacterResync,
  updateCharacterBoosterStatus,
  updateCharacterNonTradeableSlots,
} from "./services/characters";
import { updatePlayerDiscordUserId } from "./services/players";

type AppBindings = {
  Variables: {
    session: ApiAuthSession | null;
    user: ApiAuthUser | null;
  };
};

export const app = new Hono<AppBindings>();

function isAllowedApiOrigin(origin: string) {
  if (!origin) {
    return false;
  }

  if (origin === env.SITE_URL) {
    return true;
  }

  try {
    const url = new URL(origin);
    if ((url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.protocol === "http:") {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function hasAuthorizationHeader(value: string | null | undefined) {
  return typeof value === "string" && value.trim() !== "";
}

function requestsAuthorizationHeader(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return value
    .split(",")
    .some((headerName) => headerName.trim().toLowerCase() === "authorization");
}

function resolveApiCorsPolicy(c: Context<AppBindings>) {
  const origin = c.req.header("origin") ?? "";
  if (!origin) {
    return null;
  }

  if (isAllowedApiOrigin(origin)) {
    return {
      origin,
      allowCredentials: true,
    };
  }

  if (
    origin === "null" &&
    (hasAuthorizationHeader(c.req.header("authorization")) ||
      requestsAuthorizationHeader(c.req.header("Access-Control-Request-Headers")))
  ) {
    return {
      origin,
      allowCredentials: false,
    };
  }

  return null;
}

function appendVaryHeader(headers: Headers, value: string) {
  const existing = headers.get("Vary");
  if (!existing) {
    headers.set("Vary", value);
    return;
  }

  const values = existing.split(",").map((entry) => entry.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) {
    headers.set("Vary", `${existing}, ${value}`);
  }
}

function applyApiCorsHeaders(c: Context<AppBindings>, headers: Headers) {
  const corsPolicy = resolveApiCorsPolicy(c);

  if (corsPolicy) {
    headers.set("Access-Control-Allow-Origin", corsPolicy.origin);
    if (corsPolicy.allowCredentials) {
      headers.set("Access-Control-Allow-Credentials", "true");
    } else {
      headers.delete("Access-Control-Allow-Credentials");
    }
  }

  headers.set("Access-Control-Expose-Headers", "Content-Length,set-auth-token");
  appendVaryHeader(headers, "Origin");
}

function withApiCorsHeaders(c: Context<AppBindings>, response: Response) {
  const headers = new Headers(response.headers);
  applyApiCorsHeaders(c, headers);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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

function parseBooleanQueryValue(value: string | null) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

app.use("/api/*", async (c, next) => {
  const corsPolicy = resolveApiCorsPolicy(c);

  if (corsPolicy) {
    c.header("Access-Control-Allow-Origin", corsPolicy.origin);
    if (corsPolicy.allowCredentials) {
      c.header("Access-Control-Allow-Credentials", "true");
    }
  }

  c.header("Access-Control-Expose-Headers", "Content-Length,set-auth-token");

  if (c.req.method === "OPTIONS") {
    c.header("Access-Control-Max-Age", "600");
    c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");

    const requestHeaders = c.req.header("Access-Control-Request-Headers");
    if (requestHeaders) {
      c.header("Access-Control-Allow-Headers", requestHeaders);
      c.header("Vary", "Access-Control-Request-Headers", { append: true });
    } else {
      c.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
    }

    c.header("Vary", "Origin", { append: true });
    return new Response(null, {
      status: 204,
      statusText: "No Content",
      headers: c.res.headers,
    });
  }

  await next();
  appendVaryHeader(c.res.headers, "Origin");
});

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
    const redis = await ensureRedis();
    const [, redisStatus] = await Promise.all([db.execute(sql`select 1`), redis.ping()]);

    if (redisStatus !== "PONG") {
      throw new Error("Redis ping failed");
    }

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
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const code = await createLoginCode({
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

app.on(["GET", "POST"], "/api/auth/*", async (c) =>
  withApiCorsHeaders(c, await auth.handler(c.req.raw)),
);

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

app.get("/api/characters", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json(await readMyCharactersWithSnapshot(user.id));
});

app.get("/api/characters/:id/page", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const parsedParams = characterRouteParamsSchema.safeParse(c.req.param());
  if (!parsedParams.success) {
    return c.json({ error: formatValidationError(parsedParams.error.issues) }, 400);
  }

  const searchParams = new URL(c.req.url).searchParams;
  const parsedQuery = characterPageQuerySchema.safeParse({
    timeFrame: searchParams.get("timeFrame"),
    includeStats: parseBooleanQueryValue(searchParams.get("includeStats")),
  });
  if (!parsedQuery.success) {
    return c.json({ error: formatValidationError(parsedQuery.error.issues) }, 400);
  }

  return c.json(
    await readCharacterPage(
      parsedParams.data.id,
      parsedQuery.data.timeFrame,
      parsedQuery.data.includeStats === true,
    ),
  );
});

app.get("/api/characters/:id/detail-timeline", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const parsedParams = characterRouteParamsSchema.safeParse(c.req.param());
  if (!parsedParams.success) {
    return c.json({ error: formatValidationError(parsedParams.error.issues) }, 400);
  }

  const searchParams = new URL(c.req.url).searchParams;
  const parsedQuery = characterDetailTimelineQuerySchema.safeParse({
    timeFrame: searchParams.get("timeFrame"),
    metric: searchParams.get("metric"),
  });
  if (!parsedQuery.success) {
    return c.json({ error: formatValidationError(parsedQuery.error.issues) }, 400);
  }

  return c.json(
    await readCharacterDetailTimeline(
      parsedParams.data.id,
      parsedQuery.data.timeFrame,
      parsedQuery.data.metric,
    ),
  );
});

app.get("/api/characters/:id/snapshot-timeline", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const parsedParams = characterRouteParamsSchema.safeParse(c.req.param());
  if (!parsedParams.success) {
    return c.json({ error: formatValidationError(parsedParams.error.issues) }, 400);
  }

  const searchParams = new URL(c.req.url).searchParams;
  const parsedQuery = characterSnapshotTimelineQuerySchema.safeParse({
    timeFrame: searchParams.get("timeFrame"),
  });
  if (!parsedQuery.success) {
    return c.json({ error: formatValidationError(parsedQuery.error.issues) }, 400);
  }

  return c.json(
    await readCharacterSnapshotTimeline(parsedParams.data.id, parsedQuery.data.timeFrame),
  );
});

app.get("/api/characters/:id/mythic-plus", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const parsedParams = characterRouteParamsSchema.safeParse(c.req.param());
  if (!parsedParams.success) {
    return c.json({ error: formatValidationError(parsedParams.error.issues) }, 400);
  }

  const searchParams = new URL(c.req.url).searchParams;
  const parsedQuery = characterMythicPlusQuerySchema.safeParse({
    includeAllRuns: parseBooleanQueryValue(searchParams.get("includeAllRuns")),
  });
  if (!parsedQuery.success) {
    return c.json({ error: formatValidationError(parsedQuery.error.issues) }, 400);
  }

  return c.json(
    await readCharacterMythicPlus(
      parsedParams.data.id,
      parsedQuery.data.includeAllRuns === true,
    ),
  );
});

app.get("/api/characters/scoreboard", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json(await readScoreboardCharacters());
});

app.get("/api/scoreboard/players", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json(await readPlayerScoreboard());
});

app.get("/api/characters/boosters/export", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json(await readBoosterCharactersForExport());
});

app.post("/api/characters/resync", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json(await requestCharacterResync(user.id));
});

app.post("/api/addon/ingest", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const parsedBody = addonIngestBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return c.json({ error: formatValidationError(parsedBody.error.issues) }, 400);
  }

  try {
    return c.json(await ingestAddonData(user.id, parsedBody.data.characters));
  } catch (error) {
    if (error instanceof AddonIngestServiceError) {
      return c.json({ error: error.message }, { status: error.status as 400 | 401 | 404 | 409 | 429 });
    }

    return c.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
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
      user.id,
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

app.patch("/api/characters/:id/booster", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const parsedParams = characterRouteParamsSchema.safeParse(c.req.param());
  if (!parsedParams.success) {
    return c.json({ error: formatValidationError(parsedParams.error.issues) }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const parsedBody = updateCharacterBoosterBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return c.json({ error: formatValidationError(parsedBody.error.issues) }, 400);
  }

  const result = await updateCharacterBoosterStatus(
    parsedParams.data.id,
    user.id,
    parsedBody.data.isBooster,
  );

  if (!result) {
    return c.json({ error: "Character not found." }, 404);
  }

  return c.json(result);
});

app.patch("/api/characters/:id/slots", async (c) => {
  const session = c.get("session");
  const user = c.get("user");

  if (!session || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const parsedParams = characterRouteParamsSchema.safeParse(c.req.param());
  if (!parsedParams.success) {
    return c.json({ error: formatValidationError(parsedParams.error.issues) }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const parsedBody = updateCharacterSlotsBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return c.json({ error: formatValidationError(parsedBody.error.issues) }, 400);
  }

  const result = await updateCharacterNonTradeableSlots(
    parsedParams.data.id,
    user.id,
    parsedBody.data.nonTradeableSlots,
  );

  if (!result) {
    return c.json({ error: "Character not found." }, 404);
  }

  return c.json(result);
});

function getPort() {
  const parsedPort = Number.parseInt(env.PORT, 10);
  return Number.isFinite(parsedPort) ? parsedPort : 3000;
}

function getHost() {
  const host = process.env.HOST?.trim();
  return host && host.length > 0 ? host : "0.0.0.0";
}

export function startApi() {
  const port = getPort();
  const host = getHost();

  serve({
    fetch: app.fetch,
    port,
    hostname: host,
  });

  console.log(`[api] listening on http://${host}:${port}`);
}
