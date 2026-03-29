import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { rateLimiter } from "./rateLimiter";

type MythicPlusRunDoc = Doc<"mythicPlusRuns">;

function getRunTimestamp(run: MythicPlusRunDoc): number {
  return run.completedAt ?? run.observedAt ?? run.startDate ?? 0;
}

function getMapLabel(run: MythicPlusRunDoc): string {
  if (run.mapName && run.mapName.trim() !== "") return run.mapName;
  if (run.mapChallengeModeID !== undefined) return `Dungeon ${run.mapChallengeModeID}`;
  return "Unknown Dungeon";
}

function hasRecordedCompletionEvidence(run: MythicPlusRunDoc): boolean {
  return run.durationMs !== undefined || run.runScore !== undefined || run.completedAt !== undefined;
}

function isCompletedRun(run: MythicPlusRunDoc): boolean {
  return run.completed === true || hasRecordedCompletionEvidence(run);
}

function isTimedRun(run: MythicPlusRunDoc): boolean {
  if (run.completedInTime !== undefined) return run.completedInTime;
  return run.completed === true;
}

function buildMythicPlusBucketSummary(runs: MythicPlusRunDoc[]) {
  let completedRuns = 0;
  let timedRuns = 0;
  let timed2Plus = 0;
  let timed5Plus = 0;
  let timed10Plus = 0;
  let bestLevel: number | null = null;
  let bestTimedLevel: number | null = null;
  let bestScore: number | null = null;
  let totalLevel = 0;
  let levelCount = 0;
  let totalScore = 0;
  let scoreCount = 0;
  let lastRunAt: number | null = null;

  for (const run of runs) {
    const runAt = getRunTimestamp(run);
    if (lastRunAt === null || runAt > lastRunAt) lastRunAt = runAt;

    if (isCompletedRun(run)) completedRuns += 1;
    if (isTimedRun(run)) {
      timedRuns += 1;
      if ((run.level ?? 0) >= 2) timed2Plus += 1;
      if ((run.level ?? 0) >= 5) timed5Plus += 1;
      if ((run.level ?? 0) >= 10) timed10Plus += 1;
    }

    if (run.level !== undefined) {
      bestLevel = bestLevel === null ? run.level : Math.max(bestLevel, run.level);
      totalLevel += run.level;
      levelCount += 1;
      if (isTimedRun(run)) {
        bestTimedLevel = bestTimedLevel === null ? run.level : Math.max(bestTimedLevel, run.level);
      }
    }

    if (run.runScore !== undefined) {
      bestScore = bestScore === null ? run.runScore : Math.max(bestScore, run.runScore);
      totalScore += run.runScore;
      scoreCount += 1;
    }
  }

  return {
    totalRuns: runs.length,
    completedRuns,
    timedRuns,
    timed2Plus,
    timed5Plus,
    timed10Plus,
    bestLevel,
    bestTimedLevel,
    bestScore,
    averageLevel: levelCount > 0 ? totalLevel / levelCount : null,
    averageScore: scoreCount > 0 ? totalScore / scoreCount : null,
    lastRunAt,
  };
}

function buildDungeonSummaries(runs: MythicPlusRunDoc[]) {
  const byDungeon = new Map<
    string,
    {
      mapChallengeModeID: number | null;
      mapName: string;
      totalRuns: number;
      timedRuns: number;
      bestLevel: number | null;
      bestTimedLevel: number | null;
      bestScore: number | null;
      lastRunAt: number | null;
    }
  >();

  for (const run of runs) {
    const key = String(run.mapChallengeModeID ?? getMapLabel(run));
    const current = byDungeon.get(key) ?? {
      mapChallengeModeID: run.mapChallengeModeID ?? null,
      mapName: getMapLabel(run),
      totalRuns: 0,
      timedRuns: 0,
      bestLevel: null,
      bestTimedLevel: null,
      bestScore: null,
      lastRunAt: null,
    };

    current.totalRuns += 1;
    if (isTimedRun(run)) current.timedRuns += 1;
    if (run.level !== undefined) {
      current.bestLevel = current.bestLevel === null ? run.level : Math.max(current.bestLevel, run.level);
      if (isTimedRun(run)) {
        current.bestTimedLevel =
          current.bestTimedLevel === null ? run.level : Math.max(current.bestTimedLevel, run.level);
      }
    }
    if (run.runScore !== undefined) {
      current.bestScore =
        current.bestScore === null ? run.runScore : Math.max(current.bestScore, run.runScore);
    }

    const runAt = getRunTimestamp(run);
    current.lastRunAt = current.lastRunAt === null ? runAt : Math.max(current.lastRunAt, runAt);
    byDungeon.set(key, current);
  }

  return Array.from(byDungeon.values()).sort((a, b) => {
    const timedA = a.bestTimedLevel ?? -1;
    const timedB = b.bestTimedLevel ?? -1;
    if (timedB !== timedA) return timedB - timedA;
    const bestA = a.bestLevel ?? -1;
    const bestB = b.bestLevel ?? -1;
    if (bestB !== bestA) return bestB - bestA;
    return b.timedRuns - a.timedRuns;
  });
}

function buildMythicPlusSummary(runs: MythicPlusRunDoc[]) {
  let latestSeasonID: number | null = null;
  for (const run of runs) {
    if (run.seasonID === undefined) continue;
    latestSeasonID = latestSeasonID === null ? run.seasonID : Math.max(latestSeasonID, run.seasonID);
  }

  const currentSeasonRuns =
    latestSeasonID === null ? [] : runs.filter((run) => run.seasonID === latestSeasonID);

  return {
    latestSeasonID,
    overall: buildMythicPlusBucketSummary(runs),
    currentSeason:
      latestSeasonID === null ? null : buildMythicPlusBucketSummary(currentSeasonRuns),
    currentSeasonDungeons: buildDungeonSummaries(currentSeasonRuns),
  };
}

export const upsertFromBattleNet = internalMutation({
  args: {
    userId: v.string(),
    region: v.union(v.literal("us"), v.literal("eu"), v.literal("kr"), v.literal("tw")),
    characters: v.array(
      v.object({
        name: v.string(),
        realm: v.string(),
        class: v.string(),
        race: v.string(),
        faction: v.union(v.literal("alliance"), v.literal("horde")),
      }),
    ),
  },
  handler: async (ctx, { userId, region, characters }) => {
    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!player) return;

    for (const char of characters) {
      const existing = await ctx.db
        .query("characters")
        .withIndex("by_player_and_realm", (q) =>
          q.eq("playerId", player._id).eq("realm", char.realm),
        )
        .filter((q) => q.eq(q.field("name"), char.name))
        .first();

      if (!existing) {
        await ctx.db.insert("characters", {
          playerId: player._id,
          name: char.name,
          realm: char.realm,
          region,
          class: char.class,
          race: char.race,
          faction: char.faction,
        });
      } else {
        await ctx.db.patch(existing._id, {
          class: char.class,
          race: char.race,
          faction: char.faction,
        });
      }
    }
  },
});

export const resyncCharacters = mutation({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return { ok: false, nextAllowedAt: null };

    const { ok, retryAfter } = await rateLimiter.limit(ctx, "battlenetSync", {
      key: authUser._id as string,
      throws: false,
    });

    if (!ok) {
      await ctx.runMutation(internal.audit.log, {
        userId: authUser._id as string,
        event: "battlenet.resync.rate_limited",
        metadata: { retryAfter },
      });
      return { ok: false, nextAllowedAt: Date.now() + (retryAfter ?? 60_000) };
    }

    const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [
        { field: "userId", value: authUser._id as string },
        { field: "providerId", value: "battlenet" },
      ],
    });

    if (!account?.accessToken) return { ok: false, nextAllowedAt: null };

    await ctx.scheduler.runAfter(0, internal.battlenet.syncCharacters, {
      userId: authUser._id as string,
      accessToken: account.accessToken as string,
    });

    await ctx.runMutation(internal.audit.log, {
      userId: authUser._id as string,
      event: "battlenet.resync",
    });

    return { ok: true, nextAllowedAt: null };
  },
});

export const getCharacterSnapshots = query({
  args: { characterId: v.id("characters") },
  handler: async (ctx, { characterId }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const character = await ctx.db.get(characterId);
    if (!character) return null;

    const snapshots = await ctx.db
      .query("snapshots")
      .withIndex("by_character_and_time", (q) => q.eq("characterId", characterId))
      .order("asc")
      .collect();

    return { character, snapshots };
  },
});

export const getCharacterMythicPlus = query({
  args: { characterId: v.id("characters") },
  handler: async (ctx, { characterId }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const character = await ctx.db.get(characterId);
    if (!character) return null;

    const runs = await ctx.db
      .query("mythicPlusRuns")
      .withIndex("by_character_and_observedAt", (q) => q.eq("characterId", characterId))
      .order("desc")
      .collect();

    const sortedRuns = runs.slice().sort((a, b) => {
      const timeDiff = getRunTimestamp(b) - getRunTimestamp(a);
      if (timeDiff !== 0) return timeDiff;
      return b.observedAt - a.observedAt;
    });

    return {
      runs: sortedRuns,
      summary: buildMythicPlusSummary(sortedRuns),
    };
  },
});

export const getScoreboard = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const characters = await ctx.db.query("characters").collect();

    const withSnapshots = await Promise.all(
      characters.map(async (char) => {
        const snapshot = await ctx.db
          .query("snapshots")
          .withIndex("by_character_and_time", (q) => q.eq("characterId", char._id))
          .order("desc")
          .first();
        if (!snapshot) return null;

        return {
          characterId: char._id,
          name: char.name,
          realm: char.realm,
          region: char.region,
          class: char.class,
          race: char.race,
          faction: char.faction,
          mythicPlusScore: snapshot.mythicPlusScore,
          itemLevel: snapshot.itemLevel,
          spec: snapshot.spec,
          role: snapshot.role,
          level: snapshot.level,
          takenAt: snapshot.takenAt,
        };
      }),
    );

    return withSnapshots
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.mythicPlusScore - a.mythicPlusScore || b.itemLevel - a.itemLevel);
  },
});

export const getPlayerScoreboard = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const characters = await ctx.db.query("characters").collect();

    const playerMap = new Map<
      string,
      { battleTag: string; totalPlaytimeSeconds: number; totalGold: number; characterCount: number }
    >();

    const charSnapshots = await Promise.all(
      characters.map(async (char) => {
        const snapshot = await ctx.db
          .query("snapshots")
          .withIndex("by_character_and_time", (q) => q.eq("characterId", char._id))
          .order("desc")
          .first();
        return { char, snapshot };
      }),
    );

    const playerIds = [...new Set(characters.map((c) => c.playerId))];
    const playerRecords = await Promise.all(playerIds.map((id) => ctx.db.get(id)));
    const playerBattleTagMap = new Map(
      playerIds.map((id, i) => [id.toString(), playerRecords[i]?.battleTag ?? ""]),
    );

    for (const { char, snapshot } of charSnapshots) {
      if (!snapshot) continue;
      const playerId = char.playerId.toString();
      const existing = playerMap.get(playerId);
      if (existing) {
        existing.totalPlaytimeSeconds += snapshot.playtimeSeconds;
        existing.totalGold += snapshot.gold;
        existing.characterCount += 1;
      } else {
        playerMap.set(playerId, {
          battleTag: playerBattleTagMap.get(playerId) ?? "",
          totalPlaytimeSeconds: snapshot.playtimeSeconds,
          totalGold: snapshot.gold,
          characterCount: 1,
        });
      }
    }

    return Array.from(playerMap.values()).sort(
      (a, b) => b.totalPlaytimeSeconds - a.totalPlaytimeSeconds || b.totalGold - a.totalGold,
    );
  },
});

export const getMyCharactersWithSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", authUser._id as string))
      .first();

    if (!player) return null;

    const characters = await ctx.db
      .query("characters")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .collect();

    return await Promise.all(
      characters.map(async (char) => {
        const snapshot = await ctx.db
          .query("snapshots")
          .withIndex("by_character_and_time", (q) => q.eq("characterId", char._id))
          .order("desc")
          .first();
        return { ...char, snapshot: snapshot ?? null };
      }),
    );
  },
});
