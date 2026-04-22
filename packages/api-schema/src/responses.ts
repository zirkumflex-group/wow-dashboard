import { z } from "zod";
import {
  addonMythicPlusRunMemberSchema,
  characterFactionSchema,
  characterRegionSchema,
  currenciesSchema,
  mythicPlusAbandonReasonSchema,
  mythicPlusRunStatusSchema,
  nonTradeableSlotSchema,
  ownedKeystoneSchema,
  snapshotRoleSchema,
  statsSchema,
} from "./routes";

const snapshotSpecSchema = z.string();
const isoDateTimeSchema = z.string();

export const apiErrorResponseSchema = z.object({
  error: z.string(),
});

export const authSessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
});

export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const meResponseSchema = z.object({
  session: authSessionSchema,
  user: authUserSchema,
});

export const loginCodeResponseSchema = z.object({
  code: z.string(),
  expiresIn: z.number(),
});

export const redeemLoginCodeBodySchema = z.object({
  code: z.string().min(1),
});

export const redeemLoginCodeResponseSchema = z.object({
  token: z.string(),
});

export const latestSnapshotSummarySchema = z.object({
  takenAt: z.number(),
  level: z.number(),
  spec: snapshotSpecSchema,
  role: snapshotRoleSchema,
  itemLevel: z.number(),
  gold: z.number(),
  playtimeSeconds: z.number(),
  playtimeThisLevelSeconds: z.number().optional(),
  mythicPlusScore: z.number(),
  ownedKeystone: ownedKeystoneSchema.optional(),
});

export const latestSnapshotDetailsSchema = latestSnapshotSummarySchema.extend({
  currencies: currenciesSchema,
  stats: statsSchema,
});

export const mythicPlusBucketSummarySchema = z.object({
  totalRuns: z.number(),
  totalAttempts: z.number().optional(),
  completedRuns: z.number(),
  abandonedRuns: z.number().optional(),
  activeRuns: z.number().optional(),
  timedRuns: z.number(),
  timed2To9: z.number(),
  timed10To11: z.number(),
  timed12To13: z.number(),
  timed14Plus: z.number(),
  bestLevel: z.number().nullable(),
  bestTimedLevel: z.number().nullable(),
  bestTimedUpgradeCount: z.number().nullable(),
  bestTimedScore: z.number().nullable(),
  bestTimedDurationMs: z.number().nullable(),
  bestScore: z.number().nullable(),
  averageLevel: z.number().nullable(),
  averageScore: z.number().nullable(),
  lastRunAt: z.number().nullable(),
});

export const mythicPlusDungeonSummarySchema = z.object({
  mapChallengeModeID: z.number().nullable(),
  mapName: z.string(),
  totalRuns: z.number(),
  timedRuns: z.number(),
  bestLevel: z.number().nullable(),
  bestTimedLevel: z.number().nullable(),
  bestTimedUpgradeCount: z.number().nullable(),
  bestTimedScore: z.number().nullable(),
  bestTimedDurationMs: z.number().nullable(),
  bestScore: z.number().nullable(),
  lastRunAt: z.number().nullable(),
});

export const mythicPlusSummarySchema = z.object({
  latestSeasonID: z.number().nullable(),
  currentScore: z.number().nullable(),
  overall: mythicPlusBucketSummarySchema,
  currentSeason: mythicPlusBucketSummarySchema.nullable(),
  currentSeasonDungeons: z.array(mythicPlusDungeonSummarySchema),
});

export const mythicPlusRecentRunPreviewSchema = z.object({
  _id: z.string().optional(),
  _creationTime: z.number().optional(),
  characterId: z.string().optional(),
  rowKey: z.string(),
  fingerprint: z.string(),
  attemptId: z.string().optional(),
  canonicalKey: z.string().optional(),
  observedAt: z.number(),
  playedAt: z.number(),
  sortTimestamp: z.number(),
  seasonID: z.number().optional(),
  mapChallengeModeID: z.number().optional(),
  mapName: z.string().optional(),
  level: z.number().optional(),
  status: mythicPlusRunStatusSchema.optional(),
  completed: z.boolean().optional(),
  completedInTime: z.boolean().optional(),
  durationMs: z.number().optional(),
  runScore: z.number().optional(),
  startDate: z.number().optional(),
  completedAt: z.number().optional(),
  endedAt: z.number().optional(),
  abandonedAt: z.number().optional(),
  abandonReason: mythicPlusAbandonReasonSchema.optional(),
  thisWeek: z.boolean().optional(),
  members: z.array(addonMythicPlusRunMemberSchema).optional(),
  upgradeCount: z.number().nullable(),
  scoreIncrease: z.number().nullable(),
});

export const serializedCharacterSchema = z.object({
  _id: z.string().uuid(),
  playerId: z.string().uuid(),
  name: z.string(),
  realm: z.string(),
  region: characterRegionSchema,
  class: z.string(),
  race: z.string(),
  faction: characterFactionSchema,
  isBooster: z.boolean().nullable(),
  nonTradeableSlots: z.array(nonTradeableSlotSchema).nullable(),
  latestSnapshot: latestSnapshotSummarySchema.nullable(),
  latestSnapshotDetails: latestSnapshotDetailsSchema.nullable(),
  mythicPlusSummary: mythicPlusSummarySchema.nullable(),
  mythicPlusRecentRunsPreview: z.array(mythicPlusRecentRunPreviewSchema).nullable(),
  mythicPlusRunCount: z.number().nullable(),
  firstSnapshotAt: z.number().nullable(),
  snapshotCount: z.number().nullable(),
});

export const serializedDashboardCharacterSchema = serializedCharacterSchema.extend({
  snapshot: latestSnapshotSummarySchema.nullable(),
});

export const serializedPinnedCharacterSchema = serializedCharacterSchema.extend({
  snapshot: z
    .object({
      itemLevel: z.number(),
    })
    .nullable(),
});

export const scoreboardCharacterEntrySchema = z.object({
  characterId: z.string().uuid(),
  playerId: z.string().uuid(),
  name: z.string(),
  realm: z.string(),
  region: characterRegionSchema,
  class: z.string(),
  race: z.string(),
  faction: characterFactionSchema,
  mythicPlusScore: z.number(),
  itemLevel: z.number(),
  gold: z.number(),
  playtimeSeconds: z.number(),
  playtimeThisLevelSeconds: z.number().optional(),
  ownedKeystone: ownedKeystoneSchema.nullable(),
  spec: snapshotSpecSchema,
  role: snapshotRoleSchema,
  level: z.number(),
  takenAt: z.number(),
});

export const playerScoreboardEntrySchema = z.object({
  playerId: z.string().uuid(),
  battleTag: z.string(),
  totalPlaytimeSeconds: z.number(),
  totalGold: z.number(),
  highestMythicPlusScore: z.number(),
  highestMythicPlusCharacterName: z.string().nullable(),
  averageItemLevel: z.number(),
  characterCount: z.number(),
  bestKeystoneLevel: z.number().nullable(),
  bestKeystoneMapChallengeModeID: z.number().nullable(),
  bestKeystoneMapName: z.string().nullable(),
  latestSnapshotAt: z.number().nullable(),
});

export const playerCharactersResponseSchema = z.object({
  player: z.object({
    playerId: z.string().uuid(),
    battleTag: z.string(),
  }),
  summary: z.object({
    trackedCharacters: z.number(),
    scannedCharacters: z.number(),
    totalPlaytimeSeconds: z.number(),
    totalGold: z.number(),
    highestMythicPlusScore: z.number().nullable(),
    highestMythicPlusCharacterName: z.string().nullable(),
    averageItemLevel: z.number().nullable(),
    bestKeystone: z
      .object({
        level: z.number(),
        mapChallengeModeID: z.number().nullable(),
        mapName: z.string().nullable(),
      })
      .nullable(),
    latestSnapshotAt: z.number().nullable(),
  }),
  characters: z.array(serializedDashboardCharacterSchema),
});

export const characterBoosterExportEntrySchema = z.object({
  _id: z.string().uuid(),
  playerId: z.string().uuid(),
  name: z.string(),
  realm: z.string(),
  region: characterRegionSchema,
  class: z.string(),
  faction: characterFactionSchema,
  isBooster: z.boolean(),
  nonTradeableSlots: z.array(nonTradeableSlotSchema),
  ownerBattleTag: z.string().nullable(),
  ownerDiscordUserId: z.string().nullable(),
  snapshot: z
    .object({
      spec: snapshotSpecSchema,
      role: snapshotRoleSchema,
      mythicPlusScore: z.number(),
      itemLevel: z.number(),
      takenAt: z.number(),
      ownedKeystone: ownedKeystoneSchema.nullable(),
    })
    .nullable(),
});

export const resyncCharactersResponseSchema = z.object({
  ok: z.boolean(),
  nextAllowedAt: z.number().nullable(),
});

export const updateCharacterBoosterResponseSchema = z.object({
  characterId: z.string().uuid(),
  isBooster: z.boolean(),
});

export const updateCharacterSlotsResponseSchema = z.object({
  characterId: z.string().uuid(),
  nonTradeableSlots: z.array(nonTradeableSlotSchema),
});

export const updatePlayerDiscordResponseSchema = z.object({
  playerId: z.string().uuid(),
  discordUserId: z.string().nullable(),
});

export const addonIngestResponseSchema = z.object({
  newChars: z.number(),
  newSnapshots: z.number(),
  newMythicPlusRuns: z.number(),
  collapsedMythicPlusRuns: z.number(),
});

export const charactersLatestResponseSchema = z.array(serializedPinnedCharacterSchema);
export const myCharactersResponseSchema = z.array(serializedDashboardCharacterSchema).nullable();
export const charactersScoreboardResponseSchema = z.array(scoreboardCharacterEntrySchema);
export const playerScoreboardResponseSchema = z.array(playerScoreboardEntrySchema);
export const boosterCharactersExportResponseSchema = z.array(characterBoosterExportEntrySchema);
export const playerCharactersResultSchema = playerCharactersResponseSchema.nullable();

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type LoginCodeResponse = z.infer<typeof loginCodeResponseSchema>;
export type RedeemLoginCodeBody = z.infer<typeof redeemLoginCodeBodySchema>;
export type RedeemLoginCodeResponse = z.infer<typeof redeemLoginCodeResponseSchema>;
export type LatestSnapshotSummary = z.infer<typeof latestSnapshotSummarySchema>;
export type LatestSnapshotDetails = z.infer<typeof latestSnapshotDetailsSchema>;
export type MythicPlusSummary = z.infer<typeof mythicPlusSummarySchema>;
export type MythicPlusRecentRunPreview = z.infer<typeof mythicPlusRecentRunPreviewSchema>;
export type SerializedCharacter = z.infer<typeof serializedCharacterSchema>;
export type SerializedDashboardCharacter = z.infer<typeof serializedDashboardCharacterSchema>;
export type SerializedPinnedCharacter = z.infer<typeof serializedPinnedCharacterSchema>;
export type ScoreboardCharacterEntry = z.infer<typeof scoreboardCharacterEntrySchema>;
export type PlayerScoreboardEntry = z.infer<typeof playerScoreboardEntrySchema>;
export type PlayerCharactersResponse = z.infer<typeof playerCharactersResponseSchema>;
export type CharacterBoosterExportEntry = z.infer<typeof characterBoosterExportEntrySchema>;
export type ResyncCharactersResponse = z.infer<typeof resyncCharactersResponseSchema>;
export type UpdateCharacterBoosterResponse = z.infer<typeof updateCharacterBoosterResponseSchema>;
export type UpdateCharacterSlotsResponse = z.infer<typeof updateCharacterSlotsResponseSchema>;
export type UpdatePlayerDiscordResponse = z.infer<typeof updatePlayerDiscordResponseSchema>;
export type AddonIngestResponse = z.infer<typeof addonIngestResponseSchema>;
