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
import { eq, sql } from "drizzle-orm";
import { characters, players, session as authSessions, snapshots, user as authUsers } from "@wow-dashboard/db";

const [{ app }, { databaseConnection, db }, { closeRedis }] = await Promise.all([
  import("./server"),
  import("./db"),
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
  spec: "Holy" | "Retribution";
  role: "healer" | "dps";
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

describe("Phase 5a API routes", { concurrency: false }, () => {
  beforeEach(async () => {
    await truncateTables();
  });

  after(async () => {
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
