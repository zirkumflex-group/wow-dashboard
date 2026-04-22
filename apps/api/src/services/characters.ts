import { desc, eq, inArray } from "drizzle-orm";
import {
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

  const characterRows = await db
    .select()
    .from(characters)
    .where(eq(characters.playerId, playerId));

  const charactersWithSnapshots = await Promise.all(
    characterRows.map(async (character) => ({
      ...serializeCharacter(character),
      snapshot: await readLatestSnapshotSummaryForCharacter(character),
    })),
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
