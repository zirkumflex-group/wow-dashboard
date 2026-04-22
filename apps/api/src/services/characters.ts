import { and, desc, eq, inArray } from "drizzle-orm";
import {
  account,
  characters,
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

type CharacterRecord = typeof characters.$inferSelect;
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
  isBooster: boolean,
): Promise<{ characterId: string; isBooster: boolean } | null> {
  const character = await readCharacterById(characterId);
  if (!character) {
    return null;
  }

  await db
    .update(characters)
    .set({
      isBooster,
    })
    .where(eq(characters.id, characterId));

  return {
    characterId,
    isBooster,
  };
}

export async function updateCharacterNonTradeableSlots(
  characterId: string,
  nonTradeableSlots: readonly NonTradeableSlot[],
): Promise<{ characterId: string; nonTradeableSlots: NonTradeableSlot[] } | null> {
  const character = await readCharacterById(characterId);
  if (!character) {
    return null;
  }

  const normalizedSlots = normalizeNonTradeableSlots(nonTradeableSlots);

  await db
    .update(characters)
    .set({
      nonTradeableSlots: normalizedSlots.length > 0 ? normalizedSlots : null,
    })
    .where(eq(characters.id, characterId));

  return {
    characterId,
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
