import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

process.env.NODE_ENV = "test";
loadRootEnv();
process.env.DATABASE_URL ??= "postgres://wowdash:wowdash@localhost:5432/wowdash";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.SITE_URL ??= "http://localhost:3001";
process.env.API_URL ??= "http://localhost:3000/api";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ??= "test-better-auth-secret-with-at-least-32-chars";
process.env.BATTLENET_CLIENT_ID ??= "test-client-id";
process.env.BATTLENET_CLIENT_SECRET ??= "test-client-secret";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import {
  account as authAccounts,
  characterDailySnapshots,
  characters,
  mythicPlusRuns,
  players,
  session as authSessions,
  snapshots,
  type SnapshotRole,
  type SnapshotSpec,
  user as authUsers,
} from "@wow-dashboard/db";

const [{ app }, { databaseConnection, db }, { closeQueue }, { closeRedis, ensureRedis }] =
  await Promise.all([
    import("./server"),
    import("./db"),
    import("./lib/queue"),
    import("./lib/redis"),
  ]);

function loadRootEnv() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const nodeEnv = process.env.NODE_ENV ?? "test";
  const envFiles = [`.env.${nodeEnv}.local`, ".env.local", `.env.${nodeEnv}`, ".env"].map(
    (fileName) => resolve(repoRoot, fileName),
  );

  for (const path of envFiles) {
    if (!existsSync(path)) continue;
    loadDotenv({ path, override: false });
  }
}

async function truncateTables() {
  await db.execute(
    sql.raw(`
    truncate table
      "audit_log",
      "mythic_plus_runs",
      "character_daily_snapshots",
      "snapshots",
      "characters",
      "players",
      "account",
      "session",
      "verification",
      "user"
    restart identity cascade
  `),
  );
}

async function resetQueueSchema() {
  await closeQueue();
  await db.execute(sql.raw(`drop schema if exists pgboss cascade`));
}

async function seedAuthenticatedUser() {
  const userId = `user-${randomUUID()}`;
  const token = `session-token-${randomUUID()}`;

  await db.insert(authUsers).values({
    id: userId,
    name: "Test User",
    email: `${userId}@example.com`,
    emailVerified: true,
    image: null,
    createdAt: new Date("2026-04-21T12:00:00.000Z"),
    updatedAt: new Date("2026-04-21T12:00:00.000Z"),
  });

  await db.insert(authSessions).values({
    id: `session-${randomUUID()}`,
    expiresAt: new Date("2027-04-21T12:00:00.000Z"),
    token,
    createdAt: new Date("2026-04-21T12:00:00.000Z"),
    updatedAt: new Date("2026-04-21T12:00:00.000Z"),
    ipAddress: null,
    userAgent: "test-suite",
    userId,
  });

  return {
    userId,
    token,
  };
}

async function seedBattleNetAccount(input: { userId: string; accessToken?: string | null }) {
  await db.insert(authAccounts).values({
    id: `account-${randomUUID()}`,
    accountId: `bnet-${randomUUID()}`,
    providerId: "battlenet",
    userId: input.userId,
    accessToken: input.accessToken ?? null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: "openid wow.profile",
    password: null,
    createdAt: new Date("2026-04-21T12:00:00.000Z"),
    updatedAt: new Date("2026-04-21T12:00:00.000Z"),
  });
}

async function seedPlayer(userId: string, battleTag = "Tester#1234") {
  const playerId = randomUUID();

  await db.insert(players).values({
    id: playerId,
    battlenetAccountId: `battle-${randomUUID()}`,
    userId,
    battleTag,
    discordUserId: null,
    legacyConvexId: null,
  });

  return playerId;
}

async function seedCharacter(input: {
  playerId: string;
  name: string;
  realm: string;
  className: string;
  race: string;
  faction: "alliance" | "horde";
}) {
  const characterId = randomUUID();

  await db.insert(characters).values({
    id: characterId,
    playerId: input.playerId,
    name: input.name,
    realm: input.realm,
    region: "eu",
    class: input.className,
    race: input.race,
    faction: input.faction,
    isBooster: null,
    nonTradeableSlots: null,
    latestSnapshot: null,
    latestSnapshotDetails: null,
    mythicPlusSummary: null,
    mythicPlusRecentRunsPreview: null,
    mythicPlusRunCount: null,
    firstSnapshotAt: null,
    snapshotCount: null,
    legacyConvexId: null,
  });

  return characterId;
}

async function seedSnapshot(input: {
  characterId: string;
  takenAt: string;
  level: number;
  spec: SnapshotSpec;
  role: SnapshotRole;
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  playtimeThisLevelSeconds?: number;
  mythicPlusScore: number;
  ownedKeystone?: {
    level: number;
    mapChallengeModeID?: number;
    mapName?: string;
  };
}) {
  await db.insert(snapshots).values({
    id: randomUUID(),
    characterId: input.characterId,
    takenAt: new Date(input.takenAt),
    level: input.level,
    spec: input.spec,
    role: input.role,
    itemLevel: input.itemLevel,
    gold: input.gold,
    playtimeSeconds: input.playtimeSeconds,
    playtimeThisLevelSeconds: input.playtimeThisLevelSeconds ?? null,
    mythicPlusScore: input.mythicPlusScore,
    ownedKeystone: input.ownedKeystone,
    currencies: {
      adventurerDawncrest: 0,
      veteranDawncrest: 0,
      championDawncrest: 0,
      heroDawncrest: 0,
      mythDawncrest: 0,
      radiantSparkDust: 0,
    },
    stats: {
      stamina: 0,
      strength: 0,
      agility: 0,
      intellect: 0,
      critPercent: 0,
      hastePercent: 0,
      masteryPercent: 0,
      versatilityPercent: 0,
    },
    legacyConvexId: null,
  });
}

async function seedMythicPlusRun(input: {
  characterId: string;
  observedAt: string;
  level: number;
  mapChallengeModeId?: number;
  mapName?: string;
  runScore?: number;
  durationMs?: number;
  completedAt?: string;
  startDate?: string;
  status?: "active" | "completed" | "abandoned";
  fingerprint?: string;
}) {
  await db.insert(mythicPlusRuns).values({
    id: randomUUID(),
    characterId: input.characterId,
    fingerprint: input.fingerprint ?? `fp-${randomUUID()}`,
    attemptId: null,
    canonicalKey: null,
    observedAt: new Date(input.observedAt),
    seasonId: 14,
    mapChallengeModeId: input.mapChallengeModeId ?? null,
    mapName: input.mapName ?? null,
    level: input.level,
    status: input.status ?? "completed",
    completed: input.status === "abandoned" ? false : true,
    completedInTime: true,
    durationMs: input.durationMs ?? 1_800_000,
    runScore: input.runScore ?? 250,
    startDate: input.startDate ? new Date(input.startDate) : null,
    completedAt: input.completedAt ? new Date(input.completedAt) : null,
    endedAt: input.completedAt ? new Date(input.completedAt) : null,
    abandonedAt: null,
    abandonReason: null,
    thisWeek: false,
    members: [
      {
        name: "Runner",
        realm: "Tarren Mill",
        classTag: "paladin",
        role: "tank",
      },
    ],
    legacyConvexId: null,
  });
}

function authHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
  };
}

describe("Phase 5 API routes", { concurrency: false }, () => {
  beforeEach(async () => {
    await resetQueueSchema();
    await truncateTables();
    const redis = await ensureRedis();
    await redis.flushdb();
  });

  after(async () => {
    await resetQueueSchema();
    await truncateTables();
    await closeRedis();
    await databaseConnection.client.end({ timeout: 1 });
  });

  it("returns the authenticated session from /api/me", async () => {
    const auth = await seedAuthenticatedUser();

    const response = await app.request("http://localhost/api/me", {
      headers: authHeaders(auth.token),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      user: { id: string };
      session: { userId: string };
    };

    assert.equal(payload.user.id, auth.userId);
    assert.equal(payload.session.userId, auth.userId);
  });

  it("creates a dedicated desktop session for login-code handoff", async () => {
    const auth = await seedAuthenticatedUser();

    const codeResponse = await app.request("http://localhost/api/auth/login-code", {
      method: "POST",
      headers: authHeaders(auth.token),
    });

    assert.equal(codeResponse.status, 200);
    const codePayload = (await codeResponse.json()) as { code: string };

    const redeemResponse = await app.request("http://localhost/api/auth/redeem-code", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: codePayload.code }),
    });

    assert.equal(redeemResponse.status, 200);
    const redeemPayload = (await redeemResponse.json()) as { token: string };

    assert.notEqual(redeemPayload.token, auth.token);

    const [browserSessionResponse, desktopSessionResponse] = await Promise.all([
      app.request("http://localhost/api/me", {
        headers: authHeaders(auth.token),
      }),
      app.request("http://localhost/api/me", {
        headers: authHeaders(redeemPayload.token),
      }),
    ]);

    assert.equal(browserSessionResponse.status, 200);
    assert.equal(desktopSessionResponse.status, 200);
  });

  it("allows desktop null-origin preflights only for bearer-authenticated API requests", async () => {
    const webPreflightResponse = await app.request("http://localhost/api/me", {
      method: "OPTIONS",
      headers: {
        Origin: process.env.SITE_URL!,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });

    assert.equal(webPreflightResponse.status, 204);
    assert.equal(
      webPreflightResponse.headers.get("Access-Control-Allow-Origin"),
      process.env.SITE_URL,
    );
    assert.equal(webPreflightResponse.headers.get("Access-Control-Allow-Credentials"), "true");

    const desktopPreflightResponse = await app.request("http://localhost/api/me", {
      method: "OPTIONS",
      headers: {
        Origin: "null",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });

    assert.equal(desktopPreflightResponse.status, 204);
    assert.equal(desktopPreflightResponse.headers.get("Access-Control-Allow-Origin"), "null");
    assert.equal(desktopPreflightResponse.headers.get("Access-Control-Allow-Credentials"), null);
    assert.ok(
      desktopPreflightResponse.headers
        .get("Access-Control-Allow-Headers")
        ?.toLowerCase()
        .includes("authorization"),
    );

    const rejectedNullOriginResponse = await app.request("http://localhost/api/me", {
      method: "OPTIONS",
      headers: {
        Origin: "null",
        "Access-Control-Request-Method": "GET",
      },
    });

    assert.equal(rejectedNullOriginResponse.status, 204);
    assert.equal(rejectedNullOriginResponse.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(rejectedNullOriginResponse.headers.get("Access-Control-Allow-Credentials"), null);
  });

  it("preserves CORS headers on Better Auth handler responses", async () => {
    const response = await app.request("http://localhost/api/auth/get-session", {
      headers: {
        Origin: process.env.SITE_URL!,
      },
    });

    assert.equal(response.headers.get("Access-Control-Allow-Origin"), process.env.SITE_URL);
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
  });

  it("returns latest pinned character snapshots in request order", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId);
    const firstCharacterId = await seedCharacter({
      playerId,
      name: "Alpha",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });
    const secondCharacterId = await seedCharacter({
      playerId,
      name: "Beta",
      realm: "Draenor",
      className: "Paladin",
      race: "Dwarf",
      faction: "alliance",
    });

    await seedSnapshot({
      characterId: firstCharacterId,
      takenAt: "2026-04-21T12:00:00.000Z",
      level: 80,
      spec: "Holy",
      role: "healer",
      itemLevel: 721.4,
      gold: 1500,
      playtimeSeconds: 7200,
      mythicPlusScore: 2800,
    });

    const response = await app.request(
      `http://localhost/api/characters/latest?characterId=${firstCharacterId}&characterId=${secondCharacterId}&characterId=${firstCharacterId}`,
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as Array<{
      _id: string;
      snapshot: { itemLevel: number } | null;
    }>;

    assert.deepEqual(
      payload.map((character) => character._id),
      [firstCharacterId, secondCharacterId],
    );
    assert.equal(payload[0]?.snapshot?.itemLevel, 721.4);
    assert.equal(payload[1]?.snapshot, null);
  });

  it("returns player summaries and snapshot-sorted characters", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId, "Roster#4444");
    const firstCharacterId = await seedCharacter({
      playerId,
      name: "Alpha",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });
    const secondCharacterId = await seedCharacter({
      playerId,
      name: "Bravo",
      realm: "Draenor",
      className: "Paladin",
      race: "Dwarf",
      faction: "alliance",
    });

    await seedSnapshot({
      characterId: firstCharacterId,
      takenAt: "2026-04-21T12:00:00.000Z",
      level: 80,
      spec: "Retribution",
      role: "dps",
      itemLevel: 726.8,
      gold: 2400,
      playtimeSeconds: 12_000,
      mythicPlusScore: 3180,
      ownedKeystone: {
        level: 16,
        mapChallengeModeID: 375,
        mapName: "Mists of Tirna Scithe",
      },
    });
    await seedSnapshot({
      characterId: secondCharacterId,
      takenAt: "2026-04-20T12:00:00.000Z",
      level: 80,
      spec: "Holy",
      role: "healer",
      itemLevel: 719.1,
      gold: 1300,
      playtimeSeconds: 9000,
      mythicPlusScore: 2875,
    });

    const response = await app.request(`http://localhost/api/players/${playerId}/characters`);

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      player: { playerId: string; battleTag: string };
      summary: {
        trackedCharacters: number;
        scannedCharacters: number;
        totalPlaytimeSeconds: number;
        totalGold: number;
        highestMythicPlusScore: number | null;
        highestMythicPlusCharacterName: string | null;
        averageItemLevel: number | null;
        bestKeystone: {
          level: number;
          mapChallengeModeID: number | null;
          mapName: string | null;
        } | null;
        latestSnapshotAt: number | null;
      };
      characters: Array<{
        _id: string;
        name: string;
        snapshot: { mythicPlusScore: number } | null;
      }>;
    };

    assert.equal(payload.player.playerId, playerId);
    assert.equal(payload.player.battleTag, "Roster#4444");
    assert.equal(payload.summary.trackedCharacters, 2);
    assert.equal(payload.summary.scannedCharacters, 2);
    assert.equal(payload.summary.totalPlaytimeSeconds, 21_000);
    assert.equal(payload.summary.totalGold, 3700);
    assert.equal(payload.summary.highestMythicPlusScore, 3180);
    assert.equal(payload.summary.highestMythicPlusCharacterName, "Alpha");
    assert.equal(payload.summary.averageItemLevel, (726.8 + 719.1) / 2);
    assert.deepEqual(payload.summary.bestKeystone, {
      level: 16,
      mapChallengeModeID: 375,
      mapName: "Mists of Tirna Scithe",
    });
    assert.equal(payload.summary.latestSnapshotAt, 1_776_772_800);
    assert.deepEqual(
      payload.characters.map((character) => character._id),
      [firstCharacterId, secondCharacterId],
    );
  });

  it("returns the authenticated player's characters for /api/characters", async () => {
    const auth = await seedAuthenticatedUser();
    const ownPlayerId = await seedPlayer(auth.userId, "Owner#1111");
    const otherAuth = await seedAuthenticatedUser();
    const otherPlayerId = await seedPlayer(otherAuth.userId, "Other#2222");
    const ownCharacterId = await seedCharacter({
      playerId: ownPlayerId,
      name: "OwnerChar",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });
    await seedCharacter({
      playerId: otherPlayerId,
      name: "OtherChar",
      realm: "Draenor",
      className: "Paladin",
      race: "Dwarf",
      faction: "alliance",
    });

    await seedSnapshot({
      characterId: ownCharacterId,
      takenAt: "2026-04-21T12:00:00.000Z",
      level: 80,
      spec: "Holy",
      role: "healer",
      itemLevel: 722.2,
      gold: 2100,
      playtimeSeconds: 8300,
      mythicPlusScore: 2950,
      ownedKeystone: {
        level: 14,
        mapChallengeModeID: 244,
        mapName: "The MOTHERLODE!!",
      },
    });

    const response = await app.request("http://localhost/api/characters", {
      headers: authHeaders(auth.token),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as Array<{
      _id: string;
      playerId: string;
      snapshot: { itemLevel: number; mythicPlusScore: number; takenAt: number } | null;
    }> | null;

    assert.ok(payload);
    assert.equal(payload.length, 1);
    assert.equal(payload[0]?._id, ownCharacterId);
    assert.equal(payload[0]?.playerId, ownPlayerId);
    assert.deepEqual(payload[0]?.snapshot, {
      itemLevel: 722.2,
      mythicPlusScore: 2950,
      takenAt: 1_776_772_800,
      gold: 2100,
      level: 80,
      ownedKeystone: {
        level: 14,
        mapChallengeModeID: 244,
        mapName: "The MOTHERLODE!!",
      },
      playtimeSeconds: 8300,
      role: "healer",
      spec: "Holy",
    });
  });

  it("returns a character page payload with header, core timeline, and mythic plus data", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId, "Page#1111");
    const characterId = await seedCharacter({
      playerId,
      name: "PageHero",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });

    await seedSnapshot({
      characterId,
      takenAt: "2026-04-21T12:00:00.000Z",
      level: 80,
      spec: "Protection",
      role: "tank",
      itemLevel: 730.5,
      gold: 4200,
      playtimeSeconds: 11_000,
      mythicPlusScore: 3250,
      ownedKeystone: {
        level: 17,
        mapChallengeModeID: 375,
        mapName: "Mists of Tirna Scithe",
      },
    });

    await db
      .update(characters)
      .set({
        mythicPlusSummary: {
          latestSeasonID: null,
          currentScore: 1111,
          overall: {
            totalRuns: 0,
            completedRuns: 0,
            timedRuns: 0,
            timed2To9: 0,
            timed10To11: 0,
            timed12To13: 0,
            timed14Plus: 0,
            bestLevel: null,
            bestTimedLevel: null,
            bestTimedUpgradeCount: null,
            bestTimedScore: null,
            bestTimedDurationMs: null,
            bestScore: null,
            averageLevel: null,
            averageScore: null,
            lastRunAt: null,
          },
          currentSeason: null,
          currentSeasonDungeons: [],
        },
        mythicPlusRecentRunsPreview: [],
        mythicPlusRunCount: 0,
      })
      .where(eq(characters.id, characterId));

    const response = await app.request(
      `http://localhost/api/characters/${characterId}/page?timeFrame=all&includeStats=false`,
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      header: {
        character: { _id: string; name: string; nonTradeableSlots: string[] | null };
        owner: { playerId: string; battleTag: string } | null;
        latestSnapshot: { itemLevel: number; mythicPlusScore: number } | null;
        firstSnapshotAt: number | null;
      };
      coreTimeline: {
        snapshots: Array<{ takenAt: number; itemLevel: number; currencies: object }>;
      };
      statsTimeline: null | { snapshots: Array<unknown> };
      mythicPlus: {
        totalRunCount: number;
        runs: Array<unknown>;
        summary: { currentScore: number | null };
      };
    } | null;

    assert.ok(payload);
    assert.equal(payload.header.character._id, characterId);
    assert.equal(payload.header.character.name, "PageHero");
    assert.equal(payload.header.owner?.playerId, playerId);
    assert.equal(payload.header.owner?.battleTag, "Page#1111");
    assert.equal(payload.header.latestSnapshot?.itemLevel, 730.5);
    assert.equal(payload.header.latestSnapshot?.mythicPlusScore, 3250);
    assert.equal(payload.header.firstSnapshotAt, 1_776_772_800);
    assert.equal(payload.coreTimeline.snapshots.length, 1);
    assert.equal(payload.coreTimeline.snapshots[0]?.takenAt, 1_776_772_800);
    assert.equal(payload.coreTimeline.snapshots[0]?.itemLevel, 730.5);
    assert.equal(payload.statsTimeline, null);
    assert.equal(payload.mythicPlus.totalRunCount, 0);
    assert.equal(payload.mythicPlus.summary.currentScore, 3250);
  });

  it("returns a stats detail timeline for a character", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId, "Stats#1111");
    const characterId = await seedCharacter({
      playerId,
      name: "StatHero",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });

    await seedSnapshot({
      characterId,
      takenAt: "2026-04-20T12:00:00.000Z",
      level: 80,
      spec: "Protection",
      role: "tank",
      itemLevel: 725,
      gold: 1000,
      playtimeSeconds: 8000,
      mythicPlusScore: 3100,
    });
    await seedSnapshot({
      characterId,
      takenAt: "2026-04-21T12:00:00.000Z",
      level: 80,
      spec: "Protection",
      role: "tank",
      itemLevel: 729,
      gold: 1200,
      playtimeSeconds: 8600,
      mythicPlusScore: 3180,
    });

    const response = await app.request(
      `http://localhost/api/characters/${characterId}/detail-timeline?timeFrame=all&metric=stats`,
      {
        headers: authHeaders(auth.token),
      },
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      metric: "stats";
      snapshots: Array<{ takenAt: number; stats: { stamina: number; versatilityPercent: number } }>;
    } | null;

    assert.ok(payload);
    assert.equal(payload.metric, "stats");
    assert.equal(payload.snapshots.length, 2);
    assert.equal(payload.snapshots[0]?.takenAt, 1_776_686_400);
    assert.equal(payload.snapshots[1]?.takenAt, 1_776_772_800);
  });

  it("returns snapshot timeline data for compare charts", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId, "Compare#1111");
    const characterId = await seedCharacter({
      playerId,
      name: "CompareHero",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });

    await seedSnapshot({
      characterId,
      takenAt: "2026-04-18T12:00:00.000Z",
      level: 80,
      spec: "Protection",
      role: "tank",
      itemLevel: 720,
      gold: 900,
      playtimeSeconds: 7000,
      mythicPlusScore: 3000,
      ownedKeystone: {
        level: 14,
        mapChallengeModeID: 244,
        mapName: "The MOTHERLODE!!",
      },
    });
    await seedSnapshot({
      characterId,
      takenAt: "2026-04-21T12:00:00.000Z",
      level: 80,
      spec: "Protection",
      role: "tank",
      itemLevel: 728,
      gold: 1400,
      playtimeSeconds: 8900,
      mythicPlusScore: 3210,
      ownedKeystone: {
        level: 16,
        mapChallengeModeID: 375,
        mapName: "Mists of Tirna Scithe",
      },
    });

    const response = await app.request(
      `http://localhost/api/characters/${characterId}/snapshot-timeline?timeFrame=all`,
      {
        headers: authHeaders(auth.token),
      },
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      snapshots: Array<{
        takenAt: number;
        itemLevel: number;
        mythicPlusScore: number;
        playtimeSeconds: number;
        ownedKeystone?: { level: number; mapChallengeModeID?: number; mapName?: string };
      }>;
    } | null;

    assert.ok(payload);
    assert.equal(payload.snapshots.length, 2);
    assert.equal(payload.snapshots[0]?.itemLevel, 720);
    assert.equal(payload.snapshots[1]?.mythicPlusScore, 3210);
    assert.deepEqual(payload.snapshots[1]?.ownedKeystone, {
      level: 16,
      mapChallengeModeID: 375,
      mapName: "Mists of Tirna Scithe",
    });
  });

  it("prefers the most complete snapshot when bucketed snapshots share a time bucket", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId, "Buckets#1111");
    const characterId = await seedCharacter({
      playerId,
      name: "BucketHero",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });

    await seedSnapshot({
      characterId,
      takenAt: "2026-04-21T12:10:00.000Z",
      level: 80,
      spec: "Protection",
      role: "tank",
      itemLevel: 720,
      gold: 900,
      playtimeSeconds: 7000,
      playtimeThisLevelSeconds: 1200,
      mythicPlusScore: 3000,
      ownedKeystone: {
        level: 14,
        mapChallengeModeID: 244,
        mapName: "The MOTHERLODE!!",
      },
    });
    await seedSnapshot({
      characterId,
      takenAt: "2026-04-21T12:20:00.000Z",
      level: 80,
      spec: "Protection",
      role: "tank",
      itemLevel: 718,
      gold: 800,
      playtimeSeconds: 7000,
      mythicPlusScore: 2990,
    });

    const response = await app.request(
      `http://localhost/api/characters/${characterId}/snapshot-timeline?timeFrame=all`,
      {
        headers: authHeaders(auth.token),
      },
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      snapshots: Array<{
        takenAt: number;
        itemLevel: number;
        ownedKeystone?: { level: number; mapChallengeModeID?: number; mapName?: string };
      }>;
    } | null;

    assert.ok(payload);
    assert.equal(payload.snapshots.length, 1);
    assert.equal(payload.snapshots[0]?.takenAt, 1_776_773_400);
    assert.equal(payload.snapshots[0]?.itemLevel, 720);
    assert.deepEqual(payload.snapshots[0]?.ownedKeystone, {
      level: 14,
      mapChallengeModeID: 244,
      mapName: "The MOTHERLODE!!",
    });
  });

  it("returns full mythic plus payloads for the character detail page", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId, "Runs#1111");
    const characterId = await seedCharacter({
      playerId,
      name: "Runner",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });

    await seedSnapshot({
      characterId,
      takenAt: "2026-04-21T12:00:00.000Z",
      level: 80,
      spec: "Protection",
      role: "tank",
      itemLevel: 731,
      gold: 1800,
      playtimeSeconds: 9200,
      mythicPlusScore: 3333,
    });

    await seedMythicPlusRun({
      characterId,
      observedAt: "2026-04-20T12:05:00.000Z",
      startDate: "2026-04-20T11:35:00.000Z",
      completedAt: "2026-04-20T12:05:00.000Z",
      level: 15,
      mapChallengeModeId: 244,
      mapName: "The MOTHERLODE!!",
      runScore: 210,
      fingerprint: "run-one",
    });
    await seedMythicPlusRun({
      characterId,
      observedAt: "2026-04-21T12:10:00.000Z",
      startDate: "2026-04-21T11:38:00.000Z",
      completedAt: "2026-04-21T12:10:00.000Z",
      level: 17,
      mapChallengeModeId: 375,
      mapName: "Mists of Tirna Scithe",
      runScore: 265,
      fingerprint: "run-two",
    });

    const response = await app.request(
      `http://localhost/api/characters/${characterId}/mythic-plus?includeAllRuns=true`,
      {
        headers: authHeaders(auth.token),
      },
    );

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      totalRunCount: number;
      isPreview: boolean;
      runs: Array<{ mapName?: string; level?: number; runScore?: number }>;
      summary: {
        currentScore: number | null;
        overall: { totalRuns: number; bestLevel: number | null };
      };
    } | null;

    assert.ok(payload);
    assert.equal(payload.totalRunCount, 2);
    assert.equal(payload.isPreview, false);
    assert.equal(payload.runs.length, 2);
    assert.equal(payload.runs[0]?.mapName, "Mists of Tirna Scithe");
    assert.equal(payload.runs[0]?.level, 17);
    assert.equal(payload.summary.currentScore, 3333);
    assert.equal(payload.summary.overall.totalRuns, 2);
    assert.equal(payload.summary.overall.bestLevel, 17);
  });

  it("returns character scoreboard rows sorted by mythic plus score", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId, "Score#1000");
    const firstCharacterId = await seedCharacter({
      playerId,
      name: "Topper",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });
    const secondCharacterId = await seedCharacter({
      playerId,
      name: "Runner",
      realm: "Draenor",
      className: "Paladin",
      race: "Dwarf",
      faction: "alliance",
    });

    await seedSnapshot({
      characterId: secondCharacterId,
      takenAt: "2026-04-20T12:00:00.000Z",
      level: 80,
      spec: "Holy",
      role: "healer",
      itemLevel: 720.5,
      gold: 1800,
      playtimeSeconds: 7600,
      mythicPlusScore: 2890,
    });
    await seedSnapshot({
      characterId: firstCharacterId,
      takenAt: "2026-04-21T12:00:00.000Z",
      level: 80,
      spec: "Retribution",
      role: "dps",
      itemLevel: 728.3,
      gold: 2500,
      playtimeSeconds: 9400,
      mythicPlusScore: 3210,
      ownedKeystone: {
        level: 17,
        mapChallengeModeID: 376,
        mapName: "Theater of Pain",
      },
    });

    const response = await app.request("http://localhost/api/characters/scoreboard");

    assert.equal(response.status, 200);
    const payload = (await response.json()) as Array<{
      characterId: string;
      playerId: string;
      mythicPlusScore: number;
      itemLevel: number;
      ownedKeystone: { level: number; mapChallengeModeID?: number; mapName?: string } | null;
    }>;

    assert.deepEqual(
      payload.map((entry) => entry.characterId),
      [firstCharacterId, secondCharacterId],
    );
    assert.equal(payload[0]?.playerId, playerId);
    assert.equal(payload[0]?.mythicPlusScore, 3210);
    assert.equal(payload[0]?.itemLevel, 728.3);
    assert.deepEqual(payload[0]?.ownedKeystone, {
      level: 17,
      mapChallengeModeID: 376,
      mapName: "Theater of Pain",
    });
  });

  it("returns aggregated player scoreboard rows", async () => {
    const auth = await seedAuthenticatedUser();
    const firstPlayerId = await seedPlayer(auth.userId, "Alpha#1000");
    const secondAuth = await seedAuthenticatedUser();
    const secondPlayerId = await seedPlayer(secondAuth.userId, "Bravo#2000");

    const alphaMainId = await seedCharacter({
      playerId: firstPlayerId,
      name: "AlphaMain",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });
    const alphaAltId = await seedCharacter({
      playerId: firstPlayerId,
      name: "AlphaAlt",
      realm: "Draenor",
      className: "Paladin",
      race: "Dwarf",
      faction: "alliance",
    });
    const bravoMainId = await seedCharacter({
      playerId: secondPlayerId,
      name: "BravoMain",
      realm: "Silvermoon",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });

    await seedSnapshot({
      characterId: alphaMainId,
      takenAt: "2026-04-21T12:00:00.000Z",
      level: 80,
      spec: "Retribution",
      role: "dps",
      itemLevel: 730.1,
      gold: 3000,
      playtimeSeconds: 10_000,
      mythicPlusScore: 3300,
      ownedKeystone: {
        level: 18,
        mapChallengeModeID: 375,
        mapName: "Mists of Tirna Scithe",
      },
    });
    await seedSnapshot({
      characterId: alphaAltId,
      takenAt: "2026-04-20T12:00:00.000Z",
      level: 80,
      spec: "Holy",
      role: "healer",
      itemLevel: 720.1,
      gold: 1200,
      playtimeSeconds: 8000,
      mythicPlusScore: 2800,
    });
    await seedSnapshot({
      characterId: bravoMainId,
      takenAt: "2026-04-19T12:00:00.000Z",
      level: 80,
      spec: "Holy",
      role: "healer",
      itemLevel: 725.5,
      gold: 2500,
      playtimeSeconds: 9500,
      mythicPlusScore: 3100,
      ownedKeystone: {
        level: 15,
        mapChallengeModeID: 244,
        mapName: "The MOTHERLODE!!",
      },
    });

    const response = await app.request("http://localhost/api/scoreboard/players");

    assert.equal(response.status, 200);
    const payload = (await response.json()) as Array<{
      playerId: string;
      battleTag: string;
      totalPlaytimeSeconds: number;
      totalGold: number;
      highestMythicPlusScore: number;
      highestMythicPlusCharacterName: string | null;
      averageItemLevel: number;
      characterCount: number;
      bestKeystoneLevel: number | null;
      bestKeystoneMapChallengeModeID: number | null;
      bestKeystoneMapName: string | null;
      latestSnapshotAt: number | null;
    }>;

    assert.deepEqual(
      payload.map((entry) => entry.playerId),
      [firstPlayerId, secondPlayerId],
    );
    assert.equal(payload[0]?.battleTag, "Alpha#1000");
    assert.equal(payload[0]?.totalPlaytimeSeconds, 18_000);
    assert.equal(payload[0]?.totalGold, 4200);
    assert.equal(payload[0]?.highestMythicPlusScore, 3300);
    assert.equal(payload[0]?.highestMythicPlusCharacterName, "AlphaMain");
    assert.equal(payload[0]?.averageItemLevel, (730.1 + 720.1) / 2);
    assert.equal(payload[0]?.characterCount, 2);
    assert.equal(payload[0]?.bestKeystoneLevel, 18);
    assert.equal(payload[0]?.bestKeystoneMapChallengeModeID, 375);
    assert.equal(payload[0]?.bestKeystoneMapName, "Mists of Tirna Scithe");
    assert.equal(payload[0]?.latestSnapshotAt, 1_776_772_800);
  });

  it("queues a resync request and returns cooldown info when rate-limited", async () => {
    const auth = await seedAuthenticatedUser();
    await seedPlayer(auth.userId, "Resync#5555");
    await seedBattleNetAccount({
      userId: auth.userId,
      accessToken: "live-access-token",
    });

    const firstResponse = await app.request("http://localhost/api/characters/resync", {
      method: "POST",
      headers: authHeaders(auth.token),
    });
    assert.equal(firstResponse.status, 200);
    const firstPayload = (await firstResponse.json()) as {
      ok: boolean;
      nextAllowedAt: number | null;
    };
    assert.deepEqual(firstPayload, {
      ok: true,
      nextAllowedAt: null,
    });

    let rateLimitedPayload: { ok: boolean; nextAllowedAt: number | null } | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.request("http://localhost/api/characters/resync", {
        method: "POST",
        headers: authHeaders(auth.token),
      });
      assert.equal(response.status, 200);
      rateLimitedPayload = (await response.json()) as {
        ok: boolean;
        nextAllowedAt: number | null;
      };
    }

    assert.ok(rateLimitedPayload);
    assert.equal(rateLimitedPayload.ok, false);
    assert.ok(rateLimitedPayload.nextAllowedAt !== null);
    assert.ok((rateLimitedPayload.nextAllowedAt ?? 0) >= Date.now());
  });

  it("updates the booster flag through /api/characters/:id/booster", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId);
    const characterId = await seedCharacter({
      playerId,
      name: "ToggleMe",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });

    const response = await app.request(`http://localhost/api/characters/${characterId}/booster`, {
      method: "PATCH",
      headers: {
        ...authHeaders(auth.token),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        isBooster: true,
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      characterId: string;
      isBooster: boolean;
    };
    assert.deepEqual(payload, {
      characterId,
      isBooster: true,
    });

    const character = await db.query.characters.findFirst({
      where: eq(characters.id, characterId),
    });
    assert.equal(character?.isBooster, true);
  });

  it("normalizes and stores non-tradeable slots through /api/characters/:id/slots", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId);
    const characterId = await seedCharacter({
      playerId,
      name: "TradeLock",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });

    const response = await app.request(`http://localhost/api/characters/${characterId}/slots`, {
      method: "PATCH",
      headers: {
        ...authHeaders(auth.token),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        nonTradeableSlots: ["head", "head", "trinket1"],
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      characterId: string;
      nonTradeableSlots: string[];
    };
    assert.deepEqual(payload, {
      characterId,
      nonTradeableSlots: ["head", "trinket1"],
    });

    const character = await db.query.characters.findFirst({
      where: eq(characters.id, characterId),
    });
    assert.deepEqual(character?.nonTradeableSlots, ["head", "trinket1"]);
  });

  it("returns copy-helper booster export payload sorted by role and score", async () => {
    const auth = await seedAuthenticatedUser();
    const firstPlayerId = await seedPlayer(auth.userId, "TankOwner#1");
    const secondAuth = await seedAuthenticatedUser();
    const secondPlayerId = await seedPlayer(secondAuth.userId, "DpsOwner#2");
    const thirdAuth = await seedAuthenticatedUser();
    const thirdPlayerId = await seedPlayer(thirdAuth.userId, "NoSnapshot#3");

    await db
      .update(players)
      .set({ discordUserId: "111111111" })
      .where(eq(players.id, firstPlayerId));
    await db
      .update(players)
      .set({ discordUserId: "222222222" })
      .where(eq(players.id, secondPlayerId));

    const tankCharacterId = await seedCharacter({
      playerId: firstPlayerId,
      name: "Tanky",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });
    const dpsCharacterId = await seedCharacter({
      playerId: secondPlayerId,
      name: "Dpsy",
      realm: "Draenor",
      className: "Paladin",
      race: "Dwarf",
      faction: "alliance",
    });
    const noSnapshotCharacterId = await seedCharacter({
      playerId: thirdPlayerId,
      name: "Later",
      realm: "Silvermoon",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });

    await db
      .update(characters)
      .set({
        isBooster: true,
        nonTradeableSlots: ["head", "trinket1"],
      })
      .where(eq(characters.id, tankCharacterId));
    await db
      .update(characters)
      .set({
        isBooster: true,
        nonTradeableSlots: ["mainHand"],
      })
      .where(eq(characters.id, dpsCharacterId));
    await db
      .update(characters)
      .set({
        isBooster: true,
        nonTradeableSlots: null,
      })
      .where(eq(characters.id, noSnapshotCharacterId));

    await seedSnapshot({
      characterId: tankCharacterId,
      takenAt: "2026-04-21T12:00:00.000Z",
      level: 80,
      spec: "Protection",
      role: "tank",
      itemLevel: 729.4,
      gold: 1200,
      playtimeSeconds: 7000,
      mythicPlusScore: 3100,
      ownedKeystone: {
        level: 16,
        mapChallengeModeID: 375,
        mapName: "Mists of Tirna Scithe",
      },
    });
    await seedSnapshot({
      characterId: dpsCharacterId,
      takenAt: "2026-04-20T12:00:00.000Z",
      level: 80,
      spec: "Retribution",
      role: "dps",
      itemLevel: 727.5,
      gold: 1300,
      playtimeSeconds: 6800,
      mythicPlusScore: 3200,
      ownedKeystone: {
        level: 15,
        mapChallengeModeID: 244,
        mapName: "The MOTHERLODE!!",
      },
    });

    const response = await app.request("http://localhost/api/characters/boosters/export", {
      headers: authHeaders(auth.token),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as Array<{
      _id: string;
      ownerBattleTag: string | null;
      ownerDiscordUserId: string | null;
      nonTradeableSlots: string[];
      snapshot: { role: string; mythicPlusScore: number } | null;
    }>;

    assert.deepEqual(
      payload.map((entry) => entry._id),
      [tankCharacterId, dpsCharacterId, noSnapshotCharacterId],
    );
    assert.equal(payload[0]?.ownerBattleTag, "TankOwner#1");
    assert.equal(payload[0]?.ownerDiscordUserId, "111111111");
    assert.deepEqual(payload[0]?.nonTradeableSlots, ["head", "trinket1"]);
    assert.equal(payload[0]?.snapshot?.role, "tank");
    assert.equal(payload[1]?.snapshot?.role, "dps");
    assert.equal(payload[1]?.snapshot?.mythicPlusScore, 3200);
    assert.equal(payload[2]?.snapshot, null);
  });

  it("ingests addon snapshots and mythic plus runs", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId, "Uploader#3333");
    const takenAt = 1_776_772_800;
    const startDate = 1_776_771_000;

    const response = await app.request("http://localhost/api/addon/ingest", {
      method: "POST",
      headers: {
        ...authHeaders(auth.token),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        characters: [
          {
            name: "Syncadin",
            realm: "Tarren Mill",
            region: "eu",
            class: "Paladin",
            race: "Human",
            faction: "alliance",
            snapshots: [
              {
                takenAt,
                level: 80,
                spec: "Holy",
                role: "healer",
                itemLevel: 724.6,
                gold: 2100,
                playtimeSeconds: 8200,
                playtimeThisLevelSeconds: 1200,
                mythicPlusScore: 2988.4,
                ownedKeystone: {
                  level: 15,
                  mapChallengeModeID: 375,
                  mapName: "Mists of Tirna Scithe",
                },
                currencies: {
                  adventurerDawncrest: 1,
                  veteranDawncrest: 2,
                  championDawncrest: 3,
                  heroDawncrest: 4,
                  mythDawncrest: 5,
                  radiantSparkDust: 6,
                },
                stats: {
                  stamina: 10,
                  strength: 11,
                  agility: 12,
                  intellect: 13,
                  critPercent: 14,
                  hastePercent: 15,
                  masteryPercent: 16,
                  versatilityPercent: 17,
                  speedPercent: 18,
                  leechPercent: 19,
                  avoidancePercent: 20,
                },
              },
            ],
            mythicPlusRuns: [
              {
                fingerprint: "attempt|13|375|15|1776771000",
                observedAt: takenAt,
                seasonID: 13,
                mapChallengeModeID: 375,
                mapName: "Mists of Tirna Scithe",
                level: 15,
                completed: true,
                completedInTime: true,
                durationMs: 1_800_000,
                runScore: 210.5,
                startDate,
                completedAt: takenAt,
                endedAt: takenAt,
                thisWeek: true,
                members: [
                  {
                    name: "Syncadin",
                    realm: "Tarren Mill",
                    classTag: "PALADIN",
                    role: "healer",
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      newChars: number;
      newSnapshots: number;
      newMythicPlusRuns: number;
      collapsedMythicPlusRuns: number;
    };

    assert.deepEqual(payload, {
      newChars: 1,
      newSnapshots: 1,
      newMythicPlusRuns: 1,
      collapsedMythicPlusRuns: 0,
    });

    const character = await db.query.characters.findFirst({
      where: and(eq(characters.playerId, playerId), eq(characters.name, "Syncadin")),
    });
    assert.ok(character);
    assert.equal(character.region, "eu");
    assert.equal(character.snapshotCount, 1);
    assert.equal(character.mythicPlusRunCount, 1);
    assert.equal(character.firstSnapshotAt?.toISOString(), "2026-04-21T12:00:00.000Z");
    assert.equal(character.latestSnapshot?.itemLevel, 724.6);
    assert.equal(character.latestSnapshotDetails?.currencies.radiantSparkDust, 6);
    assert.equal(character.mythicPlusSummary?.overall.totalRuns, 1);
    assert.equal(character.mythicPlusSummary?.currentSeason?.bestTimedLevel, 15);
    assert.equal(character.mythicPlusRecentRunsPreview?.[0]?.mapChallengeModeID, 375);

    const storedSnapshots = await db.query.snapshots.findMany({
      where: eq(snapshots.characterId, character.id),
    });
    const storedDailySnapshots = await db.query.characterDailySnapshots.findMany({
      where: eq(characterDailySnapshots.characterId, character.id),
    });
    const storedRuns = await db.query.mythicPlusRuns.findMany({
      where: eq(mythicPlusRuns.characterId, character.id),
    });

    assert.equal(storedSnapshots.length, 1);
    assert.equal(storedDailySnapshots.length, 1);
    assert.equal(storedRuns.length, 1);
  });

  it("matches addon characters by normalized realm and name", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId, "CaseSync#7777");
    await seedCharacter({
      playerId,
      name: "syncadin",
      realm: "tarren mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });

    const response = await app.request("http://localhost/api/addon/ingest", {
      method: "POST",
      headers: {
        ...authHeaders(auth.token),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        characters: [
          {
            name: "Syncadin",
            realm: "Tarren Mill",
            region: "eu",
            class: "Paladin",
            race: "Human",
            faction: "alliance",
            snapshots: [],
            mythicPlusRuns: [],
          },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as { newChars: number };
    assert.equal(payload.newChars, 0);

    const storedCharacters = await db.query.characters.findMany({
      where: eq(characters.playerId, playerId),
    });
    assert.equal(storedCharacters.length, 1);
    assert.equal(storedCharacters[0]?.name, "Syncadin");
    assert.equal(storedCharacters[0]?.realm, "Tarren Mill");
  });

  it("merges more complete snapshot fields into an existing snapshot with the same natural key", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId, "Syncer#7777");
    const characterId = await seedCharacter({
      playerId,
      name: "Syncadin",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });
    const takenAt = 1_776_772_800;

    const partialPayload = {
      characters: [
        {
          name: "Syncadin",
          realm: "Tarren Mill",
          region: "eu",
          class: "Paladin",
          race: "Human",
          faction: "alliance",
          snapshots: [
            {
              takenAt,
              level: 80,
              spec: "Holy",
              role: "healer",
              itemLevel: 724.6,
              gold: 2100,
              playtimeSeconds: 8200,
              mythicPlusScore: 2988.4,
              currencies: {
                adventurerDawncrest: 1,
                veteranDawncrest: 2,
                championDawncrest: 3,
                heroDawncrest: 4,
                mythDawncrest: 5,
                radiantSparkDust: 6,
              },
              stats: {
                stamina: 10,
                strength: 11,
                agility: 12,
                intellect: 13,
                critPercent: 14,
                hastePercent: 15,
                masteryPercent: 16,
                versatilityPercent: 17,
              },
            },
          ],
          mythicPlusRuns: [],
        },
      ],
    };
    const partialCharacter = partialPayload.characters[0]!;
    const partialSnapshot = partialCharacter.snapshots[0]!;

    const completePayload = {
      characters: [
        {
          ...partialCharacter,
          snapshots: [
            {
              ...partialSnapshot,
              playtimeThisLevelSeconds: 1200,
              ownedKeystone: {
                level: 15,
                mapChallengeModeID: 375,
                mapName: "Mists of Tirna Scithe",
              },
              stats: {
                ...partialSnapshot.stats,
                speedPercent: 18,
                leechPercent: 19,
                avoidancePercent: 20,
              },
            },
          ],
        },
      ],
    };

    const partialResponse = await app.request("http://localhost/api/addon/ingest", {
      method: "POST",
      headers: {
        ...authHeaders(auth.token),
        "content-type": "application/json",
      },
      body: JSON.stringify(partialPayload),
    });
    assert.equal(partialResponse.status, 200);

    await db
      .update(snapshots)
      .set({ legacyConvexId: "legacy-snapshot-merge-test" })
      .where(
        and(
          eq(snapshots.characterId, characterId),
          eq(snapshots.takenAt, new Date(takenAt * 1000)),
        ),
      );

    const completeResponse = await app.request("http://localhost/api/addon/ingest", {
      method: "POST",
      headers: {
        ...authHeaders(auth.token),
        "content-type": "application/json",
      },
      body: JSON.stringify(completePayload),
    });

    assert.equal(completeResponse.status, 200);

    const partialResult = (await partialResponse.json()) as {
      newSnapshots: number;
    };
    const completeResult = (await completeResponse.json()) as {
      newSnapshots: number;
    };
    assert.deepEqual(
      [partialResult.newSnapshots, completeResult.newSnapshots].sort((a, b) => a - b),
      [0, 1],
    );

    const storedSnapshots = await db.query.snapshots.findMany({
      where: eq(snapshots.characterId, characterId),
    });
    assert.equal(storedSnapshots.length, 1);
    assert.equal(storedSnapshots[0]?.playtimeThisLevelSeconds, 1200);
    assert.deepEqual(storedSnapshots[0]?.ownedKeystone, {
      level: 15,
      mapChallengeModeID: 375,
      mapName: "Mists of Tirna Scithe",
    });
    assert.equal(storedSnapshots[0]?.stats.speedPercent, 18);
    assert.equal(storedSnapshots[0]?.stats.leechPercent, 19);
    assert.equal(storedSnapshots[0]?.stats.avoidancePercent, 20);
    assert.equal(storedSnapshots[0]?.legacyConvexId, "legacy-snapshot-merge-test");
  });

  it("returns a clear error when addon ingest runs before the player profile exists", async () => {
    const auth = await seedAuthenticatedUser();

    const response = await app.request("http://localhost/api/addon/ingest", {
      method: "POST",
      headers: {
        ...authHeaders(auth.token),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        characters: [],
      }),
    });

    assert.equal(response.status, 400);
    const payload = (await response.json()) as {
      error: string;
    };
    assert.equal(
      payload.error,
      "Player record not found — do a Battle.net sync first to create your player profile.",
    );
  });

  it("normalizes Discord mentions through /api/players/:id/discord", async () => {
    const auth = await seedAuthenticatedUser();
    const playerId = await seedPlayer(auth.userId);

    const response = await app.request(`http://localhost/api/players/${playerId}/discord`, {
      method: "PATCH",
      headers: {
        ...authHeaders(auth.token),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        discordUserId: "<@!123456789>",
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      playerId: string;
      discordUserId: string | null;
    };

    assert.deepEqual(payload, {
      playerId,
      discordUserId: "123456789",
    });

    const player = await db.query.players.findFirst({
      where: eq(players.id, playerId),
    });

    assert.equal(player?.discordUserId, "123456789");
  });

  it("rejects cross-user writes to player and character mutation endpoints", async () => {
    const ownerAuth = await seedAuthenticatedUser();
    const attackerAuth = await seedAuthenticatedUser();
    const ownerPlayerId = await seedPlayer(ownerAuth.userId);
    const ownerCharacterId = await seedCharacter({
      playerId: ownerPlayerId,
      name: "Protected",
      realm: "Tarren Mill",
      className: "Paladin",
      race: "Human",
      faction: "alliance",
    });

    await db
      .update(players)
      .set({
        discordUserId: "123456789",
      })
      .where(eq(players.id, ownerPlayerId));

    await db
      .update(characters)
      .set({
        isBooster: false,
        nonTradeableSlots: ["head"],
      })
      .where(eq(characters.id, ownerCharacterId));

    const [discordResponse, boosterResponse, slotsResponse] = await Promise.all([
      app.request(`http://localhost/api/players/${ownerPlayerId}/discord`, {
        method: "PATCH",
        headers: {
          ...authHeaders(attackerAuth.token),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          discordUserId: "999999999",
        }),
      }),
      app.request(`http://localhost/api/characters/${ownerCharacterId}/booster`, {
        method: "PATCH",
        headers: {
          ...authHeaders(attackerAuth.token),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          isBooster: true,
        }),
      }),
      app.request(`http://localhost/api/characters/${ownerCharacterId}/slots`, {
        method: "PATCH",
        headers: {
          ...authHeaders(attackerAuth.token),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          nonTradeableSlots: ["trinket1", "trinket2"],
        }),
      }),
    ]);

    assert.equal(discordResponse.status, 404);
    assert.equal(boosterResponse.status, 404);
    assert.equal(slotsResponse.status, 404);

    const [player, character] = await Promise.all([
      db.query.players.findFirst({
        where: eq(players.id, ownerPlayerId),
      }),
      db.query.characters.findFirst({
        where: eq(characters.id, ownerCharacterId),
      }),
    ]);

    assert.equal(player?.discordUserId, "123456789");
    assert.equal(character?.isBooster, false);
    assert.deepEqual(character?.nonTradeableSlots, ["head"]);
  });
});
