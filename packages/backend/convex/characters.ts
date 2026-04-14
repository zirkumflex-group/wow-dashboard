import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

import { components, internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import {
  buildCanonicalMythicPlusRunFingerprint,
  canUseMythicPlusRunCompatibilityAliasMatch,
  getMythicPlusRunAttemptId,
  getMythicPlusRunCompatibilityLookupAliases,
  getMythicPlusRunCanonicalKey,
  getMythicPlusRunLifecycleStatus,
  mergeMythicPlusRunMembers,
  getMythicPlusRunTimedState,
  getMythicPlusRunUpgradeCount,
  getMythicPlusRunSortValue,
  shouldReplaceMythicPlusRun,
} from "./mythicPlus";
import { rateLimiter } from "./rateLimiter";
import { nonTradeableSlotValidator } from "./schemas/characters";

type MythicPlusRunDoc = Doc<"mythicPlusRuns"> & { canonicalKey?: string };
type SnapshotDoc = Doc<"snapshots">;
type CharacterDailySnapshotDoc = Doc<"characterDailySnapshots">;
type DbReaderCtx = { db: QueryCtx["db"] };
type SnapshotSummary = NonNullable<Doc<"characters">["latestSnapshot"]>;
type SnapshotDetails = NonNullable<Doc<"characters">["latestSnapshotDetails"]>;
type CharacterMythicPlusSummary = NonNullable<Doc<"characters">["mythicPlusSummary"]>;
type CharacterMythicPlusRecentRunPreview = NonNullable<
  Doc<"characters">["mythicPlusRecentRunsPreview"]
>[number];
type CharacterNonTradeableSlot = NonNullable<Doc<"characters">["nonTradeableSlots"]>[number];
type SnapshotTimeFrame = "7d" | "30d" | "90d" | "all";
const MYTHIC_PLUS_PREVIEW_RUN_LIMIT = 20;

const snapshotTimeFrameValidator = v.union(
  v.literal("7d"),
  v.literal("30d"),
  v.literal("90d"),
  v.literal("all"),
);

const snapshotDetailMetricValidator = v.union(v.literal("stats"), v.literal("currencies"));

function toSnapshotSummary(snapshot: SnapshotDoc | null): SnapshotSummary | null {
  if (!snapshot) return null;

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
    ownedKeystone: snapshot.ownedKeystone ?? undefined,
  };
}

function toSnapshotDetails(snapshot: SnapshotDoc | null): SnapshotDetails | null {
  if (!snapshot) return null;

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
    ownedKeystone: snapshot.ownedKeystone ?? undefined,
    currencies: snapshot.currencies,
    stats: snapshot.stats,
  };
}

function isSameKeystone(
  current:
    | {
        level: number;
        mapChallengeModeID?: number | undefined;
        mapName?: string | undefined;
      }
    | undefined,
  next:
    | {
        level: number;
        mapChallengeModeID?: number | undefined;
        mapName?: string | undefined;
      }
    | undefined,
) {
  if (!current && !next) return true;
  if (!current || !next) return false;
  return (
    current.level === next.level &&
    current.mapChallengeModeID === next.mapChallengeModeID &&
    current.mapName === next.mapName
  );
}

function isSameSnapshotSummary(current: SnapshotSummary | null, next: SnapshotSummary | null) {
  if (!current && !next) return true;
  if (!current || !next) return false;
  return (
    current.takenAt === next.takenAt &&
    current.level === next.level &&
    current.spec === next.spec &&
    current.role === next.role &&
    current.itemLevel === next.itemLevel &&
    current.gold === next.gold &&
    current.playtimeSeconds === next.playtimeSeconds &&
    current.playtimeThisLevelSeconds === next.playtimeThisLevelSeconds &&
    current.mythicPlusScore === next.mythicPlusScore &&
    isSameKeystone(current.ownedKeystone, next.ownedKeystone)
  );
}

function getCharacterStoredLatestSnapshot(character: Doc<"characters">): SnapshotSummary | null {
  return character.latestSnapshot ?? null;
}

function getCharacterStoredLatestSnapshotDetails(
  character: Doc<"characters">,
): SnapshotDetails | null {
  return character.latestSnapshotDetails ?? null;
}

function getCharacterStoredMythicPlusData(character: Doc<"characters">) {
  const summary = character.mythicPlusSummary ?? null;
  const runs = character.mythicPlusRecentRunsPreview ?? null;
  const totalRunCount = character.mythicPlusRunCount ?? null;
  if (!summary || !runs || totalRunCount === null) {
    return null;
  }

  return {
    summary,
    runs,
    totalRunCount,
    isPreview: totalRunCount > runs.length,
  };
}

async function getPlayerForAuthUser(ctx: DbReaderCtx, authUserId: string) {
  return await ctx.db
    .query("players")
    .withIndex("by_user", (q) => q.eq("userId", authUserId))
    .first();
}

function getRoleSortRank(role: SnapshotSummary["role"] | null | undefined) {
  if (role === "tank") return 0;
  if (role === "dps") return 1;
  return 2;
}

function normalizeNonTradeableSlots(nonTradeableSlots: CharacterNonTradeableSlot[]) {
  const uniqueSlots = new Set(nonTradeableSlots);
  return Array.from(uniqueSlots);
}

async function getLatestSnapshotForCharacter(
  ctx: DbReaderCtx,
  characterId: Doc<"characters">["_id"],
) {
  return await ctx.db
    .query("snapshots")
    .withIndex("by_character_and_time", (q) => q.eq("characterId", characterId))
    .order("desc")
    .first();
}

async function getLatestSnapshotSummaryForCharacter(
  ctx: DbReaderCtx,
  character: Doc<"characters">,
) {
  const storedLatestSnapshot = getCharacterStoredLatestSnapshot(character);
  if (storedLatestSnapshot) {
    return storedLatestSnapshot;
  }

  return toSnapshotSummary(await getLatestSnapshotForCharacter(ctx, character._id));
}

async function getCharactersWithLatestSnapshots(
  ctx: DbReaderCtx,
  characters: Doc<"characters">[],
) {
  if (characters.length === 0) {
    return [] as { character: Doc<"characters">; snapshot: SnapshotSummary | null }[];
  }

  return await Promise.all(
    characters.map(async (character) => ({
      character,
      snapshot: await getLatestSnapshotSummaryForCharacter(ctx, character),
    })),
  );
}

function getRunTimestamp(run: MythicPlusRunDoc): number {
  return getMythicPlusRunSortValue(run);
}

function getMapLabel(run: MythicPlusRunDoc): string {
  if (run.mapName && run.mapName.trim() !== "") return run.mapName;
  if (run.mapChallengeModeID !== undefined) return `Dungeon ${run.mapChallengeModeID}`;
  return "Unknown Dungeon";
}

function getMythicPlusRunProgressionKey(run: MythicPlusRunDoc): string {
  const mapToken =
    run.mapChallengeModeID !== undefined
      ? String(run.mapChallengeModeID)
      : getMapLabel(run).trim().toLowerCase();
  const seasonToken = run.seasonID !== undefined ? String(run.seasonID) : "unknown";
  return `${seasonToken}|${mapToken}`;
}

function isCompletedRun(run: MythicPlusRunDoc): boolean {
  return getMythicPlusRunLifecycleStatus(run) === "completed";
}

function isAbandonedRun(run: MythicPlusRunDoc): boolean {
  return getMythicPlusRunLifecycleStatus(run) === "abandoned";
}

function isActiveRun(run: MythicPlusRunDoc): boolean {
  return getMythicPlusRunLifecycleStatus(run) === "active";
}

function isTerminalRun(run: MythicPlusRunDoc): boolean {
  return isCompletedRun(run) || isAbandonedRun(run);
}

function isTimedRun(run: MythicPlusRunDoc): boolean | null {
  return getMythicPlusRunTimedState(run);
}

function shouldReplaceBestTimedRun(
  currentRun: MythicPlusRunDoc | null,
  candidateRun: MythicPlusRunDoc,
) {
  if (!currentRun) return true;

  const currentLevel = currentRun.level ?? -1;
  const candidateLevel = candidateRun.level ?? -1;
  if (candidateLevel !== currentLevel) {
    return candidateLevel > currentLevel;
  }

  const currentUpgradeCount = getMythicPlusRunUpgradeCount(currentRun) ?? -1;
  const candidateUpgradeCount = getMythicPlusRunUpgradeCount(candidateRun) ?? -1;
  if (candidateUpgradeCount !== currentUpgradeCount) {
    return candidateUpgradeCount > currentUpgradeCount;
  }

  const currentScore = currentRun.runScore ?? -1;
  const candidateScore = candidateRun.runScore ?? -1;
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  const currentDuration = currentRun.durationMs ?? Number.MAX_SAFE_INTEGER;
  const candidateDuration = candidateRun.durationMs ?? Number.MAX_SAFE_INTEGER;
  if (candidateDuration !== currentDuration) {
    return candidateDuration < currentDuration;
  }

  return getRunTimestamp(candidateRun) > getRunTimestamp(currentRun);
}

function getSnapshotCompletenessScore(snapshot: SnapshotDoc) {
  let score = 0;

  if (snapshot.playtimeSeconds > 0) score += 1;
  if (snapshot.playtimeThisLevelSeconds !== undefined) score += 1;
  if (snapshot.ownedKeystone !== undefined) score += 1;
  if (snapshot.stats.speedPercent !== undefined) score += 2;
  if (snapshot.stats.leechPercent !== undefined) score += 2;
  if (snapshot.stats.avoidancePercent !== undefined) score += 2;

  return score;
}

function shouldReplaceSnapshot(currentSnapshot: SnapshotDoc | undefined, candidateSnapshot: SnapshotDoc) {
  if (!currentSnapshot) return true;

  const currentScore = getSnapshotCompletenessScore(currentSnapshot);
  const candidateScore = getSnapshotCompletenessScore(candidateSnapshot);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  return candidateSnapshot._creationTime > currentSnapshot._creationTime;
}

function dedupeSnapshotsByTakenAt(snapshots: SnapshotDoc[]) {
  const dedupedSnapshots = new Map<number, SnapshotDoc>();

  for (const snapshot of snapshots) {
    const current = dedupedSnapshots.get(snapshot.takenAt);
    if (shouldReplaceSnapshot(current, snapshot)) {
      dedupedSnapshots.set(snapshot.takenAt, snapshot);
    }
  }

  return Array.from(dedupedSnapshots.values()).sort(
    (a, b) => a.takenAt - b.takenAt || a._creationTime - b._creationTime,
  );
}

function getSnapshotTimeFrameCutoffSeconds(timeFrame: SnapshotTimeFrame) {
  if (timeFrame === "all") return null;

  const days = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
  } satisfies Record<Exclude<SnapshotTimeFrame, "all">, number>;

  return Math.floor(Date.now() / 1000) - days[timeFrame] * 86400;
}

function getSnapshotDayStart(takenAt: number) {
  return Math.floor(takenAt / 86400) * 86400;
}

function getSnapshotBucketDaySpan(timeFrame: SnapshotTimeFrame) {
  if (timeFrame === "90d" || timeFrame === "all") {
    return 2;
  }
  return 1;
}

function bucketDailySnapshotsBySpan(
  snapshots: CharacterDailySnapshotDoc[],
  daySpan: number,
) {
  if (daySpan <= 1) {
    return snapshots;
  }

  const bucketed = new Map<number, CharacterDailySnapshotDoc>();
  for (const snapshot of snapshots) {
    const bucketKey = Math.floor(snapshot.dayStartAt / (daySpan * 86400));
    const current = bucketed.get(bucketKey);
    if (!current || snapshot.lastTakenAt >= current.lastTakenAt) {
      bucketed.set(bucketKey, snapshot);
    }
  }

  return Array.from(bucketed.values()).sort((a, b) => a.dayStartAt - b.dayStartAt);
}

async function getFirstSnapshotForCharacter(
  ctx: DbReaderCtx,
  characterId: Doc<"characters">["_id"],
) {
  return await ctx.db
    .query("snapshots")
    .withIndex("by_character_and_time", (q) => q.eq("characterId", characterId))
    .order("asc")
    .first();
}

async function getBucketedRawSnapshotsForCharacter(
  ctx: DbReaderCtx,
  characterId: Doc<"characters">["_id"],
  timeFrame: SnapshotTimeFrame,
) {
  const bucketDaySpan = getSnapshotBucketDaySpan(timeFrame);
  const cutoffSeconds = getSnapshotTimeFrameCutoffSeconds(timeFrame);
  const firstSnapshot =
    cutoffSeconds === null ? await getFirstSnapshotForCharacter(ctx, characterId) : null;
  const rangeStartAt = cutoffSeconds ?? firstSnapshot?.takenAt ?? null;
  if (rangeStartAt === null) {
    return [] as SnapshotDoc[];
  }

  const bucketStarts: number[] = [];
  const endDayStartAt = getSnapshotDayStart(Math.floor(Date.now() / 1000));
  const startDayStartAt = getSnapshotDayStart(rangeStartAt);
  const bucketSpanSeconds = bucketDaySpan * 86400;
  for (
    let bucketStartAt = startDayStartAt;
    bucketStartAt <= endDayStartAt;
    bucketStartAt += bucketSpanSeconds
  ) {
    bucketStarts.push(bucketStartAt);
  }

  const snapshots = await Promise.all(
    bucketStarts.map((bucketStartAt) =>
      ctx.db
        .query("snapshots")
        .withIndex("by_character_and_time", (q) =>
          q
            .eq("characterId", characterId)
            .gte("takenAt", bucketStartAt)
            .lt("takenAt", bucketStartAt + bucketSpanSeconds),
        )
        .order("desc")
        .first(),
    ),
  );

  return snapshots.filter((snapshot): snapshot is SnapshotDoc => snapshot !== null);
}

function buildMythicPlusBucketSummary(runs: MythicPlusRunDoc[]) {
  let totalAttempts = 0;
  let completedRuns = 0;
  let abandonedRuns = 0;
  let activeRuns = 0;
  let timedRuns = 0;
  let timed2To9 = 0;
  let timed10To11 = 0;
  let timed12To13 = 0;
  let timed14Plus = 0;
  let bestLevel: number | null = null;
  let bestScore: number | null = null;
  let totalLevel = 0;
  let levelCount = 0;
  let totalScore = 0;
  let scoreCount = 0;
  let lastRunAt: number | null = null;
  let bestTimedRun: MythicPlusRunDoc | null = null;

  for (const run of runs) {
    const runAt = getRunTimestamp(run);
    if (lastRunAt === null || runAt > lastRunAt) lastRunAt = runAt;

    const completed = isCompletedRun(run);
    const abandoned = isAbandonedRun(run);
    const active = isActiveRun(run);

    if (completed) {
      completedRuns += 1;
      totalAttempts += 1;
    } else if (abandoned) {
      abandonedRuns += 1;
      totalAttempts += 1;
    } else if (active) {
      activeRuns += 1;
    }

    if (completed && isTimedRun(run)) {
      timedRuns += 1;
      if (shouldReplaceBestTimedRun(bestTimedRun, run)) {
        bestTimedRun = run;
      }
      const level = run.level ?? 0;

      if (level >= 14) {
        timed14Plus += 1;
      } else if (level >= 12) {
        timed12To13 += 1;
      } else if (level >= 10) {
        timed10To11 += 1;
      } else if (level >= 2) {
        timed2To9 += 1;
      }
    }

    if ((completed || abandoned) && run.level !== undefined) {
      bestLevel = bestLevel === null ? run.level : Math.max(bestLevel, run.level);
      totalLevel += run.level;
      levelCount += 1;
    }

    if ((completed || abandoned) && run.runScore !== undefined) {
      bestScore = bestScore === null ? run.runScore : Math.max(bestScore, run.runScore);
      totalScore += run.runScore;
      scoreCount += 1;
    }
  }

  return {
    totalRuns: totalAttempts,
    totalAttempts,
    completedRuns,
    abandonedRuns,
    activeRuns,
    timedRuns,
    timed2To9,
    timed10To11,
    timed12To13,
    timed14Plus,
    bestLevel,
    bestTimedLevel: bestTimedRun?.level ?? null,
    bestTimedUpgradeCount: bestTimedRun ? getMythicPlusRunUpgradeCount(bestTimedRun) : null,
    bestTimedScore: bestTimedRun?.runScore ?? null,
    bestTimedDurationMs: bestTimedRun?.durationMs ?? null,
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
      bestTimedRun: MythicPlusRunDoc | null;
      bestTimedLevel: number | null;
      bestTimedUpgradeCount: number | null;
      bestTimedScore: number | null;
      bestTimedDurationMs: number | null;
      bestScore: number | null;
      lastRunAt: number | null;
    }
  >();

  for (const run of runs) {
    if (!isTerminalRun(run)) {
      continue;
    }

    const key = String(run.mapChallengeModeID ?? getMapLabel(run));
    const current = byDungeon.get(key) ?? {
      mapChallengeModeID: run.mapChallengeModeID ?? null,
      mapName: getMapLabel(run),
      totalRuns: 0,
      timedRuns: 0,
      bestLevel: null,
      bestTimedRun: null,
      bestTimedLevel: null,
      bestTimedUpgradeCount: null,
      bestTimedScore: null,
      bestTimedDurationMs: null,
      bestScore: null,
      lastRunAt: null,
    };

    current.totalRuns += 1;
    if (isCompletedRun(run) && isTimedRun(run)) {
      current.timedRuns += 1;
      if (shouldReplaceBestTimedRun(current.bestTimedRun, run)) {
        current.bestTimedRun = run;
      }
    }
    if (run.level !== undefined) {
      current.bestLevel = current.bestLevel === null ? run.level : Math.max(current.bestLevel, run.level);
    }
    if (run.runScore !== undefined) {
      current.bestScore =
        current.bestScore === null ? run.runScore : Math.max(current.bestScore, run.runScore);
    }

    const runAt = getRunTimestamp(run);
    current.lastRunAt = current.lastRunAt === null ? runAt : Math.max(current.lastRunAt, runAt);
    byDungeon.set(key, current);
  }

  return Array.from(byDungeon.values()).map((dungeon) => ({
    mapChallengeModeID: dungeon.mapChallengeModeID,
    mapName: dungeon.mapName,
    totalRuns: dungeon.totalRuns,
    timedRuns: dungeon.timedRuns,
    bestLevel: dungeon.bestLevel,
    bestTimedLevel: dungeon.bestTimedRun?.level ?? null,
    bestTimedUpgradeCount: dungeon.bestTimedRun
      ? getMythicPlusRunUpgradeCount(dungeon.bestTimedRun)
      : null,
    bestTimedScore: dungeon.bestTimedRun?.runScore ?? null,
    bestTimedDurationMs: dungeon.bestTimedRun?.durationMs ?? null,
    bestScore: dungeon.bestScore,
    lastRunAt: dungeon.lastRunAt,
  })).sort((a, b) => {
    const timedA = a.bestTimedLevel ?? -1;
    const timedB = b.bestTimedLevel ?? -1;
    if (timedB !== timedA) return timedB - timedA;
    const upgradesA = a.bestTimedUpgradeCount ?? 0;
    const upgradesB = b.bestTimedUpgradeCount ?? 0;
    if (upgradesB !== upgradesA) return upgradesB - upgradesA;
    const timedScoreA = a.bestTimedScore ?? -1;
    const timedScoreB = b.bestTimedScore ?? -1;
    if (timedScoreB !== timedScoreA) return timedScoreB - timedScoreA;
    const timedDurationA = a.bestTimedDurationMs ?? Number.MAX_SAFE_INTEGER;
    const timedDurationB = b.bestTimedDurationMs ?? Number.MAX_SAFE_INTEGER;
    if (timedDurationA !== timedDurationB) return timedDurationA - timedDurationB;
    const bestA = a.bestLevel ?? -1;
    const bestB = b.bestLevel ?? -1;
    if (bestB !== bestA) return bestB - bestA;
    return b.timedRuns - a.timedRuns;
  });
}

export function buildMythicPlusSummary(
  runs: MythicPlusRunDoc[],
  currentScore: number | null,
): CharacterMythicPlusSummary {
  let latestSeasonID: number | null = null;
  for (const run of runs) {
    if (run.seasonID === undefined) continue;
    latestSeasonID = latestSeasonID === null ? run.seasonID : Math.max(latestSeasonID, run.seasonID);
  }

  const currentSeasonRuns =
    latestSeasonID === null ? [] : runs.filter((run) => run.seasonID === latestSeasonID);

  return {
    latestSeasonID,
    currentScore,
    overall: buildMythicPlusBucketSummary(runs),
    currentSeason:
      latestSeasonID === null ? null : buildMythicPlusBucketSummary(currentSeasonRuns),
    currentSeasonDungeons: buildDungeonSummaries(currentSeasonRuns),
  };
}

type RecentRunRow = MythicPlusRunDoc & {
  status: ReturnType<typeof getMythicPlusRunLifecycleStatus>;
  playedAt: number;
  sortTimestamp: number;
  rowKey: string;
  upgradeCount: number | null;
  scoreIncrease: number | null;
};

function getRunMemberIdentityFingerprint(run: MythicPlusRunDoc) {
  return (run.members ?? [])
    .map((member) =>
      [
        member.name.trim().toLowerCase(),
        member.realm?.trim().toLowerCase() ?? "",
        member.role ?? "",
        member.classTag?.trim().toLowerCase() ?? "",
      ].join("|"),
    )
    .sort()
    .join(",");
}

export function buildRecentRuns(
  runs: MythicPlusRunDoc[],
): CharacterMythicPlusRecentRunPreview[] {
  const bestPreviousScoreByDungeon = new Map<string, number>();
  const scoreIncreaseByRunId = new Map<string, number>();
  const normalizeIdentityToken = (value: string | undefined): string | null => {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized === "" ? null : normalized;
  };
  const getRecentRunRowKey = (run: MythicPlusRunDoc, playedAt: number): string => {
    if (typeof run._id === "string" && run._id.trim() !== "") {
      return run._id;
    }

    const identityTokens: string[] = [];
    const attemptId = getMythicPlusRunAttemptId(run);
    if (attemptId !== null) {
      identityTokens.push(`aid:${attemptId}`);
    }

    const canonicalKey = getMythicPlusRunCanonicalKey(run);
    if (canonicalKey !== null) {
      identityTokens.push(`ck:${canonicalKey}`);
    }

    const fingerprint = normalizeIdentityToken(run.fingerprint);
    if (fingerprint !== null) {
      identityTokens.push(`fp:${fingerprint}`);
    }

    const identityComposite = identityTokens.length > 0 ? identityTokens.join("|") : "run";
    return `${identityComposite}|${playedAt}`;
  };

  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (!run) {
      continue;
    }

    if (!isCompletedRun(run) || run.runScore === undefined) {
      continue;
    }

    const progressionKey = getMythicPlusRunProgressionKey(run);
    const bestPreviousScore = bestPreviousScoreByDungeon.get(progressionKey);
    if (bestPreviousScore === undefined) {
      if (run.runScore > 0) {
        scoreIncreaseByRunId.set(run._id, run.runScore);
      }
    } else if (run.runScore > bestPreviousScore) {
      scoreIncreaseByRunId.set(run._id, run.runScore - bestPreviousScore);
    }

    bestPreviousScoreByDungeon.set(
      progressionKey,
      bestPreviousScore === undefined ? run.runScore : Math.max(bestPreviousScore, run.runScore),
    );
  }

  const projectedRuns: RecentRunRow[] = runs.map((run) => {
    const status = getMythicPlusRunLifecycleStatus(run);
    const sortTimestamp = getRunTimestamp(run);
    return {
      ...run,
      status,
      playedAt: sortTimestamp,
      sortTimestamp,
      rowKey: getRecentRunRowKey(run, sortTimestamp),
      upgradeCount: getMythicPlusRunUpgradeCount(run),
      scoreIncrease: scoreIncreaseByRunId.get(run._id) ?? null,
    };
  });

  const collapseIndexByKey = new Map<string, number>();
  const collapsedRuns: RecentRunRow[] = [];
  const getLegacyCollapseKey = (run: RecentRunRow) => {
    if (!isCompletedRun(run) || run.level === undefined || run.durationMs === undefined) {
      return null;
    }

    const mapToken =
      run.mapChallengeModeID !== undefined
        ? String(run.mapChallengeModeID)
        : getMapLabel(run).trim().toLowerCase();
    const timedToken = String(getMythicPlusRunTimedState(run) ?? "unknown");
    const partyFingerprint = getRunMemberIdentityFingerprint(run);
    return `${run.playedAt}|${mapToken}|${run.level}|${run.durationMs}|${timedToken}|${partyFingerprint}`;
  };

  for (const run of projectedRuns) {
    const collapseKey = getLegacyCollapseKey(run);
    if (!collapseKey) {
      collapsedRuns.push(run);
      continue;
    }

    const existingIndex = collapseIndexByKey.get(collapseKey);
    if (existingIndex === undefined) {
      collapseIndexByKey.set(collapseKey, collapsedRuns.length);
      collapsedRuns.push(run);
      continue;
    }

    const currentRun = collapsedRuns[existingIndex]!;
    const candidatePreferred = shouldReplaceMythicPlusRun(currentRun, run);
    const preferredRun = candidatePreferred ? run : currentRun;
    const fallbackRun = candidatePreferred ? currentRun : run;

    collapsedRuns[existingIndex] = {
      ...fallbackRun,
      ...preferredRun,
      members: mergeMythicPlusRunMembers(currentRun.members, run.members),
      rowKey: preferredRun.rowKey,
      playedAt: preferredRun.playedAt,
      sortTimestamp: preferredRun.sortTimestamp,
      upgradeCount: preferredRun.upgradeCount ?? fallbackRun.upgradeCount,
      scoreIncrease: preferredRun.scoreIncrease ?? fallbackRun.scoreIncrease,
    };
  }

  return collapsedRuns;
}

export function dedupeMythicPlusRuns(runs: MythicPlusRunDoc[]) {
  const dedupedRuns: MythicPlusRunDoc[] = [];
  const LEGACY_DST_SHIFT_SECONDS = 60 * 60;
  const LEGACY_DST_SHIFT_TOLERANCE_SECONDS = 2 * 60;
  const runLookups = {
    byAttemptId: new Map<string, number>(),
    byCanonicalKey: new Map<string, number>(),
    byCompatibilityAlias: new Map<string, number>(),
  };

  const pickDefinedValue = <T>(preferredValue: T | undefined, fallbackValue: T | undefined) =>
    preferredValue !== undefined ? preferredValue : fallbackValue;

  const setPreferredRunLookup = (
    map: Map<string, number>,
    key: string | undefined | null,
    runIndex: number,
  ) => {
    if (!key) {
      return;
    }

    const currentIndex = map.get(key);
    if (
      currentIndex === undefined ||
      shouldReplaceMythicPlusRun(dedupedRuns[currentIndex], dedupedRuns[runIndex]!)
    ) {
      map.set(key, runIndex);
    }
  };

  const registerRunLookups = (
    run: MythicPlusRunDoc,
    runIndex: number,
    aliases: Array<string | undefined | null> = [],
  ) => {
    setPreferredRunLookup(runLookups.byAttemptId, getMythicPlusRunAttemptId(run), runIndex);
    setPreferredRunLookup(runLookups.byCanonicalKey, getMythicPlusRunCanonicalKey(run), runIndex);

    const compatibilityAliases = new Set<string>();
    for (const alias of getMythicPlusRunCompatibilityLookupAliases(run)) {
      compatibilityAliases.add(alias);
    }
    for (const alias of aliases) {
      if (alias) {
        compatibilityAliases.add(alias);
      }
    }

    for (const alias of compatibilityAliases) {
      setPreferredRunLookup(runLookups.byCompatibilityAlias, alias, runIndex);
    }
  };

  const findMatchingRunIndex = (run: MythicPlusRunDoc) => {
    const attemptId = getMythicPlusRunAttemptId(run);
    if (attemptId) {
      const attemptMatchIndex = runLookups.byAttemptId.get(attemptId);
      if (attemptMatchIndex !== undefined) {
        return attemptMatchIndex;
      }
    }

    const canonicalKey = getMythicPlusRunCanonicalKey(run);
    if (canonicalKey) {
      const canonicalMatchIndex = runLookups.byCanonicalKey.get(canonicalKey);
      if (canonicalMatchIndex !== undefined) {
        return canonicalMatchIndex;
      }
    }

    for (const compatibilityAlias of getMythicPlusRunCompatibilityLookupAliases(run)) {
      const candidateIndex = runLookups.byCompatibilityAlias.get(compatibilityAlias);
      if (candidateIndex === undefined) {
        continue;
      }

      const candidate = dedupedRuns[candidateIndex];
      if (!candidate) {
        continue;
      }
      if (!canUseMythicPlusRunCompatibilityAliasMatch(candidate, run)) {
        continue;
      }

      const candidateCanonicalKey = getMythicPlusRunCanonicalKey(candidate);
      if (canonicalKey && candidateCanonicalKey && canonicalKey !== candidateCanonicalKey) {
        continue;
      }

      return candidateIndex;
    }

    return -1;
  };

  const mergeLifecycleTimestamp = (
    preferredValue: number | undefined,
    fallbackValue: number | undefined,
  ): number | undefined => {
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
  };

  const mergeDuplicateRuns = (currentRun: MythicPlusRunDoc, candidateRun: MythicPlusRunDoc) => {
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

    const merged: MythicPlusRunDoc = {
      ...fallbackRun,
      ...preferredRun,
      fingerprint:
        buildCanonicalMythicPlusRunFingerprint(preferredRun) ??
        buildCanonicalMythicPlusRunFingerprint(fallbackRun) ??
        preferredRun.fingerprint,
      observedAt:
        mergedObservedAt > 0
          ? mergedObservedAt
          : pickDefinedValue(preferredRun.observedAt, fallbackRun.observedAt) ?? 0,
      attemptId: pickDefinedValue(
        getMythicPlusRunAttemptId(preferredRun) ?? undefined,
        getMythicPlusRunAttemptId(fallbackRun) ?? undefined,
      ),
      canonicalKey: pickDefinedValue(
        getMythicPlusRunCanonicalKey(preferredRun) ?? undefined,
        getMythicPlusRunCanonicalKey(fallbackRun) ?? undefined,
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
    merged.canonicalKey = getMythicPlusRunCanonicalKey(merged) ?? merged.canonicalKey;
    merged.attemptId = getMythicPlusRunAttemptId(merged) ?? merged.attemptId;

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
  };

  for (const run of runs) {
    const matchIndex = findMatchingRunIndex(run);

    if (matchIndex < 0) {
      dedupedRuns.push(run);
      registerRunLookups(run, dedupedRuns.length - 1);
      continue;
    }

    const currentRun = dedupedRuns[matchIndex]!;
    const mergedRun = mergeDuplicateRuns(currentRun, run);
    dedupedRuns[matchIndex] = mergedRun;
    registerRunLookups(mergedRun, matchIndex, [
      currentRun.fingerprint,
      getMythicPlusRunAttemptId(currentRun),
      getMythicPlusRunCanonicalKey(currentRun),
      run.fingerprint,
      getMythicPlusRunAttemptId(run),
      getMythicPlusRunCanonicalKey(run),
      mergedRun.fingerprint,
      getMythicPlusRunAttemptId(mergedRun),
      getMythicPlusRunCanonicalKey(mergedRun),
    ]);
  }

  return dedupedRuns.sort((a, b) => {
    const timeDiff = getRunTimestamp(b) - getRunTimestamp(a);
    if (timeDiff !== 0) return timeDiff;
    return b.observedAt - a.observedAt;
  });
}

export const __testables = {
  dedupeMythicPlusRuns,
  buildRecentRuns,
  buildMythicPlusSummary,
};

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

    const [owner, snapshots] = await Promise.all([
      ctx.db.get(character.playerId),
      ctx.db
        .query("snapshots")
        .withIndex("by_character_and_time", (q) => q.eq("characterId", characterId))
        .order("asc")
        .collect(),
    ]);

    return {
      character,
      owner: owner
        ? {
            playerId: owner._id,
            battleTag: owner.battleTag,
            discordUserId: owner.discordUserId ?? null,
          }
        : null,
      snapshots: dedupeSnapshotsByTakenAt(snapshots),
    };
  },
});

export const getCharacterHeader = query({
  args: { characterId: v.id("characters") },
  handler: async (ctx, { characterId }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const character = await ctx.db.get(characterId);
    if (!character) return null;

    const storedLatestSnapshotDetails = getCharacterStoredLatestSnapshotDetails(character);
    const [owner, latestSnapshot, firstSnapshot] = await Promise.all([
      ctx.db.get(character.playerId),
      storedLatestSnapshotDetails
        ? Promise.resolve(storedLatestSnapshotDetails)
        : getLatestSnapshotForCharacter(ctx, characterId).then((snapshot) =>
            toSnapshotDetails(snapshot),
          ),
      character.firstSnapshotAt === undefined ? getFirstSnapshotForCharacter(ctx, characterId) : null,
    ]);

    return {
      character,
      owner: owner
        ? {
            playerId: owner._id,
            battleTag: owner.battleTag,
            discordUserId: owner.discordUserId ?? null,
          }
        : null,
      latestSnapshot,
      firstSnapshotAt: character.firstSnapshotAt ?? firstSnapshot?.takenAt ?? null,
      snapshotCount: character.snapshotCount ?? null,
    };
  },
});

export const getCharacterCoreTimeline = query({
  args: {
    characterId: v.id("characters"),
    timeFrame: snapshotTimeFrameValidator,
  },
  handler: async (ctx, { characterId, timeFrame }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const character = await ctx.db.get(characterId);
    if (!character) return null;

    const cutoffSeconds = getSnapshotTimeFrameCutoffSeconds(timeFrame);
    const bucketDaySpan = getSnapshotBucketDaySpan(timeFrame);
    const dailySnapshots = await ctx.db
      .query("characterDailySnapshots")
      .withIndex("by_character_and_day", (q) => {
        const range = q.eq("characterId", characterId);
        return cutoffSeconds === null ? range : range.gte("dayStartAt", getSnapshotDayStart(cutoffSeconds));
      })
      .order("asc")
      .collect();

    if (dailySnapshots.length > 0) {
      return {
        snapshots: bucketDailySnapshotsBySpan(dailySnapshots, bucketDaySpan).map((snapshot) => ({
          takenAt: snapshot.lastTakenAt,
          itemLevel: snapshot.itemLevel,
          gold: snapshot.gold,
          playtimeSeconds: snapshot.playtimeSeconds,
          mythicPlusScore: snapshot.mythicPlusScore,
        })),
      };
    }

    const snapshots = await getBucketedRawSnapshotsForCharacter(ctx, characterId, timeFrame);
    return {
      snapshots: snapshots.map((snapshot) => ({
        takenAt: snapshot.takenAt,
        itemLevel: snapshot.itemLevel,
        gold: snapshot.gold,
        playtimeSeconds: snapshot.playtimeSeconds,
        mythicPlusScore: snapshot.mythicPlusScore,
      })),
    };
  },
});

export const getCharacterDetailTimeline = query({
  args: {
    characterId: v.id("characters"),
    timeFrame: snapshotTimeFrameValidator,
    metric: snapshotDetailMetricValidator,
  },
  handler: async (ctx, { characterId, timeFrame, metric }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const character = await ctx.db.get(characterId);
    if (!character) return null;

    const snapshots = await getBucketedRawSnapshotsForCharacter(ctx, characterId, timeFrame);
    if (metric === "stats") {
      return {
        metric,
        snapshots: snapshots.map((snapshot) => ({
          takenAt: snapshot.takenAt,
          stats: snapshot.stats,
        })),
      };
    }

    return {
      metric,
      snapshots: snapshots.map((snapshot) => ({
        takenAt: snapshot.takenAt,
        currencies: snapshot.currencies,
      })),
    };
  },
});

export const getCharacterSnapshotTimeline = query({
  args: {
    characterId: v.id("characters"),
    timeFrame: snapshotTimeFrameValidator,
  },
  handler: async (ctx, { characterId, timeFrame }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const character = await ctx.db.get(characterId);
    if (!character) return null;

    const cutoffSeconds = getSnapshotTimeFrameCutoffSeconds(timeFrame);
    const snapshots = await ctx.db
      .query("snapshots")
      .withIndex("by_character_and_time", (q) => {
        const range = q.eq("characterId", characterId);
        return cutoffSeconds === null ? range : range.gte("takenAt", cutoffSeconds);
      })
      .order("asc")
      .collect();

    return {
      snapshots: dedupeSnapshotsByTakenAt(snapshots).map((snapshot) => ({
        takenAt: snapshot.takenAt,
        itemLevel: snapshot.itemLevel,
        mythicPlusScore: snapshot.mythicPlusScore,
        playtimeSeconds: snapshot.playtimeSeconds,
        ownedKeystone: snapshot.ownedKeystone ?? undefined,
      })),
    };
  },
});

export const getCharacterMythicPlus = query({
  args: { characterId: v.id("characters") },
  handler: async (ctx, { characterId }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const character = await ctx.db.get(characterId);
    if (!character) return null;

    const storedMythicPlusData = getCharacterStoredMythicPlusData(character);
    if (storedMythicPlusData) {
      return storedMythicPlusData;
    }

    const currentScorePromise =
      character.latestSnapshot?.mythicPlusScore !== undefined
        ? Promise.resolve(character.latestSnapshot.mythicPlusScore)
        : character.latestSnapshotDetails?.mythicPlusScore !== undefined
          ? Promise.resolve(character.latestSnapshotDetails.mythicPlusScore)
      : getLatestSnapshotSummaryForCharacter(ctx, character).then(
          (latestSnapshot) => latestSnapshot?.mythicPlusScore ?? null,
        );

    const [runs, currentScore] = await Promise.all([
      ctx.db
        .query("mythicPlusRuns")
        .withIndex("by_character_and_observedAt", (q) => q.eq("characterId", characterId))
        .order("desc")
        .collect(),
      currentScorePromise,
    ]);

    const sortedRuns = dedupeMythicPlusRuns(runs);
    const recentRuns = buildRecentRuns(sortedRuns);

    return {
      runs: recentRuns,
      summary: buildMythicPlusSummary(sortedRuns, currentScore),
      totalRunCount: recentRuns.length,
      isPreview: false,
    };
  },
});

export const getCharacterMythicPlusAllRuns = query({
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

    const sortedRuns = dedupeMythicPlusRuns(runs);
    const recentRuns = buildRecentRuns(sortedRuns);

    return {
      runs: recentRuns,
      totalRunCount: recentRuns.length,
    };
  },
});

export const getScoreboard = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const characters = await ctx.db.query("characters").collect();

    const withLatestSnapshots = await getCharactersWithLatestSnapshots(ctx, characters);

    const withSnapshots = withLatestSnapshots.map(({ character, snapshot }) => {
      if (!snapshot) return null;

      return {
        characterId: character._id,
        playerId: character.playerId,
        name: character.name,
        realm: character.realm,
        region: character.region,
        class: character.class,
        race: character.race,
        faction: character.faction,
        mythicPlusScore: snapshot.mythicPlusScore,
        itemLevel: snapshot.itemLevel,
        gold: snapshot.gold,
        playtimeSeconds: snapshot.playtimeSeconds,
        playtimeThisLevelSeconds: snapshot.playtimeThisLevelSeconds,
        ownedKeystone: snapshot.ownedKeystone ?? null,
        spec: snapshot.spec,
        role: snapshot.role,
        level: snapshot.level,
        takenAt: snapshot.takenAt,
      };
    });

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
      {
        playerId: Doc<"players">["_id"];
        battleTag: string;
        totalPlaytimeSeconds: number;
        totalGold: number;
        highestMythicPlusScore: number;
        highestMythicPlusCharacterName: string | null;
        totalItemLevel: number;
        characterCount: number;
        bestKeystoneLevel: number | null;
        bestKeystoneMapChallengeModeID: number | null;
        bestKeystoneMapName: string | null;
        latestSnapshotAt: number | null;
      }
    >();

    const charSnapshots = await getCharactersWithLatestSnapshots(ctx, characters);

    const playerIds = [...new Set(characters.map((c) => c.playerId))];
    const playerRecords = await Promise.all(playerIds.map((id) => ctx.db.get(id)));
    const playerBattleTagMap = new Map(
      playerIds.map((id, i) => [id.toString(), playerRecords[i]?.battleTag ?? ""]),
    );

    for (const { character, snapshot } of charSnapshots) {
      if (!snapshot) continue;
      const playerId = character.playerId.toString();
      const existing = playerMap.get(playerId);
      if (existing) {
        existing.totalPlaytimeSeconds += snapshot.playtimeSeconds;
        existing.totalGold += snapshot.gold;
        if (snapshot.mythicPlusScore > existing.highestMythicPlusScore) {
          existing.highestMythicPlusScore = snapshot.mythicPlusScore;
          existing.highestMythicPlusCharacterName = character.name;
        }
        existing.totalItemLevel += snapshot.itemLevel;
        existing.characterCount += 1;
        if (
          snapshot.ownedKeystone &&
          (existing.bestKeystoneLevel === null || snapshot.ownedKeystone.level > existing.bestKeystoneLevel)
        ) {
          existing.bestKeystoneLevel = snapshot.ownedKeystone.level;
          existing.bestKeystoneMapChallengeModeID = snapshot.ownedKeystone.mapChallengeModeID ?? null;
          existing.bestKeystoneMapName = snapshot.ownedKeystone.mapName ?? null;
        }
        if (existing.latestSnapshotAt === null || snapshot.takenAt > existing.latestSnapshotAt) {
          existing.latestSnapshotAt = snapshot.takenAt;
        }
      } else {
        playerMap.set(playerId, {
          playerId: character.playerId,
          battleTag: playerBattleTagMap.get(playerId) ?? "",
          totalPlaytimeSeconds: snapshot.playtimeSeconds,
          totalGold: snapshot.gold,
          highestMythicPlusScore: snapshot.mythicPlusScore,
          highestMythicPlusCharacterName: character.name,
          totalItemLevel: snapshot.itemLevel,
          characterCount: 1,
          bestKeystoneLevel: snapshot.ownedKeystone?.level ?? null,
          bestKeystoneMapChallengeModeID: snapshot.ownedKeystone?.mapChallengeModeID ?? null,
          bestKeystoneMapName: snapshot.ownedKeystone?.mapName ?? null,
          latestSnapshotAt: snapshot.takenAt,
        });
      }
    }

    return Array.from(playerMap.values())
      .map((player) => ({
        playerId: player.playerId,
        battleTag: player.battleTag,
        totalPlaytimeSeconds: player.totalPlaytimeSeconds,
        totalGold: player.totalGold,
        highestMythicPlusScore: player.highestMythicPlusScore,
        highestMythicPlusCharacterName: player.highestMythicPlusCharacterName,
        averageItemLevel: player.characterCount > 0 ? player.totalItemLevel / player.characterCount : 0,
        characterCount: player.characterCount,
        bestKeystoneLevel: player.bestKeystoneLevel,
        bestKeystoneMapChallengeModeID: player.bestKeystoneMapChallengeModeID,
        bestKeystoneMapName: player.bestKeystoneMapName,
        latestSnapshotAt: player.latestSnapshotAt,
      }))
      .sort(
        (a, b) =>
          b.highestMythicPlusScore - a.highestMythicPlusScore ||
          b.totalPlaytimeSeconds - a.totalPlaytimeSeconds ||
          b.totalGold - a.totalGold,
      );
  },
});

export const getPlayerCharacters = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const player = await ctx.db.get(playerId);
    if (!player) return null;

    const characters = await ctx.db
      .query("characters")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .collect();

    const withSnapshots = (await getCharactersWithLatestSnapshots(ctx, characters)).map(
      ({ character, snapshot }) => ({
        ...character,
        snapshot,
      }),
    );

    const snappedCharacters = withSnapshots.flatMap((character) =>
      character.snapshot ? [{ ...character, snapshot: character.snapshot }] : [],
    );

    let totalPlaytimeSeconds = 0;
    let totalGold = 0;
    let highestMythicPlusScore: number | null = null;
    let highestMythicPlusCharacterName: string | null = null;
    let totalItemLevel = 0;
    let bestKeystone:
      | {
          level: number;
          mapChallengeModeID: number | null;
          mapName: string | null;
        }
      | null = null;
    let latestSnapshotAt: number | null = null;

    for (const character of snappedCharacters) {
      const snapshot = character.snapshot;
      totalPlaytimeSeconds += snapshot.playtimeSeconds;
      totalGold += snapshot.gold;
      if (highestMythicPlusScore === null || snapshot.mythicPlusScore > highestMythicPlusScore) {
        highestMythicPlusScore = snapshot.mythicPlusScore;
        highestMythicPlusCharacterName = character.name;
      }
      totalItemLevel += snapshot.itemLevel;

      if (snapshot.ownedKeystone) {
        if (bestKeystone === null || snapshot.ownedKeystone.level > bestKeystone.level) {
          bestKeystone = {
            level: snapshot.ownedKeystone.level,
            mapChallengeModeID: snapshot.ownedKeystone.mapChallengeModeID ?? null,
            mapName: snapshot.ownedKeystone.mapName ?? null,
          };
        }
      }

      if (latestSnapshotAt === null || snapshot.takenAt > latestSnapshotAt) {
        latestSnapshotAt = snapshot.takenAt;
      }
    }

    const sortedCharacters = [...withSnapshots].sort((a, b) => {
      const snapshotA = a.snapshot;
      const snapshotB = b.snapshot;
      if (!snapshotA && !snapshotB) {
        return a.name.localeCompare(b.name);
      }
      if (!snapshotA) return 1;
      if (!snapshotB) return -1;

      return (
        snapshotB.mythicPlusScore - snapshotA.mythicPlusScore ||
        snapshotB.itemLevel - snapshotA.itemLevel ||
        (snapshotB.ownedKeystone?.level ?? -1) - (snapshotA.ownedKeystone?.level ?? -1) ||
        a.name.localeCompare(b.name)
      );
    });

    return {
      player: {
        playerId: player._id,
        battleTag: player.battleTag,
      },
      summary: {
        trackedCharacters: withSnapshots.length,
        scannedCharacters: snappedCharacters.length,
        totalPlaytimeSeconds,
        totalGold,
        highestMythicPlusScore,
        highestMythicPlusCharacterName,
        averageItemLevel: snappedCharacters.length > 0 ? totalItemLevel / snappedCharacters.length : null,
        bestKeystone,
        latestSnapshotAt,
      },
      characters: sortedCharacters,
    };
  },
});

export const getMyCharactersWithSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const player = await getPlayerForAuthUser(ctx, authUser._id as string);

    if (!player) return null;

    const characters = await ctx.db
      .query("characters")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .collect();

    return (await getCharactersWithLatestSnapshots(ctx, characters)).map(({ character, snapshot }) => ({
      ...character,
      snapshot,
    }));
  },
});

export const setCharacterBoosterStatus = mutation({
  args: {
    characterId: v.id("characters"),
    isBooster: v.boolean(),
  },
  handler: async (ctx, { characterId, isBooster }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("Unauthorized");
    }

    const character = await ctx.db.get(characterId);
    if (!character) {
      throw new Error("Character not found.");
    }

    await ctx.db.patch(characterId, {
      isBooster,
    });

    return {
      characterId,
      isBooster,
    };
  },
});

export const setCharacterNonTradeableSlots = mutation({
  args: {
    characterId: v.id("characters"),
    nonTradeableSlots: v.array(nonTradeableSlotValidator),
  },
  handler: async (ctx, { characterId, nonTradeableSlots }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("Unauthorized");
    }

    const character = await ctx.db.get(characterId);
    if (!character) {
      throw new Error("Character not found.");
    }

    const normalizedSlots = normalizeNonTradeableSlots(nonTradeableSlots);

    await ctx.db.patch(characterId, {
      nonTradeableSlots: normalizedSlots.length > 0 ? normalizedSlots : undefined,
    });

    return {
      characterId,
      nonTradeableSlots: normalizedSlots,
    };
  },
});

export const getCharactersWithLatestSnapshot = query({
  args: {
    characterIds: v.array(v.id("characters")),
  },
  handler: async (ctx, { characterIds }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const uniqueCharacterIds = [...new Set(characterIds)];
    if (uniqueCharacterIds.length === 0) return [];

    const characters = (
      await Promise.all(
        uniqueCharacterIds.map(async (characterId) => {
          const character = await ctx.db.get(characterId);
          if (!character) return null;
          return character;
        }),
      )
    ).filter((character): character is NonNullable<typeof character> => character !== null);

    return (await getCharactersWithLatestSnapshots(ctx, characters)).map(
      ({ character, snapshot }) => ({
        ...character,
        snapshot: snapshot
          ? {
              itemLevel: snapshot.itemLevel,
            }
          : null,
      }),
    );
  },
});

export const getBoosterCharactersForExport = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const boosterCharacters = await ctx.db
      .query("characters")
      .withIndex("by_booster", (q) => q.eq("isBooster", true))
      .collect();

    const withSnapshots = await getCharactersWithLatestSnapshots(ctx, boosterCharacters);
    const uniquePlayerIds = Array.from(
      new Map(boosterCharacters.map((character) => [String(character.playerId), character.playerId])).values(),
    );
    const owners = await Promise.all(uniquePlayerIds.map((playerId) => ctx.db.get(playerId)));
    const ownerById = new Map(
      uniquePlayerIds.map((playerId, index) => [String(playerId), owners[index] ?? null]),
    );

    return withSnapshots
      .map(({ character, snapshot }) => {
        const owner = ownerById.get(String(character.playerId));

        return {
          _id: character._id,
          playerId: character.playerId,
          name: character.name,
          realm: character.realm,
          region: character.region,
          class: character.class,
          faction: character.faction,
          isBooster: character.isBooster ?? false,
          nonTradeableSlots: character.nonTradeableSlots ?? [],
          ownerBattleTag: owner?.battleTag ?? null,
          ownerDiscordUserId: owner?.discordUserId ?? null,
          snapshot: snapshot
            ? {
                spec: snapshot.spec,
                role: snapshot.role,
                mythicPlusScore: snapshot.mythicPlusScore,
                itemLevel: snapshot.itemLevel,
                takenAt: snapshot.takenAt,
                ownedKeystone: snapshot.ownedKeystone ?? null,
              }
            : null,
        };
      })
      .sort((a, b) => {
        if (a.snapshot && !b.snapshot) return -1;
        if (!a.snapshot && b.snapshot) return 1;

        const roleDiff = getRoleSortRank(a.snapshot?.role) - getRoleSortRank(b.snapshot?.role);
        if (roleDiff !== 0) return roleDiff;

        const scoreDiff = (b.snapshot?.mythicPlusScore ?? -1) - (a.snapshot?.mythicPlusScore ?? -1);
        if (scoreDiff !== 0) return scoreDiff;

        return a.name.localeCompare(b.name);
      });
  },
});

export const backfillCharacterLatestSnapshots = mutation({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return { totalCharacters: 0, updatedCharacters: 0 };

    const player = await getPlayerForAuthUser(ctx, authUser._id as string);
    if (!player) return { totalCharacters: 0, updatedCharacters: 0 };

    const characters = await ctx.db
      .query("characters")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .collect();

    let updatedCharacters = 0;
    for (const character of characters) {
      const latestRawSnapshot = await getLatestSnapshotForCharacter(ctx, character._id);
      const latestSnapshot = toSnapshotSummary(latestRawSnapshot);
      const latestSnapshotDetails = toSnapshotDetails(latestRawSnapshot);
      if (!latestSnapshot || !latestSnapshotDetails) continue;

      const currentLatestSnapshot = getCharacterStoredLatestSnapshot(character);
      const currentLatestSnapshotDetails = getCharacterStoredLatestSnapshotDetails(character);
      if (
        isSameSnapshotSummary(currentLatestSnapshot, latestSnapshot) &&
        JSON.stringify(currentLatestSnapshotDetails) === JSON.stringify(latestSnapshotDetails)
      ) {
        continue;
      }

      await ctx.db.patch(character._id, {
        latestSnapshot,
        latestSnapshotDetails,
      });
      updatedCharacters += 1;
    }

    return {
      totalCharacters: characters.length,
      updatedCharacters,
    };
  },
});

export const backfillCharacterSnapshotOptimizations = mutation({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return { totalCharacters: 0, updatedCharacters: 0, updatedDailySnapshots: 0 };
    }

    const player = await getPlayerForAuthUser(ctx, authUser._id as string);
    if (!player) {
      return { totalCharacters: 0, updatedCharacters: 0, updatedDailySnapshots: 0 };
    }

    const characters = await ctx.db
      .query("characters")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .collect();

    let updatedCharacters = 0;
    let updatedDailySnapshots = 0;

    for (const character of characters) {
      const rawSnapshots = await ctx.db
        .query("snapshots")
        .withIndex("by_character_and_time", (q) => q.eq("characterId", character._id))
        .order("asc")
        .collect();
      const snapshots = dedupeSnapshotsByTakenAt(rawSnapshots);
      if (snapshots.length === 0) {
        continue;
      }

      const firstSnapshotAt = snapshots[0]?.takenAt;
      const snapshotCount = snapshots.length;
      const latestSnapshotDetails = toSnapshotDetails(snapshots[snapshots.length - 1] ?? null);
      const latestSnapshotSummary = toSnapshotSummary(snapshots[snapshots.length - 1] ?? null);
      let shouldPatchCharacter = false;
      const characterPatch: Partial<Doc<"characters">> = {};
      if (
        firstSnapshotAt !== undefined &&
        (character.firstSnapshotAt !== firstSnapshotAt || character.snapshotCount !== snapshotCount)
      ) {
        characterPatch.firstSnapshotAt = firstSnapshotAt;
        characterPatch.snapshotCount = snapshotCount;
        shouldPatchCharacter = true;
      }
      if (
        latestSnapshotSummary &&
        !isSameSnapshotSummary(character.latestSnapshot ?? null, latestSnapshotSummary)
      ) {
        characterPatch.latestSnapshot = latestSnapshotSummary;
        shouldPatchCharacter = true;
      }
      if (
        latestSnapshotDetails &&
        JSON.stringify(character.latestSnapshotDetails ?? null) !==
          JSON.stringify(latestSnapshotDetails)
      ) {
        characterPatch.latestSnapshotDetails = latestSnapshotDetails;
        shouldPatchCharacter = true;
      }
      if (shouldPatchCharacter) {
        await ctx.db.patch(character._id, characterPatch);
        updatedCharacters += 1;
      }

      const latestByDay = new Map<number, SnapshotDoc>();
      for (const snapshot of snapshots) {
        latestByDay.set(getSnapshotDayStart(snapshot.takenAt), snapshot);
      }

      for (const [dayStartAt, snapshot] of latestByDay) {
        const existingDailySnapshot = await ctx.db
          .query("characterDailySnapshots")
          .withIndex("by_character_and_day", (q) =>
            q.eq("characterId", character._id).eq("dayStartAt", dayStartAt),
          )
          .first();
        const nextDailySnapshot = {
          dayStartAt,
          lastTakenAt: snapshot.takenAt,
          itemLevel: snapshot.itemLevel,
          gold: snapshot.gold,
          playtimeSeconds: snapshot.playtimeSeconds,
          mythicPlusScore: snapshot.mythicPlusScore,
        };

        if (!existingDailySnapshot) {
          await ctx.db.insert("characterDailySnapshots", {
            characterId: character._id,
            ...nextDailySnapshot,
          });
          updatedDailySnapshots += 1;
          continue;
        }

        if (
          existingDailySnapshot.lastTakenAt !== nextDailySnapshot.lastTakenAt ||
          existingDailySnapshot.itemLevel !== nextDailySnapshot.itemLevel ||
          existingDailySnapshot.gold !== nextDailySnapshot.gold ||
          existingDailySnapshot.playtimeSeconds !== nextDailySnapshot.playtimeSeconds ||
          existingDailySnapshot.mythicPlusScore !== nextDailySnapshot.mythicPlusScore
        ) {
          await ctx.db.patch(existingDailySnapshot._id, nextDailySnapshot);
          updatedDailySnapshots += 1;
        }
      }
    }

    return {
      totalCharacters: characters.length,
      updatedCharacters,
      updatedDailySnapshots,
    };
  },
});

export const backfillCharacterMythicPlusOptimizations = mutation({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      return { totalCharacters: 0, updatedCharacters: 0 };
    }

    const player = await getPlayerForAuthUser(ctx, authUser._id as string);
    if (!player) {
      return { totalCharacters: 0, updatedCharacters: 0 };
    }

    const characters = await ctx.db
      .query("characters")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .collect();

    let updatedCharacters = 0;
    for (const character of characters) {
      const runs = await ctx.db
        .query("mythicPlusRuns")
        .withIndex("by_character_and_observedAt", (q) => q.eq("characterId", character._id))
        .order("desc")
        .collect();

      const dedupedRuns = dedupeMythicPlusRuns(runs);
      const recentRuns = buildRecentRuns(dedupedRuns);
      const mythicPlusSummary = buildMythicPlusSummary(
        dedupedRuns,
        character.latestSnapshot?.mythicPlusScore ??
          character.latestSnapshotDetails?.mythicPlusScore ??
          null,
      );
      const mythicPlusRecentRunsPreview = recentRuns.slice(0, MYTHIC_PLUS_PREVIEW_RUN_LIMIT);
      const mythicPlusRunCount = recentRuns.length;

      if (
        JSON.stringify(character.mythicPlusSummary ?? null) === JSON.stringify(mythicPlusSummary) &&
        JSON.stringify(character.mythicPlusRecentRunsPreview ?? null) ===
          JSON.stringify(mythicPlusRecentRunsPreview) &&
        character.mythicPlusRunCount === mythicPlusRunCount
      ) {
        continue;
      }

      await ctx.db.patch(character._id, {
        mythicPlusSummary,
        mythicPlusRecentRunsPreview,
        mythicPlusRunCount,
      });
      updatedCharacters += 1;
    }

    return {
      totalCharacters: characters.length,
      updatedCharacters,
    };
  },
});
