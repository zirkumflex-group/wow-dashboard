import scoreTiers from "./raiderio-score-tiers-season-mn-1.json";

type RaiderIoScoreTier = {
  score: number;
  color: string;
};

type MythicPlusDungeonMeta = {
  mapChallengeModeID: number;
  name: string;
  shortName: string;
  iconUrl: string;
  timerMs: number;
  easeRank: number;
  easeTier: "S" | "A" | "B" | "C";
};

export const CURRENT_SEASON_DUNGEONS: MythicPlusDungeonMeta[] = [
  {
    mapChallengeModeID: 402,
    name: "Algeth'ar Academy",
    shortName: "AA",
    iconUrl: "https://cdn.raiderio.net/images/wow/icons/large/achievement_dungeon_dragonacademy.jpg",
    timerMs: 30 * 60 * 1000,
    easeRank: 5,
    easeTier: "A",
  },
  {
    mapChallengeModeID: 558,
    name: "Magisters' Terrace",
    shortName: "MT",
    iconUrl: "https://cdn.raiderio.net/images/wow/icons/large/inv_achievement_dungeon_magistersterrace.jpg",
    timerMs: 34 * 60 * 1000,
    easeRank: 6,
    easeTier: "B",
  },
  {
    mapChallengeModeID: 560,
    name: "Maisara Caverns",
    shortName: "MC",
    iconUrl: "https://cdn.raiderio.net/images/wow/icons/large/inv_achievement_dungeon_maisarahills.jpg",
    timerMs: 33 * 60 * 1000,
    easeRank: 8,
    easeTier: "C",
  },
  {
    mapChallengeModeID: 559,
    name: "Nexus-Point Xenas",
    shortName: "NPX",
    iconUrl: "https://cdn.raiderio.net/images/wow/icons/large/inv_achievement_dungeon_voidscararena.jpg",
    timerMs: 30 * 60 * 1000,
    easeRank: 7,
    easeTier: "B",
  },
  {
    mapChallengeModeID: 556,
    name: "Pit of Saron",
    shortName: "POS",
    iconUrl: "https://cdn.raiderio.net/images/wow/icons/large/achievement_dungeon_icecrown_pitofsaron.jpg",
    timerMs: 30 * 60 * 1000,
    easeRank: 1,
    easeTier: "S",
  },
  {
    mapChallengeModeID: 239,
    name: "Seat of the Triumvirate",
    shortName: "SEAT",
    iconUrl: "https://cdn.raiderio.net/images/wow/icons/large/achievement_boss_triumvirate_darknaaru.jpg",
    timerMs: 34 * 60 * 1000,
    easeRank: 2,
    easeTier: "A",
  },
  {
    mapChallengeModeID: 161,
    name: "Skyreach",
    shortName: "SR",
    iconUrl: "https://cdn.raiderio.net/images/wow/icons/large/achievement_dungeon_arakkoaspires.jpg",
    timerMs: 28 * 60 * 1000,
    easeRank: 3,
    easeTier: "A",
  },
  {
    mapChallengeModeID: 557,
    name: "Windrunner Spire",
    shortName: "WS",
    iconUrl: "https://cdn.raiderio.net/images/wow/icons/large/inv_achievement_dungeon_windrunnerspire.jpg",
    timerMs: 33.5 * 60 * 1000,
    easeRank: 4,
    easeTier: "A",
  },
];

const SCORE_TIERS = scoreTiers as RaiderIoScoreTier[];
const DUNGEONS_BY_MAP_ID = new Map(
  CURRENT_SEASON_DUNGEONS.map((dungeon) => [dungeon.mapChallengeModeID, dungeon] as const),
);
const DUNGEONS_BY_NAME = new Map(
  CURRENT_SEASON_DUNGEONS.map((dungeon) => [dungeon.name.trim().toLowerCase(), dungeon] as const),
);

function normalizeDungeonName(name: string) {
  return name.trim().toLowerCase();
}

export function getMythicPlusDungeonMeta(
  mapChallengeModeID?: number | null,
  mapName?: string | null,
) {
  if (mapChallengeModeID !== undefined && mapChallengeModeID !== null) {
    const dungeonByMapId = DUNGEONS_BY_MAP_ID.get(mapChallengeModeID);
    if (dungeonByMapId) return dungeonByMapId;
  }

  if (typeof mapName === "string" && mapName.trim() !== "") {
    return DUNGEONS_BY_NAME.get(normalizeDungeonName(mapName)) ?? null;
  }

  return null;
}

export function getMythicPlusDungeonTimerMs(
  mapChallengeModeID?: number | null,
  mapName?: string | null,
) {
  return getMythicPlusDungeonMeta(mapChallengeModeID, mapName)?.timerMs ?? null;
}

export function getMythicPlusDungeonEaseRank(
  mapChallengeModeID?: number | null,
  mapName?: string | null,
) {
  return getMythicPlusDungeonMeta(mapChallengeModeID, mapName)?.easeRank ?? CURRENT_SEASON_DUNGEONS.length;
}

function getRaiderIoScoreTier(score?: number | null) {
  if (score === undefined || score === null || !Number.isFinite(score)) return undefined;

  for (const tier of SCORE_TIERS) {
    if (score >= tier.score) {
      return tier;
    }
  }

  return SCORE_TIERS[SCORE_TIERS.length - 1];
}

export function getRaiderIoScoreColor(score?: number | null) {
  return getRaiderIoScoreTier(score)?.color;
}

function getRaiderIoOverallEquivalentFromDungeonScore(
  dungeonScore?: number | null,
  dungeonCount = CURRENT_SEASON_DUNGEONS.length,
) {
  if (dungeonScore === undefined || dungeonScore === null || !Number.isFinite(dungeonScore)) {
    return undefined;
  }

  return dungeonScore * Math.max(1, dungeonCount);
}

export function getRaiderIoDungeonScoreColor(
  dungeonScore?: number | null,
  dungeonCount = CURRENT_SEASON_DUNGEONS.length,
) {
  return getRaiderIoScoreColor(
    getRaiderIoOverallEquivalentFromDungeonScore(dungeonScore, dungeonCount),
  );
}
