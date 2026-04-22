process.env.NODE_ENV = "test";
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

const [{ app }, { databaseConnection, db }, { closeQueue }, { closeRedis, ensureRedis }] = await Promise.all([
  import("./server"),
  import("./db"),
  import("./lib/queue"),
  import("./lib/redis"),
]);

async function truncateTables() {
  await db.execute(sql.raw(`
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
  `));
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

async function seedBattleNetAccount(input: {
  userId: string;
  accessToken?: string | null;
}) {
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
    playtimeThisLevelSeconds: null,
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

function authHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
  };
}

describe("Phase 5 API routes", { concurrency: false }, () => {
  beforeEach(async () => {
    await truncateTables();
    const redis = await ensureRedis();
    await redis.flushdb();
  });

  after(async () => {
    await truncateTables();
    await closeQueue();
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
      {
        headers: authHeaders(auth.token),
      },
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

    const response = await app.request(
      `http://localhost/api/players/${playerId}/characters`,
      {
        headers: authHeaders(auth.token),
      },
    );

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
        bestKeystone: { level: number; mapChallengeModeID: number | null; mapName: string | null } | null;
        latestSnapshotAt: number | null;
      };
      characters: Array<{ _id: string; name: string; snapshot: { mythicPlusScore: number } | null }>;
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

    const response = await app.request("http://localhost/api/characters/scoreboard", {
      headers: authHeaders(auth.token),
    });

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

    const response = await app.request("http://localhost/api/scoreboard/players", {
      headers: authHeaders(auth.token),
    });

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
});
