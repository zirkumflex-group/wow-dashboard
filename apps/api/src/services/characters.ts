import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import type {
  CharacterDetailTimelineResponse,
  CharacterMythicPlusResponse,
  CharacterPageResponse,
  CharacterSnapshotTimelineResponse,
} from "@wow-dashboard/api-schema";
import {
  account,
  characterDailySnapshots,
  characters,
  mythicPlusRuns,
  players,
  snapshots,
  type CharacterFaction,
  type CharacterRegion,
  type LatestSnapshotDetails,
  type LatestSnapshotSummary,
  type MythicPlusRecentRunPreview,
  type MythicPlusSummary,
  type NonTradeableSlot,
  type OwnedKeystone,
} from "@wow-dashboard/db";
import { db } from "../db";
import { insertAuditEvent } from "../lib/audit";
import { enqueueSyncCharactersJob } from "../lib/queue";
import { limitBattleNetSync } from "../lib/rateLimit";
import {
  buildMythicPlusSummary,
  buildRecentRuns,
  dedupeMythicPlusRuns,
  type MythicPlusRunDocument,
} from "./mythicPlus";

type CharacterRecord = typeof characters.$inferSelect;
type CharacterDailySnapshotRecord = typeof characterDailySnapshots.$inferSelect;
type MythicPlusRunRecord = typeof mythicPlusRuns.$inferSelect;
type SnapshotRecord = typeof snapshots.$inferSelect;

type SerializedCharacter = {
  _id: string;
  playerId: string;
  name: string;
  realm: string;
  region: CharacterRegion;
  class: string;
  race: string;
  faction: CharacterFaction;
  isBooster: boolean | null;
  nonTradeableSlots: NonTradeableSlot[] | null;
  latestSnapshot: LatestSnapshotSummary | null;
  latestSnapshotDetails: LatestSnapshotDetails | null;
  mythicPlusSummary: MythicPlusSummary | null;
  mythicPlusRecentRunsPreview: MythicPlusRecentRunPreview[] | null;
  mythicPlusRunCount: number | null;
  firstSnapshotAt: number | null;
  snapshotCount: number | null;
};

type SerializedCharacterWithSnapshot = SerializedCharacter & {
  snapshot: LatestSnapshotSummary | null;
};

type SerializedPinnedCharacter = SerializedCharacter & {
  snapshot: {
    itemLevel: number;
  } | null;
};

export type SerializedDashboardCharacter = SerializedCharacter & {
  snapshot: LatestSnapshotSummary | null;
};

export type ScoreboardCharacterEntry = {
  characterId: string;
  playerId: string;
  name: string;
  realm: string;
  region: CharacterRegion;
  class: string;
  race: string;
  faction: CharacterFaction;
  mythicPlusScore: number;
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  playtimeThisLevelSeconds?: number;
  ownedKeystone: OwnedKeystone | null;
  spec: LatestSnapshotSummary["spec"];
  role: LatestSnapshotSummary["role"];
  level: number;
  takenAt: number;
};

export type PlayerScoreboardEntry = {
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
};

export type PlayerCharactersResponse = {
  player: {
    playerId: string;
    battleTag: string;
  };
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
  characters: SerializedCharacterWithSnapshot[];
};

export type CharacterBoosterExportEntry = {
  _id: string;
  playerId: string;
  name: string;
  realm: string;
  region: CharacterRegion;
  class: string;
  faction: CharacterFaction;
  isBooster: boolean;
  nonTradeableSlots: NonTradeableSlot[];
  ownerBattleTag: string | null;
  ownerDiscordUserId: string | null;
  snapshot: {
    spec: LatestSnapshotSummary["spec"];
    role: LatestSnapshotSummary["role"];
    mythicPlusScore: number;
    itemLevel: number;
    takenAt: number;
    ownedKeystone: OwnedKeystone | null;
  } | null;
};

type SnapshotTimeFrame = "7d" | "30d" | "90d" | "all";
type CharacterDetailMetric = "stats" | "currencies";

function toUnixSeconds(value: Date | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }

  return value;
}

function normalizeOwnedKeystone(
  ownedKeystone: OwnedKeystone | null | undefined,
): OwnedKeystone | undefined {
  if (!ownedKeystone) {
    return undefined;
  }

  return {
    level: ownedKeystone.level,
    ...(ownedKeystone.mapChallengeModeID !== undefined &&
    ownedKeystone.mapChallengeModeID !== null
      ? { mapChallengeModeID: ownedKeystone.mapChallengeModeID }
      : {}),
    ...(ownedKeystone.mapName !== undefined && ownedKeystone.mapName !== null
      ? { mapName: ownedKeystone.mapName }
      : {}),
  };
}

function getRoleSortRank(role: LatestSnapshotSummary["role"] | null | undefined) {
  if (role === "tank") return 0;
  if (role === "dps") return 1;
  return 2;
}

function normalizeNonTradeableSlots(
  nonTradeableSlots: readonly NonTradeableSlot[],
): NonTradeableSlot[] {
  return Array.from(new Set(nonTradeableSlots));
}

function serializeSnapshotSummary(
  snapshot: LatestSnapshotSummary | LatestSnapshotDetails,
): LatestSnapshotSummary {
  const playtimeThisLevelSeconds =
    snapshot.playtimeThisLevelSeconds ?? undefined;
  const ownedKeystone = normalizeOwnedKeystone(snapshot.ownedKeystone);

  return {
    takenAt: toUnixSeconds(snapshot.takenAt)!,
    level: snapshot.level,
    spec: snapshot.spec,
    role: snapshot.role,
    itemLevel: snapshot.itemLevel,
    gold: snapshot.gold,
    playtimeSeconds: snapshot.playtimeSeconds,
    ...(playtimeThisLevelSeconds !== undefined ? { playtimeThisLevelSeconds } : {}),
    mythicPlusScore: snapshot.mythicPlusScore,
    ...(ownedKeystone ? { ownedKeystone } : {}),
  };
}

function serializeSnapshotDetails(snapshot: LatestSnapshotDetails): LatestSnapshotDetails {
  const summary = serializeSnapshotSummary(snapshot);

  return {
    ...summary,
    currencies: snapshot.currencies,
    stats: snapshot.stats,
  };
}

function serializeSnapshotRow(snapshot: SnapshotRecord): LatestSnapshotSummary {
  const ownedKeystone = normalizeOwnedKeystone(snapshot.ownedKeystone);

  return {
    takenAt: toUnixSeconds(snapshot.takenAt)!,
    level: snapshot.level,
    spec: snapshot.spec,
    role: snapshot.role,
    itemLevel: snapshot.itemLevel,
    gold: snapshot.gold,
    playtimeSeconds: snapshot.playtimeSeconds,
    ...(snapshot.playtimeThisLevelSeconds !== null
      ? { playtimeThisLevelSeconds: snapshot.playtimeThisLevelSeconds }
      : {}),
    mythicPlusScore: snapshot.mythicPlusScore,
    ...(ownedKeystone ? { ownedKeystone } : {}),
  };
}

function serializeSnapshotDetailsRow(snapshot: SnapshotRecord): LatestSnapshotDetails {
  return {
    ...serializeSnapshotRow(snapshot),
    currencies: snapshot.currencies,
    stats: snapshot.stats,
  };
}

function serializeMythicPlusRunRow(run: MythicPlusRunRecord): MythicPlusRunDocument {
  return {
    _id: run.id,
    fingerprint: run.fingerprint,
    ...(run.attemptId ? { attemptId: run.attemptId } : {}),
    ...(run.canonicalKey ? { canonicalKey: run.canonicalKey } : {}),
    observedAt: toUnixSeconds(run.observedAt) ?? 0,
    ...(run.seasonId !== null ? { seasonID: run.seasonId } : {}),
    ...(run.mapChallengeModeId !== null ? { mapChallengeModeID: run.mapChallengeModeId } : {}),
    ...(run.mapName ? { mapName: run.mapName } : {}),
    ...(run.level !== null ? { level: run.level } : {}),
    ...(run.status ? { status: run.status } : {}),
    ...(run.completed !== null ? { completed: run.completed } : {}),
    ...(run.completedInTime !== null ? { completedInTime: run.completedInTime } : {}),
    ...(run.durationMs !== null ? { durationMs: run.durationMs } : {}),
    ...(run.runScore !== null ? { runScore: run.runScore } : {}),
    ...(run.startDate ? { startDate: toUnixSeconds(run.startDate)! } : {}),
    ...(run.completedAt ? { completedAt: toUnixSeconds(run.completedAt)! } : {}),
    ...(run.endedAt ? { endedAt: toUnixSeconds(run.endedAt)! } : {}),
    ...(run.abandonedAt ? { abandonedAt: toUnixSeconds(run.abandonedAt)! } : {}),
    ...(run.abandonReason ? { abandonReason: run.abandonReason } : {}),
    ...(run.thisWeek !== null ? { thisWeek: run.thisWeek } : {}),
    ...(run.members ? { members: run.members } : {}),
  };
}

function getSnapshotCompletenessScore(snapshot: SnapshotRecord) {
  let score = 0;

  if (snapshot.playtimeSeconds > 0) score += 1;
  if (snapshot.playtimeThisLevelSeconds !== null) score += 1;
  if (snapshot.ownedKeystone) score += 1;
  if (snapshot.stats.speedPercent !== undefined) score += 2;
  if (snapshot.stats.leechPercent !== undefined) score += 2;
  if (snapshot.stats.avoidancePercent !== undefined) score += 2;

  return score;
}

function shouldReplaceSnapshot(currentSnapshot: SnapshotRecord | undefined, candidateSnapshot: SnapshotRecord) {
  if (!currentSnapshot) return true;

  const currentScore = getSnapshotCompletenessScore(currentSnapshot);
  const candidateScore = getSnapshotCompletenessScore(candidateSnapshot);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  return candidateSnapshot.takenAt.getTime() > currentSnapshot.takenAt.getTime();
}

function getSnapshotTimeFrameCutoffSeconds(timeFrame: SnapshotTimeFrame) {
  if (timeFrame === "all") return null;

  const daysByTimeFrame: Record<Exclude<SnapshotTimeFrame, "all">, number> = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
  };

  return Math.floor(Date.now() / 1000) - daysByTimeFrame[timeFrame] * 86400;
}

function getSnapshotBucketTargetPointCount(timeFrame: SnapshotTimeFrame) {
  if (timeFrame === "7d") return 7;
  if (timeFrame === "30d") return 30;
  if (timeFrame === "90d") return 45;
  return 60;
}

const snapshotBucketSpanOptionsSeconds = [
  60 * 60,
  2 * 60 * 60,
  4 * 60 * 60,
  6 * 60 * 60,
  12 * 60 * 60,
  24 * 60 * 60,
  2 * 24 * 60 * 60,
  3 * 24 * 60 * 60,
  7 * 24 * 60 * 60,
  14 * 24 * 60 * 60,
  30 * 24 * 60 * 60,
] as const;

function getSnapshotBucketSpanSeconds(
  timeFrame: SnapshotTimeFrame,
  rangeStartAt: number,
  rangeEndAt: number,
) {
  const rangeSeconds = Math.max(0, rangeEndAt - rangeStartAt);
  if (rangeSeconds <= 0) {
    return snapshotBucketSpanOptionsSeconds[0];
  }

  const targetPointCount = Math.max(getSnapshotBucketTargetPointCount(timeFrame) - 1, 1);
  const rawBucketSpanSeconds = Math.max(
    snapshotBucketSpanOptionsSeconds[0],
    Math.ceil(rangeSeconds / targetPointCount),
  );

  return (
    snapshotBucketSpanOptionsSeconds.find((value) => value >= rawBucketSpanSeconds) ??
    Math.ceil(rawBucketSpanSeconds / 86400) * 86400
  );
}

function projectCharacterHeaderCharacter(character: CharacterRecord) {
  return {
    _id: character.id,
    name: character.name,
    realm: character.realm,
    region: character.region,
    class: character.class,
    race: character.race,
    faction: character.faction,
    isBooster: character.isBooster ?? null,
    nonTradeableSlots: character.nonTradeableSlots ?? null,
  };
}

function projectCoreTimelineSnapshot(snapshot: SnapshotRecord | CharacterDailySnapshotRecord) {
  return {
    takenAt: toUnixSeconds("lastTakenAt" in snapshot ? snapshot.lastTakenAt : snapshot.takenAt)!,
    itemLevel: snapshot.itemLevel,
    gold: snapshot.gold,
    playtimeSeconds: snapshot.playtimeSeconds,
    mythicPlusScore: snapshot.mythicPlusScore,
    currencies: snapshot.currencies ?? {
      adventurerDawncrest: 0,
      veteranDawncrest: 0,
      championDawncrest: 0,
      heroDawncrest: 0,
      mythDawncrest: 0,
      radiantSparkDust: 0,
    },
  };
}

function projectStatsTimelineSnapshot(snapshot: SnapshotRecord | CharacterDailySnapshotRecord) {
  return {
    takenAt: toUnixSeconds("lastTakenAt" in snapshot ? snapshot.lastTakenAt : snapshot.takenAt)!,
    stats: snapshot.stats ?? {
      stamina: 0,
      strength: 0,
      agility: 0,
      intellect: 0,
      critPercent: 0,
      hastePercent: 0,
      masteryPercent: 0,
      versatilityPercent: 0,
    },
  };
}

function serializeCharacter(character: CharacterRecord): SerializedCharacter {
  return {
    _id: character.id,
    playerId: character.playerId,
    name: character.name,
    realm: character.realm,
    region: character.region,
    class: character.class,
    race: character.race,
    faction: character.faction,
    isBooster: character.isBooster ?? null,
    nonTradeableSlots: character.nonTradeableSlots ?? null,
    latestSnapshot: character.latestSnapshot
      ? serializeSnapshotSummary(character.latestSnapshot)
      : null,
    latestSnapshotDetails: character.latestSnapshotDetails
      ? serializeSnapshotDetails(character.latestSnapshotDetails)
      : null,
    mythicPlusSummary: character.mythicPlusSummary ?? null,
    mythicPlusRecentRunsPreview: character.mythicPlusRecentRunsPreview ?? null,
    mythicPlusRunCount: character.mythicPlusRunCount ?? null,
    firstSnapshotAt: toUnixSeconds(character.firstSnapshotAt),
    snapshotCount: character.snapshotCount ?? null,
  };
}

async function readLatestSnapshotSummaryForCharacter(
  character: CharacterRecord,
): Promise<LatestSnapshotSummary | null> {
  if (character.latestSnapshot) {
    return serializeSnapshotSummary(character.latestSnapshot);
  }

  if (character.latestSnapshotDetails) {
    return serializeSnapshotSummary(character.latestSnapshotDetails);
  }

  const [snapshot] = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.characterId, character.id))
    .orderBy(desc(snapshots.takenAt))
    .limit(1);

  return snapshot ? serializeSnapshotRow(snapshot) : null;
}

async function readCharactersForIds(characterIds: string[]): Promise<CharacterRecord[]> {
  if (characterIds.length === 0) {
    return [];
  }

  return await db
    .select()
    .from(characters)
    .where(inArray(characters.id, characterIds));
}

async function readCharactersForPlayerId(playerId: string): Promise<CharacterRecord[]> {
  return await db
    .select()
    .from(characters)
    .where(eq(characters.playerId, playerId));
}

async function readAllCharacters(): Promise<CharacterRecord[]> {
  return await db.select().from(characters);
}

async function attachLatestSnapshots(
  characterRows: CharacterRecord[],
): Promise<SerializedDashboardCharacter[]> {
  return await Promise.all(
    characterRows.map(async (character) => ({
      ...serializeCharacter(character),
      snapshot: await readLatestSnapshotSummaryForCharacter(character),
    })),
  );
}

async function readPlayerIdForUser(userId: string): Promise<string | null> {
  const player = await db.query.players.findFirst({
    where: eq(players.userId, userId),
  });

  return player?.id ?? null;
}

async function readBattleNetAccountForUser(userId: string) {
  return await db.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, "battlenet")),
  });
}

async function readCharacterById(characterId: string) {
  return await db.query.characters.findFirst({
    where: eq(characters.id, characterId),
  });
}

async function readOwnedCharacterId(characterId: string, userId: string): Promise<string | null> {
  const [ownedCharacter] = await db
    .select({
      id: characters.id,
    })
    .from(characters)
    .innerJoin(players, eq(players.id, characters.playerId))
    .where(and(eq(characters.id, characterId), eq(players.userId, userId)))
    .limit(1);

  return ownedCharacter?.id ?? null;
}

async function readCharacterOwner(character: CharacterRecord) {
  return await db.query.players.findFirst({
    where: eq(players.id, character.playerId),
  });
}

async function readFirstSnapshotAtForCharacter(character: CharacterRecord) {
  if (character.firstSnapshotAt) {
    return toUnixSeconds(character.firstSnapshotAt);
  }

  const [firstSnapshot] = await db
    .select({ takenAt: snapshots.takenAt })
    .from(snapshots)
    .where(eq(snapshots.characterId, character.id))
    .orderBy(asc(snapshots.takenAt))
    .limit(1);

  return firstSnapshot ? toUnixSeconds(firstSnapshot.takenAt) : null;
}

async function readLatestSnapshotDetailsForCharacter(
  character: CharacterRecord,
): Promise<LatestSnapshotDetails | null> {
  if (character.latestSnapshotDetails) {
    return serializeSnapshotDetails(character.latestSnapshotDetails);
  }

  const [snapshot] = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.characterId, character.id))
    .orderBy(desc(snapshots.takenAt))
    .limit(1);

  return snapshot ? serializeSnapshotDetailsRow(snapshot) : null;
}

function getSnapshotBucketDaySpan(bucketSpanSeconds: number) {
  return Math.max(1, Math.ceil(bucketSpanSeconds / 86400));
}

function hasCharacterDailySnapshotCurrencies(
  snapshot: CharacterDailySnapshotRecord,
): snapshot is CharacterDailySnapshotRecord & {
  currencies: NonNullable<CharacterDailySnapshotRecord["currencies"]>;
} {
  return snapshot.currencies !== null && snapshot.currencies !== undefined;
}

function hasCharacterDailySnapshotStats(
  snapshot: CharacterDailySnapshotRecord,
): snapshot is CharacterDailySnapshotRecord & {
  stats: NonNullable<CharacterDailySnapshotRecord["stats"]>;
} {
  return snapshot.stats !== null && snapshot.stats !== undefined;
}

function bucketDailySnapshotsBySpan(snapshotsByDay: CharacterDailySnapshotRecord[], daySpan: number) {
  if (daySpan <= 1) {
    return snapshotsByDay;
  }

  const bucketed = new Map<number, CharacterDailySnapshotRecord>();
  for (const snapshot of snapshotsByDay) {
    const dayStartAt = toUnixSeconds(snapshot.dayStartAt)!;
    const bucketKey = Math.floor(dayStartAt / (daySpan * 86400));
    const current = bucketed.get(bucketKey);
    if (!current || snapshot.lastTakenAt.getTime() >= current.lastTakenAt.getTime()) {
      bucketed.set(bucketKey, snapshot);
    }
  }

  return Array.from(bucketed.values()).sort(
    (left, right) => left.dayStartAt.getTime() - right.dayStartAt.getTime(),
  );
}

function shouldReplaceBucketSnapshot(currentSnapshot: SnapshotRecord | undefined, candidateSnapshot: SnapshotRecord) {
  if (!currentSnapshot) return true;
  if (candidateSnapshot.takenAt.getTime() !== currentSnapshot.takenAt.getTime()) {
    return candidateSnapshot.takenAt.getTime() > currentSnapshot.takenAt.getTime();
  }

  return shouldReplaceSnapshot(currentSnapshot, candidateSnapshot);
}

async function readBucketedRawSnapshotsForCharacter(
  character: CharacterRecord,
  timeFrame: SnapshotTimeFrame,
) {
  const cutoffSeconds = getSnapshotTimeFrameCutoffSeconds(timeFrame);
  const whereClause =
    cutoffSeconds === null
      ? eq(snapshots.characterId, character.id)
      : and(
          eq(snapshots.characterId, character.id),
          gte(snapshots.takenAt, new Date(cutoffSeconds * 1000)),
        );

  const rawSnapshots = await db
    .select()
    .from(snapshots)
    .where(whereClause)
    .orderBy(asc(snapshots.takenAt));

  if (rawSnapshots.length === 0) {
    return [];
  }

  const rangeStartAt = cutoffSeconds ?? toUnixSeconds(rawSnapshots[0]!.takenAt)!;
  const rangeEndAt = toUnixSeconds(rawSnapshots[rawSnapshots.length - 1]!.takenAt)!;
  const bucketSpanSeconds = getSnapshotBucketSpanSeconds(timeFrame, rangeStartAt, rangeEndAt);
  const bucketed = new Map<number, SnapshotRecord>();

  for (const snapshot of rawSnapshots) {
    const bucketStartAt =
      Math.floor((toUnixSeconds(snapshot.takenAt) ?? 0) / bucketSpanSeconds) * bucketSpanSeconds;
    const current = bucketed.get(bucketStartAt);
    if (shouldReplaceBucketSnapshot(current, snapshot)) {
      bucketed.set(bucketStartAt, snapshot);
    }
  }

  return Array.from(bucketed.values()).sort(
    (left, right) => left.takenAt.getTime() - right.takenAt.getTime(),
  );
}

async function readTimelinePayloadForCharacter(
  character: CharacterRecord,
  timeFrame: SnapshotTimeFrame,
  includeStats: boolean,
) {
  const cutoffSeconds = getSnapshotTimeFrameCutoffSeconds(timeFrame);
  const dailyWhereClause =
    cutoffSeconds === null
      ? eq(characterDailySnapshots.characterId, character.id)
      : and(
          eq(characterDailySnapshots.characterId, character.id),
          gte(
            characterDailySnapshots.dayStartAt,
            new Date(Math.floor(cutoffSeconds / 86400) * 86400 * 1000),
          ),
        );

  const dailySnapshots = await db
    .select()
    .from(characterDailySnapshots)
    .where(dailyWhereClause)
    .orderBy(asc(characterDailySnapshots.dayStartAt));

  if (dailySnapshots.length > 0) {
    const rangeStartAt = cutoffSeconds ?? toUnixSeconds(dailySnapshots[0]!.dayStartAt)!;
    const rangeEndAt = toUnixSeconds(dailySnapshots[dailySnapshots.length - 1]!.lastTakenAt)!;
    const bucketSpanSeconds = getSnapshotBucketSpanSeconds(timeFrame, rangeStartAt, rangeEndAt);
    const canUseDailyCore =
      bucketSpanSeconds >= 86400 && dailySnapshots.every(hasCharacterDailySnapshotCurrencies);
    const canUseDailyStats =
      includeStats &&
      bucketSpanSeconds >= 86400 &&
      dailySnapshots.every(hasCharacterDailySnapshotStats);

    if (canUseDailyCore && (!includeStats || canUseDailyStats)) {
      const bucketDaySpan = getSnapshotBucketDaySpan(bucketSpanSeconds);
      const bucketedDailySnapshots = bucketDailySnapshotsBySpan(dailySnapshots, bucketDaySpan);

      return {
        coreSnapshots: bucketedDailySnapshots.map((snapshot) => projectCoreTimelineSnapshot(snapshot)),
        statsSnapshots: includeStats
          ? bucketedDailySnapshots.map((snapshot) => projectStatsTimelineSnapshot(snapshot))
          : null,
      };
    }
  }

  const bucketedRawSnapshots = await readBucketedRawSnapshotsForCharacter(character, timeFrame);
  return {
    coreSnapshots: bucketedRawSnapshots.map((snapshot) => projectCoreTimelineSnapshot(snapshot)),
    statsSnapshots: includeStats
      ? bucketedRawSnapshots.map((snapshot) => projectStatsTimelineSnapshot(snapshot))
      : null,
  };
}

function buildCharacterMythicPlusData(
  summary: MythicPlusSummary,
  runs: MythicPlusRecentRunPreview[],
  totalRunCount: number,
  includeAllRuns: boolean,
): CharacterMythicPlusResponse {
  const visibleRuns = includeAllRuns ? runs : runs.slice(0, 20);

  return {
    summary,
    runs: visibleRuns,
    totalRunCount,
    isPreview: totalRunCount > visibleRuns.length,
  };
}

function getStoredCharacterMythicPlusData(
  character: CharacterRecord,
  includeAllRuns: boolean,
): CharacterMythicPlusResponse | null {
  const summary = character.mythicPlusSummary ?? null;
  const runs = character.mythicPlusRecentRunsPreview ?? null;
  const totalRunCount = character.mythicPlusRunCount ?? null;
  if (!summary || !runs || totalRunCount === null) {
    return null;
  }

  if (includeAllRuns && totalRunCount > runs.length) {
    return null;
  }

  return buildCharacterMythicPlusData(summary, runs, totalRunCount, includeAllRuns);
}

async function readCharacterMythicPlusData(
  character: CharacterRecord,
  includeAllRuns: boolean,
  currentScoreOverride?: number | null,
): Promise<CharacterMythicPlusResponse> {
  const storedData = getStoredCharacterMythicPlusData(character, includeAllRuns);
  if (storedData) {
    return storedData;
  }

  const currentScore =
    currentScoreOverride ??
    character.latestSnapshot?.mythicPlusScore ??
    character.latestSnapshotDetails?.mythicPlusScore ??
    (await readLatestSnapshotSummaryForCharacter(character))?.mythicPlusScore ??
    null;

  const runRows = await db
    .select()
    .from(mythicPlusRuns)
    .where(eq(mythicPlusRuns.characterId, character.id))
    .orderBy(desc(mythicPlusRuns.observedAt));

  const dedupedRuns = dedupeMythicPlusRuns(runRows.map((run) => serializeMythicPlusRunRow(run)));
  const projectedRuns = buildRecentRuns(dedupedRuns);

  return buildCharacterMythicPlusData(
    buildMythicPlusSummary(dedupedRuns, currentScore),
    projectedRuns,
    projectedRuns.length,
    includeAllRuns,
  );
}

export async function readCharacterPage(
  characterId: string,
  timeFrame: SnapshotTimeFrame,
  includeStats: boolean,
): Promise<CharacterPageResponse | null> {
  const character = await readCharacterById(characterId);
  if (!character) {
    return null;
  }

  const [owner, latestSnapshot, firstSnapshotAt, timelinePayload] = await Promise.all([
    readCharacterOwner(character),
    readLatestSnapshotDetailsForCharacter(character),
    readFirstSnapshotAtForCharacter(character),
    readTimelinePayloadForCharacter(character, timeFrame, includeStats),
  ]);

  return {
    header: {
      character: projectCharacterHeaderCharacter(character),
      owner: owner
        ? {
            playerId: owner.id,
            battleTag: owner.battleTag,
            discordUserId: owner.discordUserId ?? null,
          }
        : null,
      latestSnapshot,
      firstSnapshotAt,
      snapshotCount: character.snapshotCount ?? null,
    },
    coreTimeline: {
      snapshots: timelinePayload.coreSnapshots,
    },
    statsTimeline: includeStats
      ? {
          metric: "stats",
          snapshots: timelinePayload.statsSnapshots ?? [],
        }
      : null,
    mythicPlus: await readCharacterMythicPlusData(
      character,
      false,
      latestSnapshot?.mythicPlusScore ?? null,
    ),
  };
}

export async function readCharacterDetailTimeline(
  characterId: string,
  timeFrame: SnapshotTimeFrame,
  metric: CharacterDetailMetric,
): Promise<CharacterDetailTimelineResponse | null> {
  const character = await readCharacterById(characterId);
  if (!character) {
    return null;
  }

  const timelinePayload = await readTimelinePayloadForCharacter(character, timeFrame, metric === "stats");
  if (metric === "stats") {
    return {
      metric,
      snapshots: timelinePayload.statsSnapshots ?? [],
    };
  }

  return {
    metric,
    snapshots: timelinePayload.coreSnapshots.map((snapshot) => ({
      takenAt: snapshot.takenAt,
      currencies: snapshot.currencies,
    })),
  };
}

export async function readCharacterSnapshotTimeline(
  characterId: string,
  timeFrame: SnapshotTimeFrame,
): Promise<CharacterSnapshotTimelineResponse | null> {
  const character = await readCharacterById(characterId);
  if (!character) {
    return null;
  }

  const bucketedSnapshots = await readBucketedRawSnapshotsForCharacter(character, timeFrame);
  return {
    snapshots: bucketedSnapshots.map((snapshot) => ({
      takenAt: toUnixSeconds(snapshot.takenAt)!,
      itemLevel: snapshot.itemLevel,
      mythicPlusScore: snapshot.mythicPlusScore,
      playtimeSeconds: snapshot.playtimeSeconds,
      ...(normalizeOwnedKeystone(snapshot.ownedKeystone)
        ? { ownedKeystone: normalizeOwnedKeystone(snapshot.ownedKeystone) }
        : {}),
    })),
  };
}

export async function readCharacterMythicPlus(
  characterId: string,
  includeAllRuns: boolean,
): Promise<CharacterMythicPlusResponse | null> {
  const character = await readCharacterById(characterId);
  if (!character) {
    return null;
  }

  return await readCharacterMythicPlusData(character, includeAllRuns);
}

export async function readCharactersWithLatestSnapshot(
  characterIds: string[],
): Promise<SerializedPinnedCharacter[]> {
  const uniqueCharacterIds = [...new Set(characterIds)];
  if (uniqueCharacterIds.length === 0) {
    return [];
  }

  const rows = await readCharactersForIds(uniqueCharacterIds);
  const rowsById = new Map(rows.map((character) => [character.id, character]));

  return await Promise.all(
    uniqueCharacterIds.flatMap((characterId) => {
      const character = rowsById.get(characterId);
      if (!character) {
        return [];
      }

      return [
        (async () => {
          const snapshot = await readLatestSnapshotSummaryForCharacter(character);
          return {
            ...serializeCharacter(character),
            snapshot: snapshot
              ? {
                  itemLevel: snapshot.itemLevel,
                }
              : null,
          };
        })(),
      ];
    }),
  );
}

export async function readPlayerCharacters(
  playerId: string,
): Promise<PlayerCharactersResponse | null> {
  const player = await db.query.players.findFirst({
    where: eq(players.id, playerId),
  });

  if (!player) {
    return null;
  }

  const charactersWithSnapshots = await attachLatestSnapshots(
    await readCharactersForPlayerId(playerId),
  );

  const snappedCharacters = charactersWithSnapshots.filter(
    (
      character,
    ): character is SerializedCharacterWithSnapshot & { snapshot: LatestSnapshotSummary } =>
      character.snapshot !== null,
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
    totalItemLevel += snapshot.itemLevel;

    if (highestMythicPlusScore === null || snapshot.mythicPlusScore > highestMythicPlusScore) {
      highestMythicPlusScore = snapshot.mythicPlusScore;
      highestMythicPlusCharacterName = character.name;
    }

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

  const sortedCharacters = [...charactersWithSnapshots].sort((left, right) => {
    const leftSnapshot = left.snapshot;
    const rightSnapshot = right.snapshot;

    if (!leftSnapshot && !rightSnapshot) {
      return left.name.localeCompare(right.name);
    }

    if (!leftSnapshot) return 1;
    if (!rightSnapshot) return -1;

    return (
      rightSnapshot.mythicPlusScore - leftSnapshot.mythicPlusScore ||
      rightSnapshot.itemLevel - leftSnapshot.itemLevel ||
      (rightSnapshot.ownedKeystone?.level ?? -1) - (leftSnapshot.ownedKeystone?.level ?? -1) ||
      left.name.localeCompare(right.name)
    );
  });

  return {
    player: {
      playerId: player.id,
      battleTag: player.battleTag,
    },
    summary: {
      trackedCharacters: charactersWithSnapshots.length,
      scannedCharacters: snappedCharacters.length,
      totalPlaytimeSeconds,
      totalGold,
      highestMythicPlusScore,
      highestMythicPlusCharacterName,
      averageItemLevel:
        snappedCharacters.length > 0 ? totalItemLevel / snappedCharacters.length : null,
      bestKeystone,
      latestSnapshotAt,
    },
    characters: sortedCharacters,
  };
}

export async function readMyCharactersWithSnapshot(
  userId: string,
): Promise<SerializedDashboardCharacter[] | null> {
  const playerId = await readPlayerIdForUser(userId);
  if (!playerId) {
    return null;
  }

  return await attachLatestSnapshots(await readCharactersForPlayerId(playerId));
}

export async function readScoreboardCharacters(): Promise<ScoreboardCharacterEntry[]> {
  const charactersWithSnapshots = await attachLatestSnapshots(await readAllCharacters());

  return charactersWithSnapshots
    .flatMap((character) => {
      const snapshot = character.snapshot;
      if (!snapshot) {
        return [];
      }

      return [
        {
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
          ...(snapshot.playtimeThisLevelSeconds !== undefined
            ? {
                playtimeThisLevelSeconds: snapshot.playtimeThisLevelSeconds,
              }
            : {}),
          ownedKeystone: snapshot.ownedKeystone ?? null,
          spec: snapshot.spec,
          role: snapshot.role,
          level: snapshot.level,
          takenAt: snapshot.takenAt,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.mythicPlusScore - left.mythicPlusScore ||
        right.itemLevel - left.itemLevel,
    );
}

export async function readPlayerScoreboard(): Promise<PlayerScoreboardEntry[]> {
  const charactersWithSnapshots = await attachLatestSnapshots(await readAllCharacters());
  const snappedCharacters = charactersWithSnapshots.filter(
    (
      character,
    ): character is SerializedDashboardCharacter & { snapshot: LatestSnapshotSummary } =>
      character.snapshot !== null,
  );

  const playerIds = [...new Set(snappedCharacters.map((character) => character.playerId))];
  if (playerIds.length === 0) {
    return [];
  }

  const playerRows = await db
    .select()
    .from(players)
    .where(inArray(players.id, playerIds));
  const playerBattleTagMap = new Map(
    playerRows.map((player) => [player.id, player.battleTag]),
  );

  const playerMap = new Map<string, Omit<PlayerScoreboardEntry, "averageItemLevel"> & {
    totalItemLevel: number;
  }>();

  for (const character of snappedCharacters) {
    const snapshot = character.snapshot;
    const existing = playerMap.get(character.playerId);

    if (existing) {
      existing.totalPlaytimeSeconds += snapshot.playtimeSeconds;
      existing.totalGold += snapshot.gold;
      existing.totalItemLevel += snapshot.itemLevel;
      existing.characterCount += 1;

      if (snapshot.mythicPlusScore > existing.highestMythicPlusScore) {
        existing.highestMythicPlusScore = snapshot.mythicPlusScore;
        existing.highestMythicPlusCharacterName = character.name;
      }

      if (
        snapshot.ownedKeystone &&
        (existing.bestKeystoneLevel === null ||
          snapshot.ownedKeystone.level > existing.bestKeystoneLevel)
      ) {
        existing.bestKeystoneLevel = snapshot.ownedKeystone.level;
        existing.bestKeystoneMapChallengeModeID =
          snapshot.ownedKeystone.mapChallengeModeID ?? null;
        existing.bestKeystoneMapName = snapshot.ownedKeystone.mapName ?? null;
      }

      if (existing.latestSnapshotAt === null || snapshot.takenAt > existing.latestSnapshotAt) {
        existing.latestSnapshotAt = snapshot.takenAt;
      }

      continue;
    }

    playerMap.set(character.playerId, {
      playerId: character.playerId,
      battleTag: playerBattleTagMap.get(character.playerId) ?? "",
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

  return Array.from(playerMap.values())
    .map((player) => ({
      playerId: player.playerId,
      battleTag: player.battleTag,
      totalPlaytimeSeconds: player.totalPlaytimeSeconds,
      totalGold: player.totalGold,
      highestMythicPlusScore: player.highestMythicPlusScore,
      highestMythicPlusCharacterName: player.highestMythicPlusCharacterName,
      averageItemLevel:
        player.characterCount > 0 ? player.totalItemLevel / player.characterCount : 0,
      characterCount: player.characterCount,
      bestKeystoneLevel: player.bestKeystoneLevel,
      bestKeystoneMapChallengeModeID: player.bestKeystoneMapChallengeModeID,
      bestKeystoneMapName: player.bestKeystoneMapName,
      latestSnapshotAt: player.latestSnapshotAt,
    }))
    .sort(
      (left, right) =>
        right.highestMythicPlusScore - left.highestMythicPlusScore ||
        right.totalPlaytimeSeconds - left.totalPlaytimeSeconds ||
        right.totalGold - left.totalGold,
    );
}

export async function requestCharacterResync(
  userId: string,
): Promise<{ ok: boolean; nextAllowedAt: number | null }> {
  const rateLimit = await limitBattleNetSync(userId);
  if (!rateLimit.ok) {
    await insertAuditEvent("battlenet.resync.rate_limited", {
      userId,
      metadata: {
        retryAfterMs: rateLimit.retryAfterMs,
      },
    });

    return {
      ok: false,
      nextAllowedAt: Date.now() + rateLimit.retryAfterMs,
    };
  }

  const battleNetAccount = await readBattleNetAccountForUser(userId);
  if (!battleNetAccount?.accessToken) {
    return {
      ok: false,
      nextAllowedAt: null,
    };
  }

  await enqueueSyncCharactersJob({
    userId,
    accessToken: battleNetAccount.accessToken,
  });

  await insertAuditEvent("battlenet.resync", {
    userId,
  });

  return {
    ok: true,
    nextAllowedAt: null,
  };
}

export async function updateCharacterBoosterStatus(
  characterId: string,
  userId: string,
  isBooster: boolean,
): Promise<{ characterId: string; isBooster: boolean } | null> {
  const ownedCharacterId = await readOwnedCharacterId(characterId, userId);
  if (!ownedCharacterId) {
    return null;
  }

  await db
    .update(characters)
    .set({
      isBooster,
    })
    .where(eq(characters.id, ownedCharacterId));

  return {
    characterId: ownedCharacterId,
    isBooster,
  };
}

export async function updateCharacterNonTradeableSlots(
  characterId: string,
  userId: string,
  nonTradeableSlots: readonly NonTradeableSlot[],
): Promise<{ characterId: string; nonTradeableSlots: NonTradeableSlot[] } | null> {
  const ownedCharacterId = await readOwnedCharacterId(characterId, userId);
  if (!ownedCharacterId) {
    return null;
  }

  const normalizedSlots = normalizeNonTradeableSlots(nonTradeableSlots);

  await db
    .update(characters)
    .set({
      nonTradeableSlots: normalizedSlots.length > 0 ? normalizedSlots : null,
    })
    .where(eq(characters.id, ownedCharacterId));

  return {
    characterId: ownedCharacterId,
    nonTradeableSlots: normalizedSlots,
  };
}

export async function readBoosterCharactersForExport(): Promise<CharacterBoosterExportEntry[]> {
  const boosterCharacters = await db.query.characters.findMany({
    where: eq(characters.isBooster, true),
  });

  const charactersWithSnapshots = await attachLatestSnapshots(boosterCharacters);
  const playerIds = [...new Set(boosterCharacters.map((character) => character.playerId))];
  const playerRows = playerIds.length
    ? await db.select().from(players).where(inArray(players.id, playerIds))
    : [];
  const ownerById = new Map(playerRows.map((player) => [player.id, player]));

  return charactersWithSnapshots
    .map((character) => {
      const owner = ownerById.get(character.playerId);
      const snapshot = character.snapshot;

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
    .sort((left, right) => {
      if (left.snapshot && !right.snapshot) return -1;
      if (!left.snapshot && right.snapshot) return 1;

      const roleDiff = getRoleSortRank(left.snapshot?.role) - getRoleSortRank(right.snapshot?.role);
      if (roleDiff !== 0) return roleDiff;

      const scoreDiff =
        (right.snapshot?.mythicPlusScore ?? -1) - (left.snapshot?.mythicPlusScore ?? -1);
      if (scoreDiff !== 0) return scoreDiff;

      return left.name.localeCompare(right.name);
    });
}
