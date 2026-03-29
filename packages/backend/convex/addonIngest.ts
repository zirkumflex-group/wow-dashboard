import { v } from "convex/values";

import { mutation } from "./_generated/server";
import { authComponent } from "./auth";
import { rateLimiter } from "./rateLimiter";
import { mythicPlusRunValidator } from "./schemas/mythicPlusRuns";
import { specValidator } from "./schemas/snapshots";
import { internal } from "./_generated/api";

const currenciesValidator = v.object({
  adventurerDawncrest: v.number(),
  veteranDawncrest: v.number(),
  championDawncrest: v.number(),
  heroDawncrest: v.number(),
  mythDawncrest: v.number(),
  radiantSparkDust: v.number(),
});

const statsValidator = v.object({
  stamina: v.number(),
  strength: v.number(),
  agility: v.number(),
  intellect: v.number(),
  critPercent: v.number(),
  hastePercent: v.number(),
  masteryPercent: v.number(),
  versatilityPercent: v.number(),
});

const snapshotValidator = v.object({
  takenAt: v.number(),
  level: v.number(),
  spec: specValidator,
  role: v.union(v.literal("tank"), v.literal("healer"), v.literal("dps")),
  itemLevel: v.number(),
  gold: v.number(),
  playtimeSeconds: v.number(),
  mythicPlusScore: v.number(),
  currencies: currenciesValidator,
  stats: statsValidator,
});

const characterValidator = v.object({
  name: v.string(),
  realm: v.string(),
  region: v.union(v.literal("us"), v.literal("eu"), v.literal("kr"), v.literal("tw")),
  class: v.string(),
  race: v.string(),
  faction: v.union(v.literal("alliance"), v.literal("horde")),
  snapshots: v.array(snapshotValidator),
  mythicPlusRuns: v.optional(v.array(mythicPlusRunValidator)),
});

export const ingestAddonData = mutation({
  args: { characters: v.array(characterValidator) },
  handler: async (ctx, { characters }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) throw new Error("Not authenticated");

    await rateLimiter.limit(ctx, "addonIngest", {
      key: authUser._id as string,
      throws: true,
    });

    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", authUser._id as string))
      .first();

    if (!player) {
      throw new Error(
        "Player record not found — do a Battle.net sync first to create your player profile.",
      );
    }

    const now = Date.now();
    const MAX_FUTURE_MS = 5 * 60 * 1000; // 5 minutes clock skew tolerance
    const MAX_PAST_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

    let newChars = 0;
    let newSnapshots = 0;
    let newMythicPlusRuns = 0;

    for (const charData of characters) {
      const existing = await ctx.db
        .query("characters")
        .withIndex("by_player_and_realm", (q) =>
          q.eq("playerId", player._id).eq("realm", charData.realm),
        )
        .filter((q) => q.eq(q.field("name"), charData.name))
        .first();

      let characterId;

      if (!existing) {
        characterId = await ctx.db.insert("characters", {
          playerId: player._id,
          name: charData.name,
          realm: charData.realm,
          region: charData.region,
          class: charData.class,
          race: charData.race,
          faction: charData.faction,
        });
        newChars++;
      } else {
        await ctx.db.patch(existing._id, {
          region: charData.region,
          class: charData.class,
          race: charData.race,
          faction: charData.faction,
        });
        characterId = existing._id;
      }

      for (const snap of charData.snapshots) {
        // takenAt is in seconds (WoW addon format); Date.now() is in milliseconds.
        const takenAtMs = snap.takenAt * 1000;
        if (takenAtMs > now + MAX_FUTURE_MS) {
          throw new Error(
            `Snapshot timestamp is in the future (takenAt=${snap.takenAt}s, now=${Math.floor(now / 1000)}s)`,
          );
        }
        if (takenAtMs < now - MAX_PAST_MS) {
          throw new Error(
            `Snapshot timestamp is older than 30 days (takenAt=${snap.takenAt}s, now=${Math.floor(now / 1000)}s)`,
          );
        }

        const existingSnap = await ctx.db
          .query("snapshots")
          .withIndex("by_character_and_time", (q) =>
            q.eq("characterId", characterId).eq("takenAt", snap.takenAt),
          )
          .first();

        if (!existingSnap) {
          await ctx.db.insert("snapshots", {
            characterId,
            takenAt: snap.takenAt,
            level: snap.level,
            spec: snap.spec,
            role: snap.role,
            itemLevel: snap.itemLevel,
            gold: snap.gold,
            playtimeSeconds: snap.playtimeSeconds,
            mythicPlusScore: snap.mythicPlusScore,
            currencies: snap.currencies,
            stats: snap.stats,
          });
          newSnapshots++;
        }
      }

      for (const run of charData.mythicPlusRuns ?? []) {
        const existingRun = await ctx.db
          .query("mythicPlusRuns")
          .withIndex("by_character_and_fingerprint", (q) =>
            q.eq("characterId", characterId).eq("fingerprint", run.fingerprint),
          )
          .first();

        if (!existingRun) {
          await ctx.db.insert("mythicPlusRuns", {
            characterId,
            fingerprint: run.fingerprint,
            observedAt: run.observedAt,
            seasonID: run.seasonID,
            mapChallengeModeID: run.mapChallengeModeID,
            mapName: run.mapName,
            level: run.level,
            completed: run.completed,
            completedInTime: run.completedInTime,
            durationMs: run.durationMs,
            runScore: run.runScore,
            startDate: run.startDate,
            completedAt: run.completedAt,
            thisWeek: run.thisWeek,
          });
          newMythicPlusRuns++;
        } else {
          const patch: {
            seasonID?: number;
            mapChallengeModeID?: number;
            mapName?: string;
            level?: number;
            completed?: boolean;
            completedInTime?: boolean;
            durationMs?: number;
            runScore?: number;
            startDate?: number;
            completedAt?: number;
            thisWeek?: boolean;
          } = {};

          if (existingRun.seasonID === undefined && run.seasonID !== undefined) patch.seasonID = run.seasonID;
          if (
            existingRun.mapChallengeModeID === undefined &&
            run.mapChallengeModeID !== undefined
          ) {
            patch.mapChallengeModeID = run.mapChallengeModeID;
          }
          if (!existingRun.mapName && run.mapName) patch.mapName = run.mapName;
          if (existingRun.level === undefined && run.level !== undefined) patch.level = run.level;
          if (existingRun.completed === undefined && run.completed !== undefined) patch.completed = run.completed;
          if (
            existingRun.completedInTime === undefined &&
            run.completedInTime !== undefined
          ) {
            patch.completedInTime = run.completedInTime;
          }
          if (existingRun.durationMs === undefined && run.durationMs !== undefined) {
            patch.durationMs = run.durationMs;
          }
          if (existingRun.runScore === undefined && run.runScore !== undefined) patch.runScore = run.runScore;
          if (existingRun.startDate === undefined && run.startDate !== undefined) patch.startDate = run.startDate;
          if (existingRun.completedAt === undefined && run.completedAt !== undefined) {
            patch.completedAt = run.completedAt;
          }
          if (existingRun.thisWeek === undefined && run.thisWeek !== undefined) patch.thisWeek = run.thisWeek;

          if (Object.keys(patch).length > 0) {
            await ctx.db.patch(existingRun._id, patch);
          }
        }
      }
    }

    await ctx.runMutation(internal.audit.log, {
      userId: authUser._id as string,
      event: "addon.ingest",
      metadata: { newChars, newSnapshots, newMythicPlusRuns, totalCharacters: characters.length },
    });

    return { newChars, newSnapshots, newMythicPlusRuns };
  },
});
