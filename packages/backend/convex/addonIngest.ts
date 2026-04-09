import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import {
  buildCanonicalMythicPlusRunFingerprint,
  mergeMythicPlusRunMembers,
  shouldReplaceMythicPlusRun,
} from "./mythicPlus";
import { rateLimiter } from "./rateLimiter";
import { mythicPlusRunValidator } from "./schemas/mythicPlusRuns";
import { normalizeSnapshotSpec } from "./schemas/snapshots";
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
  speedPercent: v.optional(v.number()),
  leechPercent: v.optional(v.number()),
  avoidancePercent: v.optional(v.number()),
});

const snapshotValidator = v.object({
  takenAt: v.number(),
  level: v.number(),
  spec: v.string(),
  role: v.union(v.literal("tank"), v.literal("healer"), v.literal("dps")),
  itemLevel: v.number(),
  gold: v.number(),
  playtimeSeconds: v.number(),
  playtimeThisLevelSeconds: v.optional(v.number()),
  mythicPlusScore: v.number(),
  currencies: currenciesValidator,
  stats: statsValidator,
});

type SnapshotDoc = Doc<"snapshots">;
type SnapshotFields = Pick<
  SnapshotDoc,
  | "takenAt"
  | "level"
  | "spec"
  | "role"
  | "itemLevel"
  | "gold"
  | "playtimeSeconds"
  | "playtimeThisLevelSeconds"
  | "mythicPlusScore"
  | "currencies"
  | "stats"
>;
type MythicPlusRunDoc = Doc<"mythicPlusRuns">;
type MythicPlusRunMembers = MythicPlusRunDoc["members"];

function setPreferredRunLookup(
  map: Map<string, MythicPlusRunDoc>,
  key: string | undefined | null,
  run: MythicPlusRunDoc,
) {
  if (!key) {
    return;
  }

  const current = map.get(key);
  if (shouldReplaceMythicPlusRun(current, run)) {
    map.set(key, run);
  }
}

function registerRunLookups(
  lookups: {
    byDedupKey: Map<string, MythicPlusRunDoc>;
    byFingerprint: Map<string, MythicPlusRunDoc>;
  },
  run: MythicPlusRunDoc,
  aliases: Array<string | undefined | null> = [],
) {
  const canonicalFingerprint = buildCanonicalMythicPlusRunFingerprint(run);
  setPreferredRunLookup(lookups.byDedupKey, canonicalFingerprint ?? run.fingerprint, run);

  const fingerprintAliases = new Set<string>();
  if (run.fingerprint) {
    fingerprintAliases.add(run.fingerprint);
  }
  for (const alias of aliases) {
    if (alias) {
      fingerprintAliases.add(alias);
    }
  }

  for (const fingerprint of fingerprintAliases) {
    setPreferredRunLookup(lookups.byFingerprint, fingerprint, run);
  }
}

function toSnapshotFields(snapshot: SnapshotFields): SnapshotFields {
  return {
    takenAt: snapshot.takenAt,
    level: snapshot.level,
    spec: snapshot.spec,
    role: snapshot.role,
    itemLevel: snapshot.itemLevel,
    gold: snapshot.gold,
    playtimeSeconds: snapshot.playtimeSeconds,
    playtimeThisLevelSeconds: snapshot.playtimeThisLevelSeconds,
    mythicPlusScore: snapshot.mythicPlusScore,
    currencies: snapshot.currencies,
    stats: snapshot.stats,
  };
}

function mergeSnapshotFields(existingSnapshot: SnapshotFields, incomingSnapshot: SnapshotFields): SnapshotFields {
  return {
    ...incomingSnapshot,
    playtimeSeconds:
      incomingSnapshot.playtimeSeconds > 0 ? incomingSnapshot.playtimeSeconds : existingSnapshot.playtimeSeconds,
    playtimeThisLevelSeconds:
      incomingSnapshot.playtimeThisLevelSeconds ?? existingSnapshot.playtimeThisLevelSeconds,
    stats: {
      ...incomingSnapshot.stats,
      speedPercent: incomingSnapshot.stats.speedPercent ?? existingSnapshot.stats.speedPercent,
      leechPercent: incomingSnapshot.stats.leechPercent ?? existingSnapshot.stats.leechPercent,
      avoidancePercent: incomingSnapshot.stats.avoidancePercent ?? existingSnapshot.stats.avoidancePercent,
    },
  };
}

function snapshotFieldsEqual(a: SnapshotFields, b: SnapshotFields) {
  return JSON.stringify(toSnapshotFields(a)) === JSON.stringify(toSnapshotFields(b));
}

function getMergedRunMembers(
  currentMembers: MythicPlusRunMembers | undefined,
  candidateMembers: MythicPlusRunMembers | undefined,
) {
  const mergedMembers = mergeMythicPlusRunMembers(currentMembers, candidateMembers);
  if (!mergedMembers) {
    return undefined;
  }

  return JSON.stringify(currentMembers ?? []) === JSON.stringify(mergedMembers)
    ? undefined
    : mergedMembers;
}

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

export const getMythicPlusBackfillStatus = query({
  args: {},
  handler: async () => {
    // Compatibility shim for released Electron clients that still query this endpoint.
    // Historical Mythic+ backfill is no longer used, so keep the shape but avoid the
    // expensive character/run scan that was causing client-visible server errors.
    return {
      needsBackfill: false,
      missingMapNameRuns: 0,
    };
  },
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
        const normalizedSpec = normalizeSnapshotSpec(snap.spec);
        if (!normalizedSpec) {
          continue;
        }

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

        const nextSnapshot: SnapshotFields = {
          takenAt: snap.takenAt,
          level: snap.level,
          spec: normalizedSpec as SnapshotFields["spec"],
          role: snap.role,
          itemLevel: snap.itemLevel,
          gold: snap.gold,
          playtimeSeconds: snap.playtimeSeconds,
          playtimeThisLevelSeconds: snap.playtimeThisLevelSeconds,
          mythicPlusScore: snap.mythicPlusScore,
          currencies: snap.currencies,
          stats: snap.stats,
        };

        const existingSnap = await ctx.db
          .query("snapshots")
          .withIndex("by_character_and_time", (q) =>
            q.eq("characterId", characterId).eq("takenAt", snap.takenAt),
          )
          .first();

        if (!existingSnap) {
          await ctx.db.insert("snapshots", {
            characterId,
            ...nextSnapshot,
          });
          newSnapshots++;
          continue;
        }

        const existingSnapshotFields = toSnapshotFields(existingSnap);
        const mergedSnapshot = mergeSnapshotFields(existingSnapshotFields, nextSnapshot);
        if (!snapshotFieldsEqual(existingSnapshotFields, mergedSnapshot)) {
          await ctx.db.patch(existingSnap._id, mergedSnapshot);
        }
      }

      const existingCharacterRuns = await ctx.db
        .query("mythicPlusRuns")
        .withIndex("by_character", (q) => q.eq("characterId", characterId))
        .collect();

      const existingRunLookups = {
        byDedupKey: new Map<string, MythicPlusRunDoc>(),
        byFingerprint: new Map<string, MythicPlusRunDoc>(),
      };
      for (const existingRun of existingCharacterRuns) {
        registerRunLookups(existingRunLookups, existingRun);
      }

      // Dedup incoming runs by canonical or legacy fingerprint
      const incomingRunsByDedupKey = new Map<string, NonNullable<typeof charData.mythicPlusRuns>[number]>();
      for (const run of charData.mythicPlusRuns ?? []) {
        const canonicalFingerprint = buildCanonicalMythicPlusRunFingerprint(run);
        const dedupKey = canonicalFingerprint ?? run.fingerprint;
        const current = incomingRunsByDedupKey.get(dedupKey);
        if (shouldReplaceMythicPlusRun(current, run)) {
          incomingRunsByDedupKey.set(dedupKey, run);
        }
      }

      for (const run of incomingRunsByDedupKey.values()) {
        const canonicalFingerprint = buildCanonicalMythicPlusRunFingerprint(run);
        const nextFingerprint = canonicalFingerprint ?? run.fingerprint;
        let existingRun = existingRunLookups.byDedupKey.get(nextFingerprint);
        if (!existingRun && run.fingerprint) {
          existingRun = existingRunLookups.byFingerprint.get(run.fingerprint);
        }

        if (!existingRun) {
          const insertedId = await ctx.db.insert("mythicPlusRuns", {
            characterId,
            fingerprint: nextFingerprint,
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
            members: run.members,
          });
          registerRunLookups(
            existingRunLookups,
            {
              _id: insertedId,
              _creationTime: now,
              characterId,
              fingerprint: nextFingerprint,
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
              members: run.members,
            },
            [run.fingerprint, nextFingerprint],
          );
          newMythicPlusRuns++;
        } else {
          const patch: {
            fingerprint?: string;
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
            members?: MythicPlusRunMembers;
          } = {};

          if (existingRun.fingerprint !== nextFingerprint) patch.fingerprint = nextFingerprint;
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
          const mergedMembers = getMergedRunMembers(existingRun.members, run.members);
          if (mergedMembers !== undefined) {
            patch.members = mergedMembers;
          }

          if (Object.keys(patch).length > 0) {
            await ctx.db.patch(existingRun._id, patch);
            registerRunLookups(
              existingRunLookups,
              { ...existingRun, ...patch },
              [existingRun.fingerprint, run.fingerprint, nextFingerprint],
            );
          } else {
            registerRunLookups(existingRunLookups, existingRun, [
              existingRun.fingerprint,
              run.fingerprint,
              nextFingerprint,
            ]);
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
