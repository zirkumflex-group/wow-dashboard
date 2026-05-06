import { and, asc, desc, eq, gte, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import type {
  CharacterDetailTimelineResponse,
  CharacterMythicPlusResponse,
  CharacterPageResponse,
  CharacterSnapshotTimelineResponse,
} from "@wow-dashboard/api-schema";
import {
  isCharacterUuid,
  mythicPlusPreviewRunLimit,
  normalizeCharacterRouteLookupPart,
  parseCharacterRouteSlug,
} from "@wow-dashboard/api-schema";
import {
  characterDailySnapshots,
  characters,
  mythicPlusRunSessionRuns,
  mythicPlusRunSessions,
  mythicPlusRuns,
  players,
  snapshots,
  type CharacterFaction,
  type CharacterRegion,
  type CharacterVisibility,
  type LatestSnapshotDetails,
  type LatestSnapshotSummary,
  type MythicPlusRecentRunPreview,
  type MythicPlusRunSessionPreview,
  type MythicPlusSummary,
  type NonTradeableSlot,
  type OwnedKeystone,
} from "@wow-dashboard/db";
import { db } from "../db";
import { insertAuditEvent } from "../lib/audit";
import { enqueueSyncCharactersJob } from "../lib/queue";
import { limitBattleNetSync } from "../lib/rateLimit";
import { resolveBattleNetAccessTokenForUser } from "./battleNetTokens";
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
type MythicPlusRunSessionRecord = typeof mythicPlusRunSessions.$inferSelect;

const mythicPlusAllRunsResponseLimit = 250;
const scoreboardResponseLimit = 500;
const directlyReadableVisibilities: CharacterVisibility[] = ["public", "unlisted"];

type SerializedCharacter = {
  _id: string;
  playerId: string;
  name: string;
  realm: string;
  region: CharacterRegion;
  class: string;
  race: string;
  faction: CharacterFaction;
  visibility: CharacterVisibility;
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

type SerializedDashboardCharacter = SerializedCharacter & {
  snapshot: LatestSnapshotSummary | null;
};

type ScoreboardCharacterEntry = {
  characterId: string;
  playerId: string;
  name: string;
  realm: string;
  region: CharacterRegion;
  class: string;
  race: string;
  faction: CharacterFaction;
  visibility: CharacterVisibility;
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

type PlayerScoreboardEntry = {
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

type PlayerCharactersResponse = {
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

type CharacterBoosterExportEntry = {
  _id: string;
  playerId: string;
  name: string;
  realm: string;
  region: CharacterRegion;
  class: string;
  faction: CharacterFaction;
  visibility: CharacterVisibility;
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

type MythicPlusRunSessionSummary = {
  id: string;
  runIds: string[];
  isPaid: boolean;
  externalId: string | null;
  createdAt: number;
  updatedAt: number;
};

type MythicPlusRunSessionMutationResponse = {
  characterId: string;
  sessionId: string;
  runIds: string[];
  isPaid: boolean;
  externalId: string | null;
};

type SnapshotTimeFrame = "7d" | "14d" | "30d" | "90d" | "all" | "tww-s3" | "mn-s1";
type CharacterDetailMetric = "stats" | "currencies";

const midnightSeasonOneStartSeconds = Math.floor(Date.UTC(2026, 2, 18) / 1000);

const snapshotSeasonRanges: Record<
  Extract<SnapshotTimeFrame, "tww-s3" | "mn-s1">,
  { startAt: number | null; endAt: number | null; seasonID: number }
> = {
  "tww-s3": {
    startAt: null,
    endAt: midnightSeasonOneStartSeconds,
    seasonID: 16,
  },
  "mn-s1": {
    startAt: midnightSeasonOneStartSeconds,
    endAt: null,
    seasonID: 17,
  },
};

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
    ...(ownedKeystone.mapChallengeModeID !== undefined && ownedKeystone.mapChallengeModeID !== null
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
  const playtimeThisLevelSeconds = snapshot.playtimeThisLevelSeconds ?? undefined;
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
    ...(snapshot.seasonID !== undefined ? { seasonID: snapshot.seasonID } : {}),
    ...(ownedKeystone ? { ownedKeystone } : {}),
  };
}

function serializeSnapshotDetails(snapshot: LatestSnapshotDetails): LatestSnapshotDetails {
  const summary = serializeSnapshotSummary(snapshot);

  return {
    ...summary,
    currencies: snapshot.currencies,
    ...(snapshot.currencyDetails ? { currencyDetails: snapshot.currencyDetails } : {}),
    stats: snapshot.stats,
    ...(snapshot.equipment ? { equipment: snapshot.equipment } : {}),
    ...(snapshot.weeklyRewards ? { weeklyRewards: snapshot.weeklyRewards } : {}),
    ...(snapshot.majorFactions ? { majorFactions: snapshot.majorFactions } : {}),
    ...(snapshot.clientInfo ? { clientInfo: snapshot.clientInfo } : {}),
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
    ...(snapshot.seasonId !== null ? { seasonID: snapshot.seasonId } : {}),
    ...(ownedKeystone ? { ownedKeystone } : {}),
  };
}

function serializeSnapshotDetailsRow(snapshot: SnapshotRecord): LatestSnapshotDetails {
  return {
    ...serializeSnapshotRow(snapshot),
    currencies: snapshot.currencies,
    ...(snapshot.currencyDetails ? { currencyDetails: snapshot.currencyDetails } : {}),
    stats: snapshot.stats,
    ...(snapshot.equipment ? { equipment: snapshot.equipment } : {}),
    ...(snapshot.weeklyRewards ? { weeklyRewards: snapshot.weeklyRewards } : {}),
    ...(snapshot.majorFactions ? { majorFactions: snapshot.majorFactions } : {}),
    ...(snapshot.clientInfo ? { clientInfo: snapshot.clientInfo } : {}),
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
  if (snapshot.stats.critRating !== undefined) score += 1;
  if (snapshot.stats.hasteRating !== undefined) score += 1;
  if (snapshot.stats.masteryRating !== undefined) score += 1;
  if (snapshot.stats.versatilityRating !== undefined) score += 1;
  if (snapshot.stats.speedRating !== undefined) score += 1;
  if (snapshot.stats.leechRating !== undefined) score += 1;
  if (snapshot.stats.avoidanceRating !== undefined) score += 1;
  if (snapshot.stats.speedPercent !== undefined) score += 2;
  if (snapshot.stats.leechPercent !== undefined) score += 2;
  if (snapshot.stats.avoidancePercent !== undefined) score += 2;

  return score;
}

function shouldReplaceSnapshot(
  currentSnapshot: SnapshotRecord | undefined,
  candidateSnapshot: SnapshotRecord,
) {
  if (!currentSnapshot) return true;

  const currentScore = getSnapshotCompletenessScore(currentSnapshot);
  const candidateScore = getSnapshotCompletenessScore(candidateSnapshot);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  return candidateSnapshot.takenAt.getTime() > currentSnapshot.takenAt.getTime();
}

function isSnapshotSeasonTimeFrame(
  timeFrame: SnapshotTimeFrame,
): timeFrame is keyof typeof snapshotSeasonRanges {
  return timeFrame === "tww-s3" || timeFrame === "mn-s1";
}

function getSnapshotTimeFrameRange(timeFrame: SnapshotTimeFrame): {
  startAt: number | null;
  endAt: number | null;
} {
  if (isSnapshotSeasonTimeFrame(timeFrame)) {
    return snapshotSeasonRanges[timeFrame];
  }

  if (timeFrame === "all") {
    return { startAt: null, endAt: null };
  }

  const daysByTimeFrame: Record<
    Extract<SnapshotTimeFrame, "7d" | "14d" | "30d" | "90d">,
    number
  > = {
    "7d": 7,
    "14d": 14,
    "30d": 30,
    "90d": 90,
  };

  return {
    startAt: Math.floor(Date.now() / 1000) - daysByTimeFrame[timeFrame] * 86400,
    endAt: null,
  };
}

function getSnapshotBucketTargetPointCount(timeFrame: SnapshotTimeFrame) {
  if (timeFrame === "7d") return 30;
  if (timeFrame === "14d") return 48;
  if (timeFrame === "30d") return 72;
  if (timeFrame === "90d") return 120;
  if (isSnapshotSeasonTimeFrame(timeFrame)) return 120;
  return 180;
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
    visibility: character.visibility,
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
    visibility: character.visibility,
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

function buildDirectlyReadableCharacterWhere(viewerUserId: string | null): SQL {
  const publicOrUnlistedWhere = inArray(characters.visibility, directlyReadableVisibilities);
  if (!viewerUserId) {
    return publicOrUnlistedWhere;
  }

  return or(publicOrUnlistedWhere, eq(players.userId, viewerUserId)) ?? publicOrUnlistedWhere;
}

async function readCharactersForIds(
  characterIds: string[],
  viewerUserId: string | null,
): Promise<CharacterRecord[]> {
  if (characterIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      character: characters,
    })
    .from(characters)
    .innerJoin(players, eq(players.id, characters.playerId))
    .where(
      and(inArray(characters.id, characterIds), buildDirectlyReadableCharacterWhere(viewerUserId)),
    );

  return rows.map((row) => row.character);
}

async function readCharactersForPlayerId(
  playerId: string,
  options: { listedOnly?: boolean } = {},
): Promise<CharacterRecord[]> {
  const whereClause = options.listedOnly
    ? and(eq(characters.playerId, playerId), eq(characters.visibility, "public"))
    : eq(characters.playerId, playerId);

  return await db.select().from(characters).where(whereClause);
}

async function readAllListedCharacters(): Promise<CharacterRecord[]> {
  return await db.select().from(characters).where(eq(characters.visibility, "public"));
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

async function readCharacterById(characterId: string, viewerUserId: string | null) {
  return await readCharacterByRouteId(characterId, viewerUserId);
}

function normalizeCharacterRouteNameForDb(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function selectMatchingCharacterRouteSlug(
  routeId: string,
  characterRows: CharacterRecord[],
): CharacterRecord | null {
  const slug = parseCharacterRouteSlug(routeId);
  if (!slug) {
    return null;
  }

  const lookupRealm = normalizeCharacterRouteLookupPart(slug.realm);
  return (
    characterRows.find(
      (character) => normalizeCharacterRouteLookupPart(character.realm) === lookupRealm,
    ) ?? null
  );
}

async function readCharacterByRouteId(
  routeId: string,
  viewerUserId: string | null,
): Promise<CharacterRecord | null> {
  if (isCharacterUuid(routeId)) {
    const [readableCharacter] = await db
      .select({
        character: characters,
      })
      .from(characters)
      .innerJoin(players, eq(players.id, characters.playerId))
      .where(and(eq(characters.id, routeId), buildDirectlyReadableCharacterWhere(viewerUserId)))
      .limit(1);

    return readableCharacter?.character ?? null;
  }

  const slug = parseCharacterRouteSlug(routeId);
  if (!slug) {
    return null;
  }

  const candidateCharacters = await db
    .select()
    .from(characters)
    .innerJoin(players, eq(players.id, characters.playerId))
    .where(
      and(
        eq(characters.normalizedName, normalizeCharacterRouteNameForDb(slug.name)),
        buildDirectlyReadableCharacterWhere(viewerUserId),
      ),
    )
    .orderBy(desc(characters.snapshotCount), desc(characters.firstSnapshotAt))
    .limit(100);

  return selectMatchingCharacterRouteSlug(
    routeId,
    candidateCharacters.map((row) => row.characters),
  );
}

async function readOwnedCharacterByRouteId(
  routeId: string,
  userId: string,
): Promise<CharacterRecord | null> {
  if (isCharacterUuid(routeId)) {
    const [ownedCharacter] = await db
      .select({
        character: characters,
      })
      .from(characters)
      .innerJoin(players, eq(players.id, characters.playerId))
      .where(and(eq(characters.id, routeId), eq(players.userId, userId)))
      .limit(1);

    return ownedCharacter?.character ?? null;
  }

  const slug = parseCharacterRouteSlug(routeId);
  if (!slug) {
    return null;
  }

  const candidateCharacters = await db
    .select({
      character: characters,
    })
    .from(characters)
    .innerJoin(players, eq(players.id, characters.playerId))
    .where(
      and(
        eq(characters.normalizedName, normalizeCharacterRouteNameForDb(slug.name)),
        eq(players.userId, userId),
      ),
    )
    .orderBy(desc(characters.snapshotCount), desc(characters.firstSnapshotAt))
    .limit(100);

  return selectMatchingCharacterRouteSlug(
    routeId,
    candidateCharacters.map((row) => row.character),
  );
}

async function readOwnedCharacterId(characterId: string, userId: string): Promise<string | null> {
  const ownedCharacter = await readOwnedCharacterByRouteId(characterId, userId);
  return ownedCharacter?.id ?? null;
}

async function readCharacterOwner(character: CharacterRecord) {
  return await db.query.players.findFirst({
    where: eq(players.id, character.playerId),
  });
}

async function canViewerReadCharacterRunSessions(
  character: CharacterRecord,
  viewerUserId: string | null,
): Promise<boolean> {
  if (!viewerUserId) {
    return false;
  }

  const owner = await readCharacterOwner(character);
  return owner?.userId === viewerUserId;
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

function bucketDailySnapshotsBySpan(
  snapshotsByDay: CharacterDailySnapshotRecord[],
  daySpan: number,
) {
  if (daySpan <= 1) {
    return snapshotsByDay;
  }

  const bucketed = new Map<number, CharacterDailySnapshotRecord>();
  for (const snapshot of snapshotsByDay) {
    const dayStartAt = toUnixSeconds(snapshot.dayStartAt)!;
    const bucketKey = Math.floor(dayStartAt / (daySpan * 86400));
    const current = bucketed.get(bucketKey);
    if (shouldReplaceDailyBucketSnapshot(current, snapshot)) {
      bucketed.set(bucketKey, snapshot);
    }
  }

  return Array.from(bucketed.values()).sort(
    (left, right) => left.dayStartAt.getTime() - right.dayStartAt.getTime(),
  );
}

function getDailySnapshotCompletenessScore(snapshot: CharacterDailySnapshotRecord) {
  let score = 0;
  const stats = snapshot.stats;

  if (snapshot.playtimeSeconds > 0) score += 1;
  if (snapshot.currencies !== null && snapshot.currencies !== undefined) score += 1;
  if (snapshot.stats !== null && snapshot.stats !== undefined) score += 1;
  if (stats?.critRating !== undefined) score += 1;
  if (stats?.hasteRating !== undefined) score += 1;
  if (stats?.masteryRating !== undefined) score += 1;
  if (stats?.versatilityRating !== undefined) score += 1;
  if (stats?.speedRating !== undefined) score += 1;
  if (stats?.leechRating !== undefined) score += 1;
  if (stats?.avoidanceRating !== undefined) score += 1;
  if (stats?.speedPercent !== undefined) score += 2;
  if (stats?.leechPercent !== undefined) score += 2;
  if (stats?.avoidancePercent !== undefined) score += 2;

  return score;
}

function shouldReplaceDailyBucketSnapshot(
  currentSnapshot: CharacterDailySnapshotRecord | undefined,
  candidateSnapshot: CharacterDailySnapshotRecord,
) {
  if (!currentSnapshot) return true;

  const currentScore = getDailySnapshotCompletenessScore(currentSnapshot);
  const candidateScore = getDailySnapshotCompletenessScore(candidateSnapshot);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  return candidateSnapshot.lastTakenAt.getTime() >= currentSnapshot.lastTakenAt.getTime();
}

function shouldReplaceBucketSnapshot(
  currentSnapshot: SnapshotRecord | undefined,
  candidateSnapshot: SnapshotRecord,
) {
  return shouldReplaceSnapshot(currentSnapshot, candidateSnapshot);
}

function buildRawSnapshotWhereClause(character: CharacterRecord, timeFrame: SnapshotTimeFrame) {
  const range = getSnapshotTimeFrameRange(timeFrame);
  let whereClause: SQL = eq(snapshots.characterId, character.id);

  if (isSnapshotSeasonTimeFrame(timeFrame)) {
    const seasonRange = snapshotSeasonRanges[timeFrame];
    let dateFallbackClause: SQL = isNull(snapshots.seasonId);

    if (range.startAt !== null) {
      dateFallbackClause =
        and(dateFallbackClause, gte(snapshots.takenAt, new Date(range.startAt * 1000))) ??
        dateFallbackClause;
    }

    if (range.endAt !== null) {
      dateFallbackClause =
        and(dateFallbackClause, lt(snapshots.takenAt, new Date(range.endAt * 1000))) ??
        dateFallbackClause;
    }

    return (
      and(whereClause, or(eq(snapshots.seasonId, seasonRange.seasonID), dateFallbackClause)) ??
      whereClause
    );
  }

  if (range.startAt !== null) {
    whereClause =
      and(whereClause, gte(snapshots.takenAt, new Date(range.startAt * 1000))) ?? whereClause;
  }

  if (range.endAt !== null) {
    whereClause =
      and(whereClause, lt(snapshots.takenAt, new Date(range.endAt * 1000))) ?? whereClause;
  }

  return whereClause;
}

function buildDailySnapshotWhereClause(character: CharacterRecord, timeFrame: SnapshotTimeFrame) {
  const range = getSnapshotTimeFrameRange(timeFrame);
  let whereClause: SQL = eq(characterDailySnapshots.characterId, character.id);

  if (isSnapshotSeasonTimeFrame(timeFrame)) {
    const seasonRange = snapshotSeasonRanges[timeFrame];
    let dateFallbackClause: SQL = isNull(characterDailySnapshots.seasonId);

    if (range.startAt !== null) {
      dateFallbackClause =
        and(
          dateFallbackClause,
          gte(
            characterDailySnapshots.dayStartAt,
            new Date(Math.floor(range.startAt / 86400) * 86400 * 1000),
          ),
        ) ?? dateFallbackClause;
    }

    if (range.endAt !== null) {
      dateFallbackClause =
        and(
          dateFallbackClause,
          lt(
            characterDailySnapshots.dayStartAt,
            new Date(Math.floor(range.endAt / 86400) * 86400 * 1000),
          ),
        ) ?? dateFallbackClause;
    }

    return (
      and(
        whereClause,
        or(eq(characterDailySnapshots.seasonId, seasonRange.seasonID), dateFallbackClause),
      ) ?? whereClause
    );
  }

  if (range.startAt !== null) {
    whereClause =
      and(
        whereClause,
        gte(
          characterDailySnapshots.dayStartAt,
          new Date(Math.floor(range.startAt / 86400) * 86400 * 1000),
        ),
      ) ?? whereClause;
  }

  if (range.endAt !== null) {
    whereClause =
      and(
        whereClause,
        lt(
          characterDailySnapshots.dayStartAt,
          new Date(Math.floor(range.endAt / 86400) * 86400 * 1000),
        ),
      ) ?? whereClause;
  }

  return whereClause;
}

async function readBucketedRawSnapshotsForCharacter(
  character: CharacterRecord,
  timeFrame: SnapshotTimeFrame,
) {
  const range = getSnapshotTimeFrameRange(timeFrame);
  const whereClause = buildRawSnapshotWhereClause(character, timeFrame);

  const rawSnapshots = await db
    .select()
    .from(snapshots)
    .where(whereClause)
    .orderBy(asc(snapshots.takenAt));

  if (rawSnapshots.length === 0) {
    return [];
  }

  const rangeStartAt = range.startAt ?? toUnixSeconds(rawSnapshots[0]!.takenAt)!;
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
  const range = getSnapshotTimeFrameRange(timeFrame);
  const dailyWhereClause = buildDailySnapshotWhereClause(character, timeFrame);

  const dailySnapshots = await db
    .select()
    .from(characterDailySnapshots)
    .where(dailyWhereClause)
    .orderBy(asc(characterDailySnapshots.dayStartAt));

  if (dailySnapshots.length > 0) {
    const rangeStartAt = range.startAt ?? toUnixSeconds(dailySnapshots[0]!.dayStartAt)!;
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
        coreSnapshots: bucketedDailySnapshots.map((snapshot) =>
          projectCoreTimelineSnapshot(snapshot),
        ),
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
  const visibleRuns = includeAllRuns
    ? runs.slice(0, mythicPlusAllRunsResponseLimit)
    : runs.slice(0, mythicPlusPreviewRunLimit);

  return {
    summary,
    runs: visibleRuns,
    sessions: [],
    totalRunCount,
    isPreview: totalRunCount > visibleRuns.length,
  };
}

function projectMythicPlusRunSession(
  session: MythicPlusRunSessionRecord,
  runIds: string[],
): MythicPlusRunSessionSummary {
  return {
    id: session.id,
    runIds,
    isPaid: session.isPaid,
    externalId: session.externalId ?? null,
    createdAt: toUnixSeconds(session.createdAt) ?? 0,
    updatedAt: toUnixSeconds(session.updatedAt) ?? 0,
  };
}

async function attachMythicPlusRunSessions(
  characterId: string,
  data: CharacterMythicPlusResponse,
): Promise<CharacterMythicPlusResponse> {
  const visibleRunIds = data.runs
    .map((run) => run._id)
    .filter((runId): runId is string => typeof runId === "string" && runId.length > 0);

  if (visibleRunIds.length === 0) {
    return data;
  }

  const visibleRunIdSet = new Set(visibleRunIds);
  const rows = await db
    .select({
      session: mythicPlusRunSessions,
      runId: mythicPlusRunSessionRuns.runId,
      position: mythicPlusRunSessionRuns.position,
    })
    .from(mythicPlusRunSessions)
    .innerJoin(
      mythicPlusRunSessionRuns,
      eq(mythicPlusRunSessionRuns.sessionId, mythicPlusRunSessions.id),
    )
    .where(eq(mythicPlusRunSessions.characterId, characterId))
    .orderBy(asc(mythicPlusRunSessions.createdAt), asc(mythicPlusRunSessionRuns.position));

  const visibleSessionIds = new Set<string>();
  for (const row of rows) {
    if (visibleRunIdSet.has(row.runId)) {
      visibleSessionIds.add(row.session.id);
    }
  }

  if (visibleSessionIds.size === 0) {
    return data;
  }

  const rowsBySessionId = new Map<
    string,
    { session: MythicPlusRunSessionRecord; runs: { runId: string; position: number }[] }
  >();

  for (const row of rows) {
    if (!visibleSessionIds.has(row.session.id)) {
      continue;
    }
    const current = rowsBySessionId.get(row.session.id) ?? {
      session: row.session,
      runs: [],
    };
    current.runs.push({ runId: row.runId, position: row.position });
    rowsBySessionId.set(row.session.id, current);
  }

  const sessionByRunId = new Map<string, MythicPlusRunSessionPreview>();
  const sessions = Array.from(rowsBySessionId.values()).map(({ session, runs }) => {
    const orderedRuns = runs.sort((left, right) => left.position - right.position);
    const runIds = orderedRuns.map((run) => run.runId);
    for (const run of orderedRuns) {
      sessionByRunId.set(run.runId, {
        id: session.id,
        position: run.position,
        runCount: orderedRuns.length,
        isPaid: session.isPaid,
        externalId: session.externalId ?? null,
      });
    }
    return projectMythicPlusRunSession(session, runIds);
  });

  return {
    ...data,
    runs: data.runs.map((run) => {
      const session = run._id ? sessionByRunId.get(run._id) : undefined;
      return session ? { ...run, session } : run;
    }),
    sessions,
  };
}

function stripMythicPlusRunSessionMetadata(
  data: CharacterMythicPlusResponse,
): CharacterMythicPlusResponse {
  return {
    ...data,
    runs: data.runs.map((run) => ({ ...run, session: undefined })),
    sessions: [],
  };
}

async function finalizeMythicPlusRunSessions(
  characterId: string,
  data: CharacterMythicPlusResponse,
  includeSessions: boolean,
): Promise<CharacterMythicPlusResponse> {
  if (!includeSessions) {
    return stripMythicPlusRunSessionMetadata(data);
  }

  return await attachMythicPlusRunSessions(characterId, data);
}

function getStoredCharacterMythicPlusData(
  character: CharacterRecord,
  includeAllRuns: boolean,
  currentScoreOverride?: number | null,
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

  const normalizedRuns = buildRecentRuns(runs as MythicPlusRunDocument[]);
  const visibleDuplicateCount = Math.max(0, runs.length - normalizedRuns.length);
  const normalizedTotalRunCount = Math.max(
    normalizedRuns.length,
    totalRunCount - visibleDuplicateCount,
  );
  const resolvedSummary =
    currentScoreOverride === undefined || currentScoreOverride === null
      ? summary
      : { ...summary, currentScore: currentScoreOverride };

  return buildCharacterMythicPlusData(
    resolvedSummary,
    normalizedRuns,
    normalizedTotalRunCount,
    includeAllRuns,
  );
}

async function readCharacterMythicPlusData(
  character: CharacterRecord,
  includeAllRuns: boolean,
  currentScoreOverride?: number | null,
  options: { includeSessions?: boolean } = {},
): Promise<CharacterMythicPlusResponse> {
  const storedData = getStoredCharacterMythicPlusData(
    character,
    includeAllRuns,
    currentScoreOverride,
  );
  if (storedData) {
    return await finalizeMythicPlusRunSessions(
      character.id,
      storedData,
      options.includeSessions === true,
    );
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

  return await finalizeMythicPlusRunSessions(
    character.id,
    buildCharacterMythicPlusData(
      buildMythicPlusSummary(dedupedRuns, currentScore),
      projectedRuns,
      projectedRuns.length,
      includeAllRuns,
    ),
    options.includeSessions === true,
  );
}

export async function readCharacterPage(
  characterId: string,
  timeFrame: SnapshotTimeFrame,
  includeStats: boolean,
  viewerUserId: string | null,
): Promise<CharacterPageResponse | null> {
  const character = await readCharacterById(characterId, viewerUserId);
  if (!character) {
    return null;
  }

  const ownerPromise = readCharacterOwner(character);
  const latestSnapshotPromise = readLatestSnapshotDetailsForCharacter(character);
  const firstSnapshotAtPromise = readFirstSnapshotAtForCharacter(character);
  const timelinePayloadPromise = readTimelinePayloadForCharacter(
    character,
    timeFrame,
    includeStats,
  );
  const mythicPlusPromise = Promise.all([latestSnapshotPromise, ownerPromise]).then(
    ([latestSnapshot, owner]) =>
      readCharacterMythicPlusData(character, false, latestSnapshot?.mythicPlusScore ?? null, {
        includeSessions: owner?.userId === viewerUserId,
      }),
  );

  const [owner, latestSnapshot, firstSnapshotAt, timelinePayload, mythicPlus] = await Promise.all([
    ownerPromise,
    latestSnapshotPromise,
    firstSnapshotAtPromise,
    timelinePayloadPromise,
    mythicPlusPromise,
  ]);

  return {
    header: {
      character: projectCharacterHeaderCharacter(character),
      owner: owner
        ? {
            playerId: owner.id,
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
    mythicPlus,
  };
}

export async function readCharacterDetailTimeline(
  characterId: string,
  timeFrame: SnapshotTimeFrame,
  metric: CharacterDetailMetric,
  viewerUserId: string | null,
): Promise<CharacterDetailTimelineResponse | null> {
  const character = await readCharacterById(characterId, viewerUserId);
  if (!character) {
    return null;
  }

  const timelinePayload = await readTimelinePayloadForCharacter(
    character,
    timeFrame,
    metric === "stats",
  );
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
  viewerUserId: string | null,
): Promise<CharacterSnapshotTimelineResponse | null> {
  const character = await readCharacterById(characterId, viewerUserId);
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
  viewerUserId: string | null,
): Promise<CharacterMythicPlusResponse | null> {
  const character = await readCharacterById(characterId, viewerUserId);
  if (!character) {
    return null;
  }

  return await readCharacterMythicPlusData(character, includeAllRuns, undefined, {
    includeSessions: await canViewerReadCharacterRunSessions(character, viewerUserId),
  });
}

export async function readCharactersWithLatestSnapshot(
  characterIds: string[],
  viewerUserId: string | null,
): Promise<SerializedPinnedCharacter[]> {
  const uniqueCharacterIds = [...new Set(characterIds)];
  if (uniqueCharacterIds.length === 0) {
    return [];
  }

  const rows = await readCharactersForIds(uniqueCharacterIds, viewerUserId);
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
  viewerUserId: string | null,
): Promise<PlayerCharactersResponse | null> {
  const player = await db.query.players.findFirst({
    where: eq(players.id, playerId),
  });

  if (!player) {
    return null;
  }

  const canReadAllCharacters = viewerUserId !== null && player.userId === viewerUserId;
  const characterRows = await readCharactersForPlayerId(playerId, {
    listedOnly: !canReadAllCharacters,
  });
  if (!canReadAllCharacters && characterRows.length === 0) {
    return null;
  }

  const charactersWithSnapshots = await attachLatestSnapshots(characterRows);

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
  let bestKeystone: {
    level: number;
    mapChallengeModeID: number | null;
    mapName: string | null;
  } | null = null;
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
  const charactersWithSnapshots = await attachLatestSnapshots(await readAllListedCharacters());

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
          visibility: character.visibility,
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
        right.mythicPlusScore - left.mythicPlusScore || right.itemLevel - left.itemLevel,
    )
    .slice(0, scoreboardResponseLimit);
}

export async function readPlayerScoreboard(): Promise<PlayerScoreboardEntry[]> {
  const charactersWithSnapshots = await attachLatestSnapshots(await readAllListedCharacters());
  const snappedCharacters = charactersWithSnapshots.filter(
    (character): character is SerializedDashboardCharacter & { snapshot: LatestSnapshotSummary } =>
      character.snapshot !== null,
  );

  const playerIds = [...new Set(snappedCharacters.map((character) => character.playerId))];
  if (playerIds.length === 0) {
    return [];
  }

  const playerRows = await db.select().from(players).where(inArray(players.id, playerIds));
  const playerBattleTagMap = new Map(playerRows.map((player) => [player.id, player.battleTag]));

  const playerMap = new Map<
    string,
    Omit<PlayerScoreboardEntry, "averageItemLevel"> & {
      totalItemLevel: number;
    }
  >();

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
        existing.bestKeystoneMapChallengeModeID = snapshot.ownedKeystone.mapChallengeModeID ?? null;
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
    )
    .slice(0, scoreboardResponseLimit);
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

  const accessToken = await resolveBattleNetAccessTokenForUser(userId);
  if (!accessToken.ok) {
    await insertAuditEvent("battlenet.resync.unavailable", {
      userId,
      metadata: {
        reason: accessToken.reason,
      },
      error: accessToken.error,
    });

    return {
      ok: false,
      nextAllowedAt: null,
    };
  }

  await enqueueSyncCharactersJob({
    userId,
    accessToken: accessToken.accessToken,
  });

  await insertAuditEvent("battlenet.resync", {
    userId,
    metadata: {
      tokenRefreshed: accessToken.refreshed,
    },
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

function dedupeRunIds(runIds: readonly string[]) {
  return Array.from(new Set(runIds));
}

export async function createMythicPlusRunSession(
  characterId: string,
  userId: string,
  runIds: readonly string[],
  isPaid = false,
  externalId: string | null = null,
): Promise<MythicPlusRunSessionMutationResponse | null> {
  const ownedCharacterId = await readOwnedCharacterId(characterId, userId);
  if (!ownedCharacterId) {
    return null;
  }

  const normalizedRunIds = dedupeRunIds(runIds);
  const runRows = await db
    .select({ id: mythicPlusRuns.id })
    .from(mythicPlusRuns)
    .where(
      and(
        eq(mythicPlusRuns.characterId, ownedCharacterId),
        inArray(mythicPlusRuns.id, normalizedRunIds),
      ),
    );

  if (runRows.length !== normalizedRunIds.length) {
    throw new Error("Selected Mythic+ runs are no longer available for this character.");
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const oldMemberships = await tx
      .select({ sessionId: mythicPlusRunSessionRuns.sessionId })
      .from(mythicPlusRunSessionRuns)
      .where(inArray(mythicPlusRunSessionRuns.runId, normalizedRunIds));
    const oldSessionIds = dedupeRunIds(oldMemberships.map((membership) => membership.sessionId));

    if (oldSessionIds.length > 0) {
      await tx
        .delete(mythicPlusRunSessionRuns)
        .where(inArray(mythicPlusRunSessionRuns.runId, normalizedRunIds));
    }

    const [session] = await tx
      .insert(mythicPlusRunSessions)
      .values({
        characterId: ownedCharacterId,
        externalId,
        isPaid,
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!session) {
      throw new Error("Could not create Mythic+ session.");
    }

    await tx.insert(mythicPlusRunSessionRuns).values(
      normalizedRunIds.map((runId, position) => ({
        sessionId: session.id,
        runId,
        position,
      })),
    );

    if (oldSessionIds.length > 0) {
      const remainingMemberships = await tx
        .select({ sessionId: mythicPlusRunSessionRuns.sessionId })
        .from(mythicPlusRunSessionRuns)
        .where(inArray(mythicPlusRunSessionRuns.sessionId, oldSessionIds));
      const remainingSessionIds = new Set(
        remainingMemberships.map((membership) => membership.sessionId),
      );
      const emptySessionIds = oldSessionIds.filter(
        (sessionId) => !remainingSessionIds.has(sessionId),
      );
      if (emptySessionIds.length > 0) {
        await tx
          .delete(mythicPlusRunSessions)
          .where(inArray(mythicPlusRunSessions.id, emptySessionIds));
      }
    }

    return session;
  });

  await insertAuditEvent("character.mythic_plus_session.created", {
    userId,
    metadata: {
      characterId: ownedCharacterId,
      sessionId: result.id,
      runIds: normalizedRunIds,
      isPaid,
      externalId,
    },
  });

  return {
    characterId: ownedCharacterId,
    sessionId: result.id,
    runIds: normalizedRunIds,
    isPaid: result.isPaid,
    externalId: result.externalId ?? null,
  };
}

export async function updateMythicPlusRunSessionPaidStatus(
  characterId: string,
  sessionId: string,
  userId: string,
  isPaid: boolean,
): Promise<MythicPlusRunSessionMutationResponse | null> {
  const ownedCharacterId = await readOwnedCharacterId(characterId, userId);
  if (!ownedCharacterId) {
    return null;
  }

  const [session] = await db
    .update(mythicPlusRunSessions)
    .set({
      isPaid,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mythicPlusRunSessions.id, sessionId),
        eq(mythicPlusRunSessions.characterId, ownedCharacterId),
      ),
    )
    .returning();

  if (!session) {
    return null;
  }

  const membershipRows = await db
    .select({ runId: mythicPlusRunSessionRuns.runId })
    .from(mythicPlusRunSessionRuns)
    .where(eq(mythicPlusRunSessionRuns.sessionId, session.id))
    .orderBy(asc(mythicPlusRunSessionRuns.position));
  const runIds = membershipRows.map((row) => row.runId);

  await insertAuditEvent("character.mythic_plus_session.paid.updated", {
    userId,
    metadata: {
      characterId: ownedCharacterId,
      sessionId: session.id,
      isPaid,
    },
  });

  return {
    characterId: ownedCharacterId,
    sessionId: session.id,
    runIds,
    isPaid: session.isPaid,
    externalId: session.externalId ?? null,
  };
}

export async function updateMythicPlusRunSessionExternalId(
  characterId: string,
  sessionId: string,
  userId: string,
  externalId: string | null,
): Promise<MythicPlusRunSessionMutationResponse | null> {
  const ownedCharacterId = await readOwnedCharacterId(characterId, userId);
  if (!ownedCharacterId) {
    return null;
  }

  const [session] = await db
    .update(mythicPlusRunSessions)
    .set({
      externalId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mythicPlusRunSessions.id, sessionId),
        eq(mythicPlusRunSessions.characterId, ownedCharacterId),
      ),
    )
    .returning();

  if (!session) {
    return null;
  }

  const membershipRows = await db
    .select({ runId: mythicPlusRunSessionRuns.runId })
    .from(mythicPlusRunSessionRuns)
    .where(eq(mythicPlusRunSessionRuns.sessionId, session.id))
    .orderBy(asc(mythicPlusRunSessionRuns.position));
  const runIds = membershipRows.map((row) => row.runId);

  await insertAuditEvent("character.mythic_plus_session.external_id.updated", {
    userId,
    metadata: {
      characterId: ownedCharacterId,
      sessionId: session.id,
      externalId,
    },
  });

  return {
    characterId: ownedCharacterId,
    sessionId: session.id,
    runIds,
    isPaid: session.isPaid,
    externalId: session.externalId ?? null,
  };
}

export async function deleteMythicPlusRunSession(
  characterId: string,
  sessionId: string,
  userId: string,
): Promise<MythicPlusRunSessionMutationResponse | null> {
  const ownedCharacterId = await readOwnedCharacterId(characterId, userId);
  if (!ownedCharacterId) {
    return null;
  }

  const session = await db.query.mythicPlusRunSessions.findFirst({
    where: and(
      eq(mythicPlusRunSessions.id, sessionId),
      eq(mythicPlusRunSessions.characterId, ownedCharacterId),
    ),
  });

  if (!session) {
    return null;
  }

  const membershipRows = await db
    .select({ runId: mythicPlusRunSessionRuns.runId })
    .from(mythicPlusRunSessionRuns)
    .where(eq(mythicPlusRunSessionRuns.sessionId, session.id))
    .orderBy(asc(mythicPlusRunSessionRuns.position));
  const runIds = membershipRows.map((row) => row.runId);

  await db.delete(mythicPlusRunSessions).where(eq(mythicPlusRunSessions.id, session.id));

  await insertAuditEvent("character.mythic_plus_session.deleted", {
    userId,
    metadata: {
      characterId: ownedCharacterId,
      sessionId: session.id,
      runIds,
    },
  });

  return {
    characterId: ownedCharacterId,
    sessionId: session.id,
    runIds,
    isPaid: session.isPaid,
    externalId: session.externalId ?? null,
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

export async function updateCharacterVisibility(
  characterId: string,
  userId: string,
  visibility: CharacterVisibility,
): Promise<{ characterId: string; visibility: CharacterVisibility } | null> {
  const ownedCharacterId = await readOwnedCharacterId(characterId, userId);
  if (!ownedCharacterId) {
    return null;
  }

  await db
    .update(characters)
    .set({
      visibility,
    })
    .where(eq(characters.id, ownedCharacterId));

  await insertAuditEvent("character.visibility.updated", {
    userId,
    metadata: {
      characterId: ownedCharacterId,
      visibility,
    },
  });

  return {
    characterId: ownedCharacterId,
    visibility,
  };
}

export async function readBoosterCharactersForExport(): Promise<CharacterBoosterExportEntry[]> {
  const boosterCharacters = await db.query.characters.findMany({
    where: and(eq(characters.isBooster, true), eq(characters.visibility, "public")),
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
        visibility: character.visibility,
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
