import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import {
  buildCanonicalMythicPlusRunFingerprint,
  getMythicPlusRunDedupKeys,
  getMythicPlusRunLifecycleStatus,
  mergeMythicPlusRunMembers,
  shouldReplaceMythicPlusRun,
} from "./mythicPlus";
import { rateLimiter } from "./rateLimiter";
import { mythicPlusRunValidator } from "./schemas/mythicPlusRuns";
import { normalizeSnapshotSpec, ownedKeystoneValidator } from "./schemas/snapshots";
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
  ownedKeystone: v.optional(ownedKeystoneValidator),
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
  | "ownedKeystone"
  | "currencies"
  | "stats"
>;
type MythicPlusRunDoc = Doc<"mythicPlusRuns">;
type MythicPlusRunMembers = MythicPlusRunDoc["members"];
type MythicPlusRunInput = Omit<MythicPlusRunDoc, "_id" | "_creationTime" | "characterId">;

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
  for (const dedupKey of getMythicPlusRunDedupKeys(run)) {
    setPreferredRunLookup(lookups.byDedupKey, dedupKey, run);
  }

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

function findMatchingExistingRunByDedupKeys(
  lookups: {
    byDedupKey: Map<string, MythicPlusRunDoc>;
  },
  run: MythicPlusRunInput,
) {
  for (const dedupKey of getMythicPlusRunDedupKeys(run)) {
    const candidate = lookups.byDedupKey.get(dedupKey);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
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
    ownedKeystone: snapshot.ownedKeystone,
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
    ownedKeystone: incomingSnapshot.ownedKeystone ?? existingSnapshot.ownedKeystone,
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

function pickDefinedValue<T>(preferredValue: T | undefined, fallbackValue: T | undefined): T | undefined {
  return preferredValue !== undefined ? preferredValue : fallbackValue;
}

function mergeMythicPlusRunData(
  currentRun: MythicPlusRunInput | undefined,
  candidateRun: MythicPlusRunInput,
): MythicPlusRunInput {
  if (!currentRun) {
    const merged = {
      ...candidateRun,
      fingerprint:
        buildCanonicalMythicPlusRunFingerprint(candidateRun) ?? candidateRun.fingerprint,
    };
    const status = getMythicPlusRunLifecycleStatus(merged);
    if (status !== undefined) {
      merged.status = status;
      if (status === "completed") {
        merged.completed = true;
        merged.endedAt = merged.endedAt ?? merged.completedAt;
      } else if (status === "abandoned") {
        merged.endedAt = merged.endedAt ?? merged.abandonedAt;
        merged.abandonedAt = merged.abandonedAt ?? merged.endedAt;
      }
    }
    return merged;
  }

  const candidatePreferred = shouldReplaceMythicPlusRun(currentRun, candidateRun);
  const preferredRun = candidatePreferred ? candidateRun : currentRun;
  const fallbackRun = candidatePreferred ? currentRun : candidateRun;

  const preferredObservedAt = preferredRun.observedAt ?? 0;
  const fallbackObservedAt = fallbackRun.observedAt ?? 0;
  const mergedObservedAt =
    preferredObservedAt > 0 && fallbackObservedAt > 0
      ? Math.min(preferredObservedAt, fallbackObservedAt)
      : preferredObservedAt > 0
        ? preferredObservedAt
        : fallbackObservedAt;

  const merged: MythicPlusRunInput = {
    fingerprint:
      buildCanonicalMythicPlusRunFingerprint(preferredRun) ??
      buildCanonicalMythicPlusRunFingerprint(fallbackRun) ??
      preferredRun.fingerprint ??
      fallbackRun.fingerprint,
    observedAt:
      mergedObservedAt > 0
        ? mergedObservedAt
        : pickDefinedValue(preferredRun.observedAt, fallbackRun.observedAt) ?? 0,
    seasonID: pickDefinedValue(preferredRun.seasonID, fallbackRun.seasonID),
    mapChallengeModeID: pickDefinedValue(preferredRun.mapChallengeModeID, fallbackRun.mapChallengeModeID),
    mapName: pickDefinedValue(preferredRun.mapName, fallbackRun.mapName),
    level: pickDefinedValue(preferredRun.level, fallbackRun.level),
    status: pickDefinedValue(preferredRun.status, fallbackRun.status),
    completed: pickDefinedValue(preferredRun.completed, fallbackRun.completed),
    completedInTime: pickDefinedValue(preferredRun.completedInTime, fallbackRun.completedInTime),
    durationMs: pickDefinedValue(preferredRun.durationMs, fallbackRun.durationMs),
    runScore: pickDefinedValue(preferredRun.runScore, fallbackRun.runScore),
    startDate: pickDefinedValue(preferredRun.startDate, fallbackRun.startDate),
    completedAt: pickDefinedValue(preferredRun.completedAt, fallbackRun.completedAt),
    endedAt: pickDefinedValue(preferredRun.endedAt, fallbackRun.endedAt),
    abandonedAt: pickDefinedValue(preferredRun.abandonedAt, fallbackRun.abandonedAt),
    abandonReason: pickDefinedValue(preferredRun.abandonReason, fallbackRun.abandonReason),
    thisWeek: pickDefinedValue(preferredRun.thisWeek, fallbackRun.thisWeek),
    members: mergeMythicPlusRunMembers(currentRun.members, candidateRun.members),
  };

  const canonicalFingerprint = buildCanonicalMythicPlusRunFingerprint(merged);
  if (canonicalFingerprint) {
    merged.fingerprint = canonicalFingerprint;
  }

  const status = getMythicPlusRunLifecycleStatus(merged);
  if (status !== undefined) {
    merged.status = status;
    if (status === "completed") {
      merged.completed = true;
      merged.endedAt = merged.endedAt ?? merged.completedAt;
    } else if (status === "abandoned") {
      merged.endedAt = merged.endedAt ?? merged.abandonedAt;
      merged.abandonedAt = merged.abandonedAt ?? merged.endedAt;
    }
  }

  return merged;
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
          ownedKeystone: snap.ownedKeystone,
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

      // Dedup incoming runs deterministically using compatibility dedup keys.
      const incomingRunsDeduped: MythicPlusRunInput[] = [];
      for (const incomingRun of charData.mythicPlusRuns ?? []) {
        const normalizedIncomingRun = mergeMythicPlusRunData(undefined, incomingRun);
        let matchedIndex = -1;
        for (let index = 0; index < incomingRunsDeduped.length; index += 1) {
          const currentRun = incomingRunsDeduped[index]!;
          const currentKeys = new Set(getMythicPlusRunDedupKeys(currentRun));
          const incomingKeys = getMythicPlusRunDedupKeys(normalizedIncomingRun);
          if (incomingKeys.some((key) => currentKeys.has(key))) {
            matchedIndex = index;
            break;
          }
        }
        if (matchedIndex < 0) {
          incomingRunsDeduped.push(normalizedIncomingRun);
        } else {
          incomingRunsDeduped[matchedIndex] = mergeMythicPlusRunData(
            incomingRunsDeduped[matchedIndex],
            normalizedIncomingRun,
          );
        }
      }

      for (const run of incomingRunsDeduped) {
        const nextFingerprint = run.fingerprint;
        const dedupKey = buildCanonicalMythicPlusRunFingerprint(run) ?? nextFingerprint;
        if (!dedupKey || !nextFingerprint) {
          continue;
        }

        let existingRun = existingRunLookups.byDedupKey.get(dedupKey);
        if (!existingRun) {
          existingRun = existingRunLookups.byFingerprint.get(nextFingerprint);
        }
        if (!existingRun) {
          existingRun = findMatchingExistingRunByDedupKeys(existingRunLookups, run);
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
            status: run.status,
            completed: run.completed,
            completedInTime: run.completedInTime,
            durationMs: run.durationMs,
            runScore: run.runScore,
            startDate: run.startDate,
            completedAt: run.completedAt,
            endedAt: run.endedAt,
            abandonedAt: run.abandonedAt,
            abandonReason: run.abandonReason,
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
              status: run.status,
              completed: run.completed,
              completedInTime: run.completedInTime,
              durationMs: run.durationMs,
              runScore: run.runScore,
              startDate: run.startDate,
              completedAt: run.completedAt,
              endedAt: run.endedAt,
              abandonedAt: run.abandonedAt,
              abandonReason: run.abandonReason,
              thisWeek: run.thisWeek,
              members: run.members,
            },
            [run.fingerprint, nextFingerprint],
          );
          newMythicPlusRuns++;
        } else {
          const mergedRun = mergeMythicPlusRunData(existingRun, run);
          const patch: {
            fingerprint?: string;
            observedAt?: number;
            seasonID?: number;
            mapChallengeModeID?: number;
            mapName?: string;
            level?: number;
            status?: MythicPlusRunDoc["status"];
            completed?: boolean;
            completedInTime?: boolean;
            durationMs?: number;
            runScore?: number;
            startDate?: number;
            completedAt?: number;
            endedAt?: number;
            abandonedAt?: number;
            abandonReason?: MythicPlusRunDoc["abandonReason"];
            thisWeek?: boolean;
            members?: MythicPlusRunMembers;
          } = {};

          if (existingRun.fingerprint !== mergedRun.fingerprint) patch.fingerprint = mergedRun.fingerprint;
          if (existingRun.observedAt !== mergedRun.observedAt) patch.observedAt = mergedRun.observedAt;
          if (mergedRun.seasonID !== undefined && existingRun.seasonID !== mergedRun.seasonID) patch.seasonID = mergedRun.seasonID;
          if (
            mergedRun.mapChallengeModeID !== undefined &&
            existingRun.mapChallengeModeID !== mergedRun.mapChallengeModeID
          ) {
            patch.mapChallengeModeID = mergedRun.mapChallengeModeID;
          }
          if (mergedRun.mapName !== undefined && existingRun.mapName !== mergedRun.mapName) patch.mapName = mergedRun.mapName;
          if (mergedRun.level !== undefined && existingRun.level !== mergedRun.level) patch.level = mergedRun.level;
          if (mergedRun.status !== undefined && existingRun.status !== mergedRun.status) patch.status = mergedRun.status;
          if (mergedRun.completed !== undefined && existingRun.completed !== mergedRun.completed) patch.completed = mergedRun.completed;
          if (
            mergedRun.completedInTime !== undefined &&
            existingRun.completedInTime !== mergedRun.completedInTime
          ) {
            patch.completedInTime = mergedRun.completedInTime;
          }
          if (mergedRun.durationMs !== undefined && existingRun.durationMs !== mergedRun.durationMs) {
            patch.durationMs = mergedRun.durationMs;
          }
          if (mergedRun.runScore !== undefined && existingRun.runScore !== mergedRun.runScore) patch.runScore = mergedRun.runScore;
          if (mergedRun.startDate !== undefined && existingRun.startDate !== mergedRun.startDate) patch.startDate = mergedRun.startDate;
          if (mergedRun.completedAt !== undefined && existingRun.completedAt !== mergedRun.completedAt) {
            patch.completedAt = mergedRun.completedAt;
          }
          if (mergedRun.endedAt !== undefined && existingRun.endedAt !== mergedRun.endedAt) patch.endedAt = mergedRun.endedAt;
          if (mergedRun.abandonedAt !== undefined && existingRun.abandonedAt !== mergedRun.abandonedAt) {
            patch.abandonedAt = mergedRun.abandonedAt;
          }
          if (
            mergedRun.abandonReason !== undefined &&
            existingRun.abandonReason !== mergedRun.abandonReason
          ) {
            patch.abandonReason = mergedRun.abandonReason;
          }
          if (mergedRun.thisWeek !== undefined && existingRun.thisWeek !== mergedRun.thisWeek) patch.thisWeek = mergedRun.thisWeek;
          if (JSON.stringify(existingRun.members ?? []) !== JSON.stringify(mergedRun.members ?? [])) {
            patch.members = mergedRun.members;
          }

          if (Object.keys(patch).length > 0) {
            await ctx.db.patch(existingRun._id, patch);
            registerRunLookups(
              existingRunLookups,
              { ...existingRun, ...patch },
              [existingRun.fingerprint, run.fingerprint, mergedRun.fingerprint, dedupKey],
            );
          } else {
            registerRunLookups(existingRunLookups, existingRun, [
              existingRun.fingerprint,
              run.fingerprint,
              mergedRun.fingerprint,
              dedupKey,
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
