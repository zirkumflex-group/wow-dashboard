import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import {
  buildCanonicalMythicPlusRunFingerprint,
  getMythicPlusRunAttemptId,
  getMythicPlusRunCanonicalKey,
  getMythicPlusRunLifecycleStatus,
  mergeMythicPlusRunMembers,
  getMythicPlusRunTimedState,
  getMythicPlusRunUpgradeCount,
  getMythicPlusRunSortValue,
  shouldReplaceMythicPlusRun,
} from "./mythicPlus";
import { rateLimiter } from "./rateLimiter";

type MythicPlusRunDoc = Doc<"mythicPlusRuns"> & { canonicalKey?: string };
type SnapshotDoc = Doc<"snapshots">;

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

function buildMythicPlusSummary(runs: MythicPlusRunDoc[], currentScore: number | null) {
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

function buildRecentRuns(runs: MythicPlusRunDoc[]) {
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

  return runs.map((run) => {
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
}

function dedupeMythicPlusRuns(runs: MythicPlusRunDoc[]) {
  const dedupedRuns: MythicPlusRunDoc[] = [];
  const LEGACY_DST_SHIFT_SECONDS = 60 * 60;
  const LEGACY_DST_SHIFT_TOLERANCE_SECONDS = 2 * 60;

  const pickDefinedValue = <T>(preferredValue: T | undefined, fallbackValue: T | undefined) =>
    preferredValue !== undefined ? preferredValue : fallbackValue;

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
    const runAttemptId = getMythicPlusRunAttemptId(run);
    const runCanonicalKey = getMythicPlusRunCanonicalKey(run);
    let matchIndex = -1;

    for (let index = 0; index < dedupedRuns.length; index += 1) {
      const current = dedupedRuns[index]!;
      const currentAttemptId = getMythicPlusRunAttemptId(current);
      const currentCanonicalKey = getMythicPlusRunCanonicalKey(current);
      const hasExactAttemptMatch =
        runAttemptId !== null && currentAttemptId !== null && runAttemptId === currentAttemptId;
      const hasExactCanonicalMatch =
        runCanonicalKey !== null &&
        currentCanonicalKey !== null &&
        runCanonicalKey === currentCanonicalKey;
      if (hasExactAttemptMatch || hasExactCanonicalMatch) {
        matchIndex = index;
        break;
      }
    }

    if (matchIndex < 0) {
      dedupedRuns.push(run);
      continue;
    }

    dedupedRuns[matchIndex] = mergeDuplicateRuns(dedupedRuns[matchIndex]!, run);
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

    const snapshots = await ctx.db
      .query("snapshots")
      .withIndex("by_character_and_time", (q) => q.eq("characterId", characterId))
      .order("asc")
      .collect();

    return { character, snapshots: dedupeSnapshotsByTakenAt(snapshots) };
  },
});

export const getCharacterMythicPlus = query({
  args: { characterId: v.id("characters") },
  handler: async (ctx, { characterId }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const character = await ctx.db.get(characterId);
    if (!character) return null;

    const [runs, latestSnapshot] = await Promise.all([
      ctx.db
        .query("mythicPlusRuns")
        .withIndex("by_character_and_observedAt", (q) => q.eq("characterId", characterId))
        .order("desc")
        .collect(),
      ctx.db
        .query("snapshots")
        .withIndex("by_character_and_time", (q) => q.eq("characterId", characterId))
        .order("desc")
        .first(),
    ]);

    const sortedRuns = dedupeMythicPlusRuns(runs);

    return {
      runs: buildRecentRuns(sortedRuns),
      summary: buildMythicPlusSummary(sortedRuns, latestSnapshot?.mythicPlusScore ?? null),
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
          playerId: char.playerId,
          name: char.name,
          realm: char.realm,
          region: char.region,
          class: char.class,
          race: char.race,
          faction: char.faction,
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
      {
        playerId: Doc<"players">["_id"];
        battleTag: string;
        totalPlaytimeSeconds: number;
        totalGold: number;
        totalMythicPlusScore: number;
        totalItemLevel: number;
        characterCount: number;
        bestKeystoneLevel: number | null;
        bestKeystoneMapChallengeModeID: number | null;
        bestKeystoneMapName: string | null;
        latestSnapshotAt: number | null;
      }
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
        existing.totalMythicPlusScore += snapshot.mythicPlusScore;
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
          playerId: char.playerId,
          battleTag: playerBattleTagMap.get(playerId) ?? "",
          totalPlaytimeSeconds: snapshot.playtimeSeconds,
          totalGold: snapshot.gold,
          totalMythicPlusScore: snapshot.mythicPlusScore,
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
        totalMythicPlusScore: player.totalMythicPlusScore,
        averageItemLevel: player.characterCount > 0 ? player.totalItemLevel / player.characterCount : 0,
        characterCount: player.characterCount,
        bestKeystoneLevel: player.bestKeystoneLevel,
        bestKeystoneMapChallengeModeID: player.bestKeystoneMapChallengeModeID,
        bestKeystoneMapName: player.bestKeystoneMapName,
        latestSnapshotAt: player.latestSnapshotAt,
      }))
      .sort(
        (a, b) =>
          b.totalMythicPlusScore - a.totalMythicPlusScore ||
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

    const withSnapshots = await Promise.all(
      characters.map(async (char) => {
        const snapshot = await ctx.db
          .query("snapshots")
          .withIndex("by_character_and_time", (q) => q.eq("characterId", char._id))
          .order("desc")
          .first();
        return { ...char, snapshot: snapshot ?? null };
      }),
    );

    const snappedCharacters = withSnapshots.flatMap((character) =>
      character.snapshot ? [{ ...character, snapshot: character.snapshot }] : [],
    );

    let totalPlaytimeSeconds = 0;
    let totalGold = 0;
    let totalMythicPlusScore = 0;
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
      totalMythicPlusScore += snapshot.mythicPlusScore;
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
        totalMythicPlusScore,
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

export const getCharactersWithLatestSnapshot = query({
  args: {
    characterIds: v.array(v.id("characters")),
  },
  handler: async (ctx, { characterIds }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const uniqueCharacterIds = [...new Set(characterIds)];

    return (
      await Promise.all(
        uniqueCharacterIds.map(async (characterId) => {
          const char = await ctx.db.get(characterId);
          if (!char) return null;

          const snapshot = await ctx.db
            .query("snapshots")
            .withIndex("by_character_and_time", (q) => q.eq("characterId", char._id))
            .order("desc")
            .first();

          return { ...char, snapshot: snapshot ?? null };
        }),
      )
    ).filter((char): char is NonNullable<typeof char> => char !== null);
  },
});
