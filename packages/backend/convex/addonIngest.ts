import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import {
  buildMythicPlusSummary,
  buildRecentRuns,
  dedupeMythicPlusRuns as dedupeMythicPlusRunRows,
} from "./characters";
import {
  buildCanonicalMythicPlusRunFingerprint,
  canUseMythicPlusRunCompatibilityAliasMatch,
  getMythicPlusRunAttemptId,
  getMythicPlusRunCanonicalKey,
  getMythicPlusRunCompatibilityLookupAliases,
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
type CharacterDoc = Doc<"characters">;
type CharacterDailySnapshotDoc = Doc<"characterDailySnapshots">;
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
type CharacterLatestSnapshot = NonNullable<CharacterDoc["latestSnapshot"]>;
type CharacterLatestSnapshotDetails = NonNullable<CharacterDoc["latestSnapshotDetails"]>;
type CharacterMythicPlusSummary = NonNullable<CharacterDoc["mythicPlusSummary"]>;
type CharacterMythicPlusRecentRunPreview = NonNullable<
  CharacterDoc["mythicPlusRecentRunsPreview"]
>;
type MythicPlusRunDoc = Doc<"mythicPlusRuns"> & { canonicalKey?: string };
type MythicPlusRunMembers = MythicPlusRunDoc["members"];
type MythicPlusRunInput = Omit<MythicPlusRunDoc, "_id" | "_creationTime" | "characterId">;
type MythicPlusRunPatch = {
  fingerprint?: string;
  attemptId?: string;
  canonicalKey?: string;
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
};
const LEGACY_DST_SHIFT_SECONDS = 60 * 60;
const LEGACY_DST_SHIFT_TOLERANCE_SECONDS = 2 * 60;
const MYTHIC_PLUS_PREVIEW_RUN_LIMIT = 20;

type ExistingRunLookups = {
  byAttemptId: Map<string, MythicPlusRunDoc>;
  byCanonicalKey: Map<string, MythicPlusRunDoc>;
  byCompatibilityAlias: Map<string, MythicPlusRunDoc>;
};

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
  lookups: ExistingRunLookups,
  run: MythicPlusRunDoc,
  aliases: Array<string | undefined | null> = [],
) {
  const attemptId = getMythicPlusRunAttemptId(run);
  if (attemptId) {
    setPreferredRunLookup(lookups.byAttemptId, attemptId, run);
  }

  const canonicalKey = getMythicPlusRunCanonicalKey(run);
  if (canonicalKey) {
    setPreferredRunLookup(lookups.byCanonicalKey, canonicalKey, run);
  }

  const compatibilityAliases = new Set<string>();
  for (const alias of getMythicPlusRunCompatibilityLookupAliases(run)) {
    compatibilityAliases.add(alias);
  }
  for (const alias of aliases) {
    if (alias) {
      compatibilityAliases.add(alias);
    }
  }

  for (const compatibilityAlias of compatibilityAliases) {
    setPreferredRunLookup(lookups.byCompatibilityAlias, compatibilityAlias, run);
  }
}

function findMatchingExistingRunByIdentity(
  lookups: ExistingRunLookups,
  run: MythicPlusRunInput,
) {
  const attemptId = getMythicPlusRunAttemptId(run);
  if (attemptId) {
    const attemptMatch = lookups.byAttemptId.get(attemptId);
    if (attemptMatch) {
      return attemptMatch;
    }
  }

  const canonicalKey = getMythicPlusRunCanonicalKey(run);
  if (canonicalKey) {
    const canonicalMatch = lookups.byCanonicalKey.get(canonicalKey);
    if (canonicalMatch) {
      return canonicalMatch;
    }
  }

  for (const compatibilityAlias of getMythicPlusRunCompatibilityLookupAliases(run)) {
    const candidate = lookups.byCompatibilityAlias.get(compatibilityAlias);
    if (!candidate) {
      continue;
    }
    if (!canUseMythicPlusRunCompatibilityAliasMatch(candidate, run)) {
      continue;
    }
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

function toCharacterLatestSnapshot(snapshot: SnapshotFields): CharacterLatestSnapshot {
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
  };
}

function toCharacterLatestSnapshotDetails(
  snapshot: SnapshotFields,
): CharacterLatestSnapshotDetails {
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

function isSameCharacterLatestSnapshot(
  currentSnapshot: CharacterLatestSnapshot | undefined,
  nextSnapshot: CharacterLatestSnapshot | undefined,
) {
  if (!currentSnapshot && !nextSnapshot) return true;
  if (!currentSnapshot || !nextSnapshot) return false;

  const currentKeystone = currentSnapshot.ownedKeystone;
  const nextKeystone = nextSnapshot.ownedKeystone;
  const sameKeystone =
    (!currentKeystone && !nextKeystone) ||
    (!!currentKeystone &&
      !!nextKeystone &&
      currentKeystone.level === nextKeystone.level &&
      currentKeystone.mapChallengeModeID === nextKeystone.mapChallengeModeID &&
      currentKeystone.mapName === nextKeystone.mapName);

  return (
    currentSnapshot.takenAt === nextSnapshot.takenAt &&
    currentSnapshot.level === nextSnapshot.level &&
    currentSnapshot.spec === nextSnapshot.spec &&
    currentSnapshot.role === nextSnapshot.role &&
    currentSnapshot.itemLevel === nextSnapshot.itemLevel &&
    currentSnapshot.gold === nextSnapshot.gold &&
    currentSnapshot.playtimeSeconds === nextSnapshot.playtimeSeconds &&
    currentSnapshot.playtimeThisLevelSeconds === nextSnapshot.playtimeThisLevelSeconds &&
    currentSnapshot.mythicPlusScore === nextSnapshot.mythicPlusScore &&
    sameKeystone
  );
}

function shouldReplaceCharacterLatestSnapshot(
  currentSnapshot: CharacterLatestSnapshot | undefined,
  nextSnapshot: CharacterLatestSnapshot,
) {
  if (!currentSnapshot) return true;
  if (nextSnapshot.takenAt > currentSnapshot.takenAt) return true;
  if (nextSnapshot.takenAt < currentSnapshot.takenAt) return false;
  return !isSameCharacterLatestSnapshot(currentSnapshot, nextSnapshot);
}

function isSameCharacterLatestSnapshotDetails(
  currentSnapshot: CharacterLatestSnapshotDetails | undefined,
  nextSnapshot: CharacterLatestSnapshotDetails | undefined,
) {
  if (!currentSnapshot && !nextSnapshot) return true;
  if (!currentSnapshot || !nextSnapshot) return false;
  return snapshotFieldsEqual(currentSnapshot, nextSnapshot);
}

function getSnapshotDayStart(takenAt: number) {
  return Math.floor(takenAt / 86400) * 86400;
}

function toCharacterDailySnapshotFields(snapshot: SnapshotFields) {
  return {
    dayStartAt: getSnapshotDayStart(snapshot.takenAt),
    lastTakenAt: snapshot.takenAt,
    itemLevel: snapshot.itemLevel,
    gold: snapshot.gold,
    playtimeSeconds: snapshot.playtimeSeconds,
    mythicPlusScore: snapshot.mythicPlusScore,
  };
}

function shouldReplaceCharacterDailySnapshot(
  currentSnapshot: Pick<CharacterDailySnapshotDoc, "lastTakenAt"> | null,
  nextSnapshot: SnapshotFields,
) {
  if (!currentSnapshot) return true;
  return nextSnapshot.takenAt >= currentSnapshot.lastTakenAt;
}

function pickDefinedValue<T>(preferredValue: T | undefined, fallbackValue: T | undefined): T | undefined {
  return preferredValue !== undefined ? preferredValue : fallbackValue;
}

function mergeLifecycleTimestamp(
  preferredValue: number | undefined,
  fallbackValue: number | undefined,
): number | undefined {
  if (preferredValue === undefined) {
    return fallbackValue;
  }
  if (fallbackValue === undefined) {
    return preferredValue;
  }

  const preferredTimestamp = Math.floor(preferredValue);
  const fallbackTimestamp = Math.floor(fallbackValue);
  if (preferredTimestamp === fallbackTimestamp) {
    return preferredTimestamp;
  }

  if (
    Math.abs(Math.abs(preferredTimestamp - fallbackTimestamp) - LEGACY_DST_SHIFT_SECONDS) <=
    LEGACY_DST_SHIFT_TOLERANCE_SECONDS
  ) {
    return Math.max(preferredTimestamp, fallbackTimestamp);
  }

  return preferredValue;
}

function deriveAttemptIdFromRun(run: {
  attemptId?: string;
  fingerprint?: string;
  canonicalKey?: string;
  seasonID?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  level?: number;
  startDate?: number;
}): string | undefined {
  return getMythicPlusRunAttemptId(run) ?? undefined;
}

function deriveCanonicalKeyFromRun(run: {
  attemptId?: string;
  canonicalKey?: string;
  fingerprint?: string;
  seasonID?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  level?: number;
  startDate?: number;
  completedAt?: number;
  endedAt?: number;
  abandonedAt?: number;
  durationMs?: number;
  runScore?: number;
}): string | undefined {
  return getMythicPlusRunCanonicalKey(run) ?? undefined;
}

function mergeMythicPlusRunData(
  currentRun: MythicPlusRunInput | undefined,
  candidateRun: MythicPlusRunInput,
): MythicPlusRunInput {
  if (!currentRun) {
    const merged = {
      ...candidateRun,
      attemptId: deriveAttemptIdFromRun(candidateRun),
      canonicalKey: deriveCanonicalKeyFromRun(candidateRun),
      fingerprint: candidateRun.fingerprint,
    };
    merged.canonicalKey = deriveCanonicalKeyFromRun(merged);
    merged.fingerprint =
      buildCanonicalMythicPlusRunFingerprint(merged) ??
      merged.canonicalKey ??
      candidateRun.fingerprint;
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
      deriveCanonicalKeyFromRun(preferredRun) ??
      buildCanonicalMythicPlusRunFingerprint(fallbackRun) ??
      deriveCanonicalKeyFromRun(fallbackRun) ??
      preferredRun.fingerprint ??
      fallbackRun.fingerprint,
    observedAt:
      mergedObservedAt > 0
        ? mergedObservedAt
        : pickDefinedValue(preferredRun.observedAt, fallbackRun.observedAt) ?? 0,
    attemptId: pickDefinedValue(
      deriveAttemptIdFromRun(preferredRun),
      deriveAttemptIdFromRun(fallbackRun),
    ),
    canonicalKey: pickDefinedValue(
      deriveCanonicalKeyFromRun(preferredRun),
      deriveCanonicalKeyFromRun(fallbackRun),
    ),
    seasonID: pickDefinedValue(preferredRun.seasonID, fallbackRun.seasonID),
    mapChallengeModeID: pickDefinedValue(preferredRun.mapChallengeModeID, fallbackRun.mapChallengeModeID),
    mapName: pickDefinedValue(preferredRun.mapName, fallbackRun.mapName),
    level: pickDefinedValue(preferredRun.level, fallbackRun.level),
    status: pickDefinedValue(preferredRun.status, fallbackRun.status),
    completed: pickDefinedValue(preferredRun.completed, fallbackRun.completed),
    completedInTime: pickDefinedValue(preferredRun.completedInTime, fallbackRun.completedInTime),
    durationMs: pickDefinedValue(preferredRun.durationMs, fallbackRun.durationMs),
    runScore: pickDefinedValue(preferredRun.runScore, fallbackRun.runScore),
    startDate: mergeLifecycleTimestamp(preferredRun.startDate, fallbackRun.startDate),
    completedAt: mergeLifecycleTimestamp(preferredRun.completedAt, fallbackRun.completedAt),
    endedAt: mergeLifecycleTimestamp(preferredRun.endedAt, fallbackRun.endedAt),
    abandonedAt: mergeLifecycleTimestamp(preferredRun.abandonedAt, fallbackRun.abandonedAt),
    abandonReason: pickDefinedValue(preferredRun.abandonReason, fallbackRun.abandonReason),
    thisWeek: pickDefinedValue(preferredRun.thisWeek, fallbackRun.thisWeek),
    members: mergeMythicPlusRunMembers(currentRun.members, candidateRun.members),
  };

  const canonicalFingerprint = buildCanonicalMythicPlusRunFingerprint(merged);
  if (canonicalFingerprint) {
    merged.fingerprint = canonicalFingerprint;
  }
  merged.attemptId = deriveAttemptIdFromRun(merged);
  merged.canonicalKey = deriveCanonicalKeyFromRun(merged);

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

function buildMythicPlusRunPatch(
  existingRun: MythicPlusRunDoc,
  mergedRun: MythicPlusRunInput,
): MythicPlusRunPatch {
  const patch: MythicPlusRunPatch = {};
  if (existingRun.fingerprint !== mergedRun.fingerprint) patch.fingerprint = mergedRun.fingerprint;
  if (mergedRun.attemptId !== undefined && existingRun.attemptId !== mergedRun.attemptId) {
    patch.attemptId = mergedRun.attemptId;
  }
  if (
    mergedRun.canonicalKey !== undefined &&
    (existingRun as MythicPlusRunInput).canonicalKey !== mergedRun.canonicalKey
  ) {
    patch.canonicalKey = mergedRun.canonicalKey;
  }
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
  return patch;
}

async function collapseDuplicateMythicPlusRunsForCharacter(
  ctx: any,
  characterId: MythicPlusRunDoc["characterId"],
) {
  const runs = await ctx.db
    .query("mythicPlusRuns")
    .withIndex("by_character", (q: any) => q.eq("characterId", characterId))
    .collect();

  if (runs.length < 2) {
    return 0;
  }

  const clusters: Array<{
    representative: MythicPlusRunDoc;
    mergedRun: MythicPlusRunInput;
    runIds: Array<MythicPlusRunDoc["_id"]>;
  }> = [];

  for (const run of runs) {
    const runAttemptId = getMythicPlusRunAttemptId(run);
    const runCanonicalKey = getMythicPlusRunCanonicalKey(run);
    let matchedClusterIndex = -1;

    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index]!;
      const clusterAttemptId = getMythicPlusRunAttemptId(cluster.mergedRun);
      const clusterCanonicalKey = getMythicPlusRunCanonicalKey(cluster.mergedRun);
      const hasExactAttemptMatch =
        runAttemptId !== null && clusterAttemptId !== null && runAttemptId === clusterAttemptId;
      const hasExactCanonicalMatch =
        runCanonicalKey !== null &&
        clusterCanonicalKey !== null &&
        runCanonicalKey === clusterCanonicalKey;
      const hasCompatibilityMatch =
        !hasExactAttemptMatch &&
        !hasExactCanonicalMatch &&
        canUseMythicPlusRunCompatibilityAliasMatch(cluster.mergedRun, run);

      if (hasExactAttemptMatch || hasExactCanonicalMatch || hasCompatibilityMatch) {
        matchedClusterIndex = index;
        break;
      }
    }

    if (matchedClusterIndex < 0) {
      clusters.push({
        representative: run,
        mergedRun: mergeMythicPlusRunData(undefined, run),
        runIds: [run._id],
      });
      continue;
    }

    const matchedCluster = clusters[matchedClusterIndex]!;
    matchedCluster.mergedRun = mergeMythicPlusRunData(matchedCluster.mergedRun, run);
    if (shouldReplaceMythicPlusRun(matchedCluster.representative, run)) {
      matchedCluster.representative = run;
    }
    matchedCluster.runIds.push(run._id);
  }

  let collapsedCount = 0;
  for (const cluster of clusters) {
    if (cluster.runIds.length <= 1) {
      continue;
    }

    const representativeId = cluster.representative._id;
    const patch = buildMythicPlusRunPatch(cluster.representative, cluster.mergedRun);
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(representativeId, patch as any);
    }

    for (const runId of cluster.runIds) {
      if (runId === representativeId) continue;
      await ctx.db.delete(runId);
      collapsedCount += 1;
    }
  }

  return collapsedCount;
}

export const dedupeMythicPlusRuns = mutation({
  args: {
    characterId: v.optional(v.id("characters")),
  },
  handler: async (ctx, { characterId }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return {
        totalCharacters: 0,
        charactersWithCollapsedRuns: 0,
        collapsedRuns: 0,
      };
    }

    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", authUser._id as string))
      .first();
    if (!player) {
      return {
        totalCharacters: 0,
        charactersWithCollapsedRuns: 0,
        collapsedRuns: 0,
      };
    }

    const targetCharacters =
      characterId === undefined
        ? await ctx.db
            .query("characters")
            .withIndex("by_player", (q) => q.eq("playerId", player._id))
            .collect()
        : await (async () => {
            const character = await ctx.db.get(characterId);
            if (!character || character.playerId !== player._id) return [];
            return [character];
          })();

    let collapsedRuns = 0;
    let charactersWithCollapsedRuns = 0;
    for (const character of targetCharacters) {
      const collapsedForCharacter = await collapseDuplicateMythicPlusRunsForCharacter(
        ctx,
        character._id,
      );
      if (collapsedForCharacter > 0) {
        charactersWithCollapsedRuns += 1;
        collapsedRuns += collapsedForCharacter;
      }
    }

    return {
      totalCharacters: targetCharacters.length,
      charactersWithCollapsedRuns,
      collapsedRuns,
    };
  },
});

export const __testables = {
  deriveAttemptIdFromRun,
  deriveCanonicalKeyFromRun,
  mergeMythicPlusRunData,
  registerRunLookups,
  findMatchingExistingRunByIdentity,
};

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
    let collapsedMythicPlusRuns = 0;

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

      let nextCharacterLatestSnapshot = existing?.latestSnapshot;
      let nextCharacterLatestSnapshotDetails = existing?.latestSnapshotDetails;
      let shouldPersistLatestSnapshot = false;
      let shouldPersistLatestSnapshotDetails = false;
      let nextCharacterFirstSnapshotAt = existing?.firstSnapshotAt;
      let nextCharacterSnapshotCount = existing?.snapshotCount;
      let shouldPersistSnapshotMetadata = false;

      if (nextCharacterFirstSnapshotAt === undefined || nextCharacterSnapshotCount === undefined) {
        const existingSnapshots = await ctx.db
          .query("snapshots")
          .withIndex("by_character", (q) => q.eq("characterId", characterId))
          .collect();

        const seenTakenAt = new Set<number>();
        let firstSnapshotAt: number | undefined;
        for (const snapshot of existingSnapshots) {
          if (seenTakenAt.has(snapshot.takenAt)) {
            continue;
          }
          seenTakenAt.add(snapshot.takenAt);
          if (firstSnapshotAt === undefined || snapshot.takenAt < firstSnapshotAt) {
            firstSnapshotAt = snapshot.takenAt;
          }
        }

        nextCharacterFirstSnapshotAt = firstSnapshotAt;
        nextCharacterSnapshotCount = seenTakenAt.size;
        shouldPersistSnapshotMetadata =
          existing?.firstSnapshotAt !== nextCharacterFirstSnapshotAt ||
          existing?.snapshotCount !== nextCharacterSnapshotCount;
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

        let latestSnapshotCandidate: CharacterLatestSnapshot;
        let latestSnapshotDetailsCandidate: CharacterLatestSnapshotDetails;
        let dailySnapshotSource: SnapshotFields;
        if (!existingSnap) {
          await ctx.db.insert("snapshots", {
            characterId,
            ...nextSnapshot,
          });
          newSnapshots++;
          latestSnapshotCandidate = toCharacterLatestSnapshot(nextSnapshot);
          latestSnapshotDetailsCandidate = toCharacterLatestSnapshotDetails(nextSnapshot);
          dailySnapshotSource = nextSnapshot;
          nextCharacterFirstSnapshotAt =
            nextCharacterFirstSnapshotAt === undefined
              ? nextSnapshot.takenAt
              : Math.min(nextCharacterFirstSnapshotAt, nextSnapshot.takenAt);
          nextCharacterSnapshotCount = (nextCharacterSnapshotCount ?? 0) + 1;
          shouldPersistSnapshotMetadata = true;
        } else {
          const existingSnapshotFields = toSnapshotFields(existingSnap);
          const mergedSnapshot = mergeSnapshotFields(existingSnapshotFields, nextSnapshot);
          if (!snapshotFieldsEqual(existingSnapshotFields, mergedSnapshot)) {
            await ctx.db.patch(existingSnap._id, mergedSnapshot);
            latestSnapshotCandidate = toCharacterLatestSnapshot(mergedSnapshot);
            latestSnapshotDetailsCandidate = toCharacterLatestSnapshotDetails(mergedSnapshot);
            dailySnapshotSource = mergedSnapshot;
          } else {
            latestSnapshotCandidate = toCharacterLatestSnapshot(existingSnapshotFields);
            latestSnapshotDetailsCandidate = toCharacterLatestSnapshotDetails(existingSnapshotFields);
            dailySnapshotSource = existingSnapshotFields;
          }
        }

        const dayStartAt = getSnapshotDayStart(dailySnapshotSource.takenAt);
        const existingDailySnapshot = await ctx.db
          .query("characterDailySnapshots")
          .withIndex("by_character_and_day", (q) =>
            q.eq("characterId", characterId).eq("dayStartAt", dayStartAt),
          )
          .first();
        const nextDailySnapshot = toCharacterDailySnapshotFields(dailySnapshotSource);

        if (!existingDailySnapshot) {
          await ctx.db.insert("characterDailySnapshots", {
            characterId,
            ...nextDailySnapshot,
          });
        } else if (shouldReplaceCharacterDailySnapshot(existingDailySnapshot, dailySnapshotSource)) {
          await ctx.db.patch(existingDailySnapshot._id, nextDailySnapshot);
        }

        if (
          shouldReplaceCharacterLatestSnapshot(nextCharacterLatestSnapshot, latestSnapshotCandidate) &&
          !isSameCharacterLatestSnapshot(nextCharacterLatestSnapshot, latestSnapshotCandidate)
        ) {
          nextCharacterLatestSnapshot = latestSnapshotCandidate;
          shouldPersistLatestSnapshot = true;
        }
        if (
          nextCharacterLatestSnapshot?.takenAt === latestSnapshotCandidate.takenAt &&
          !isSameCharacterLatestSnapshotDetails(
            nextCharacterLatestSnapshotDetails,
            latestSnapshotDetailsCandidate,
          )
        ) {
          nextCharacterLatestSnapshotDetails = latestSnapshotDetailsCandidate;
          shouldPersistLatestSnapshotDetails = true;
        }
      }

      const characterPatch: Partial<CharacterDoc> = {};
      if (shouldPersistLatestSnapshot && nextCharacterLatestSnapshot) {
        characterPatch.latestSnapshot = nextCharacterLatestSnapshot;
      }
      if (shouldPersistLatestSnapshotDetails && nextCharacterLatestSnapshotDetails) {
        characterPatch.latestSnapshotDetails = nextCharacterLatestSnapshotDetails;
      }
      if (shouldPersistSnapshotMetadata) {
        if (nextCharacterFirstSnapshotAt !== undefined) {
          characterPatch.firstSnapshotAt = nextCharacterFirstSnapshotAt;
        }
        if (nextCharacterSnapshotCount !== undefined) {
          characterPatch.snapshotCount = nextCharacterSnapshotCount;
        }
      }
      if (Object.keys(characterPatch).length > 0) {
        await ctx.db.patch(characterId, characterPatch);
      }

      const existingCharacterRuns = await ctx.db
        .query("mythicPlusRuns")
        .withIndex("by_character", (q) => q.eq("characterId", characterId))
        .collect();
      const currentCharacterRuns = new Map(existingCharacterRuns.map((run) => [run._id, run] as const));

      const existingRunLookups = {
        byAttemptId: new Map<string, MythicPlusRunDoc>(),
        byCanonicalKey: new Map<string, MythicPlusRunDoc>(),
        byCompatibilityAlias: new Map<string, MythicPlusRunDoc>(),
      };
      for (const existingRun of existingCharacterRuns) {
        registerRunLookups(existingRunLookups, existingRun);
      }

      // Dedup incoming runs using exact identity only (attemptId -> canonicalKey).
      const incomingRunsDeduped: MythicPlusRunInput[] = [];
      const incomingByAttemptId = new Map<string, number>();
      const incomingByCanonicalKey = new Map<string, number>();
      for (const incomingRun of charData.mythicPlusRuns ?? []) {
        const normalizedIncomingRun = mergeMythicPlusRunData(undefined, incomingRun);
        const incomingAttemptId = deriveAttemptIdFromRun(normalizedIncomingRun);
        const incomingCanonicalKey = deriveCanonicalKeyFromRun(normalizedIncomingRun);
        let matchedIndex =
          incomingAttemptId !== undefined ? incomingByAttemptId.get(incomingAttemptId) ?? -1 : -1;
        if (matchedIndex < 0 && incomingCanonicalKey !== undefined) {
          matchedIndex = incomingByCanonicalKey.get(incomingCanonicalKey) ?? -1;
        }

        if (matchedIndex < 0) {
          incomingRunsDeduped.push(normalizedIncomingRun);
          matchedIndex = incomingRunsDeduped.length - 1;
        } else {
          incomingRunsDeduped[matchedIndex] = mergeMythicPlusRunData(
            incomingRunsDeduped[matchedIndex],
            normalizedIncomingRun,
          );
        }

        const mergedIncomingRun = incomingRunsDeduped[matchedIndex]!;
        const mergedAttemptId = deriveAttemptIdFromRun(mergedIncomingRun);
        const mergedCanonicalKey = deriveCanonicalKeyFromRun(mergedIncomingRun);
        if (mergedAttemptId !== undefined) {
          incomingByAttemptId.set(mergedAttemptId, matchedIndex);
        }
        if (mergedCanonicalKey !== undefined) {
          incomingByCanonicalKey.set(mergedCanonicalKey, matchedIndex);
        }
      }

      for (const run of incomingRunsDeduped) {
        const nextFingerprint =
          buildCanonicalMythicPlusRunFingerprint(run) ??
          deriveCanonicalKeyFromRun(run) ??
          run.fingerprint;
        const nextCanonicalKey = deriveCanonicalKeyFromRun(run);
        const nextAttemptId = deriveAttemptIdFromRun(run);
        if (!nextFingerprint) {
          continue;
        }

        const nextRun: MythicPlusRunInput = {
          ...run,
          fingerprint: nextFingerprint,
          attemptId: nextAttemptId,
          canonicalKey: nextCanonicalKey,
        };

        const existingRun = findMatchingExistingRunByIdentity(existingRunLookups, nextRun);

        if (!existingRun) {
          const insertedId = await ctx.db.insert("mythicPlusRuns", {
            characterId,
            fingerprint: nextFingerprint,
            attemptId: nextRun.attemptId,
            canonicalKey: nextRun.canonicalKey,
            observedAt: nextRun.observedAt,
            seasonID: nextRun.seasonID,
            mapChallengeModeID: nextRun.mapChallengeModeID,
            mapName: nextRun.mapName,
            level: nextRun.level,
            status: nextRun.status,
            completed: nextRun.completed,
            completedInTime: nextRun.completedInTime,
            durationMs: nextRun.durationMs,
            runScore: nextRun.runScore,
            startDate: nextRun.startDate,
            completedAt: nextRun.completedAt,
            endedAt: nextRun.endedAt,
            abandonedAt: nextRun.abandonedAt,
            abandonReason: nextRun.abandonReason,
            thisWeek: nextRun.thisWeek,
            members: nextRun.members,
          } as any);
          registerRunLookups(
            existingRunLookups,
            {
              _id: insertedId,
              _creationTime: now,
              characterId,
              fingerprint: nextFingerprint,
              attemptId: nextRun.attemptId,
              canonicalKey: nextRun.canonicalKey,
              observedAt: nextRun.observedAt,
              seasonID: nextRun.seasonID,
              mapChallengeModeID: nextRun.mapChallengeModeID,
              mapName: nextRun.mapName,
              level: nextRun.level,
              status: nextRun.status,
              completed: nextRun.completed,
              completedInTime: nextRun.completedInTime,
              durationMs: nextRun.durationMs,
              runScore: nextRun.runScore,
              startDate: nextRun.startDate,
              completedAt: nextRun.completedAt,
              endedAt: nextRun.endedAt,
              abandonedAt: nextRun.abandonedAt,
              abandonReason: nextRun.abandonReason,
              thisWeek: nextRun.thisWeek,
              members: nextRun.members,
            } as MythicPlusRunDoc,
            [nextRun.fingerprint, nextFingerprint],
          );
          currentCharacterRuns.set(insertedId, {
            _id: insertedId,
            _creationTime: now,
            characterId,
            fingerprint: nextFingerprint,
            attemptId: nextRun.attemptId,
            canonicalKey: nextRun.canonicalKey,
            observedAt: nextRun.observedAt,
            seasonID: nextRun.seasonID,
            mapChallengeModeID: nextRun.mapChallengeModeID,
            mapName: nextRun.mapName,
            level: nextRun.level,
            status: nextRun.status,
            completed: nextRun.completed,
            completedInTime: nextRun.completedInTime,
            durationMs: nextRun.durationMs,
            runScore: nextRun.runScore,
            startDate: nextRun.startDate,
            completedAt: nextRun.completedAt,
            endedAt: nextRun.endedAt,
            abandonedAt: nextRun.abandonedAt,
            abandonReason: nextRun.abandonReason,
            thisWeek: nextRun.thisWeek,
            members: nextRun.members,
          } as MythicPlusRunDoc);
          newMythicPlusRuns++;
        } else {
          const mergedRun = mergeMythicPlusRunData(existingRun, nextRun);
          const patch = buildMythicPlusRunPatch(existingRun, mergedRun);

          if (Object.keys(patch).length > 0) {
            await ctx.db.patch(existingRun._id, patch as any);
            currentCharacterRuns.set(existingRun._id, {
              ...existingRun,
              ...patch,
            });
            registerRunLookups(
              existingRunLookups,
              { ...existingRun, ...patch },
              [existingRun.fingerprint, nextRun.fingerprint, mergedRun.fingerprint],
            );
          } else {
            registerRunLookups(existingRunLookups, existingRun, [
              existingRun.fingerprint,
              nextRun.fingerprint,
              mergedRun.fingerprint,
            ]);
          }
        }
      }

      const currentScore =
        nextCharacterLatestSnapshot?.mythicPlusScore ??
        nextCharacterLatestSnapshotDetails?.mythicPlusScore ??
        null;
      const dedupedRuns = dedupeMythicPlusRunRows(Array.from(currentCharacterRuns.values()));
      const recentRuns = buildRecentRuns(dedupedRuns);
      const mythicPlusSummary = buildMythicPlusSummary(
        dedupedRuns,
        currentScore,
      ) as CharacterMythicPlusSummary;
      const mythicPlusRecentRunsPreview = recentRuns.slice(
        0,
        MYTHIC_PLUS_PREVIEW_RUN_LIMIT,
      ) as CharacterMythicPlusRecentRunPreview;
      const mythicPlusRunCount = recentRuns.length;

      if (
        JSON.stringify(existing?.mythicPlusSummary ?? null) !== JSON.stringify(mythicPlusSummary) ||
        JSON.stringify(existing?.mythicPlusRecentRunsPreview ?? null) !==
          JSON.stringify(mythicPlusRecentRunsPreview) ||
        existing?.mythicPlusRunCount !== mythicPlusRunCount
      ) {
        await ctx.db.patch(characterId, {
          mythicPlusSummary,
          mythicPlusRecentRunsPreview,
          mythicPlusRunCount,
        });
      }

      collapsedMythicPlusRuns += await collapseDuplicateMythicPlusRunsForCharacter(ctx, characterId);
    }

    await ctx.runMutation(internal.audit.log, {
      userId: authUser._id as string,
      event: "addon.ingest",
      metadata: {
        newChars,
        newSnapshots,
        newMythicPlusRuns,
        collapsedMythicPlusRuns,
        totalCharacters: characters.length,
      },
    });

    return { newChars, newSnapshots, newMythicPlusRuns, collapsedMythicPlusRuns };
  },
});
