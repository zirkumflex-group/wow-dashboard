import { z } from "zod";

export const nonTradeableSlotValues = [
  "head",
  "shoulders",
  "chest",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
  "neck",
  "back",
  "finger1",
  "finger2",
  "trinket1",
  "trinket2",
  "mainHand",
  "offHand",
] as const;

export const characterRegionValues = ["us", "eu", "kr", "tw"] as const;
export const characterFactionValues = ["alliance", "horde"] as const;
export const snapshotRoleValues = ["tank", "healer", "dps"] as const;
export const snapshotTimeFrameValues = [
  "7d",
  "14d",
  "30d",
  "90d",
  "all",
  "tww-s3",
  "mn-s1",
] as const;
export const characterDetailMetricValues = ["stats", "currencies"] as const;
export const mythicPlusRunStatusValues = ["active", "completed", "abandoned"] as const;
export const mythicPlusAbandonReasonValues = [
  "challenge_mode_reset",
  "left_instance",
  "leaver_timer",
  "history_incomplete",
  "stale_recovery",
  "unknown",
] as const;

export const addonIngestLimits = {
  maxCharacters: 500,
  maxSnapshotsPerCharacter: 1_000,
  maxMythicPlusRunsPerCharacter: 5_000,
  maxMythicPlusRunMembers: 10,
  maxSnapshotCurrencyDetails: 50,
  maxSnapshotEquipmentSlots: 32,
  maxSnapshotWeeklyRewardActivities: 25,
  maxSnapshotMajorFactions: 50,
} as const;

export const nonTradeableSlotSchema = z.enum(nonTradeableSlotValues);
export const characterRegionSchema = z.enum(characterRegionValues);
export const characterFactionSchema = z.enum(characterFactionValues);
export const snapshotRoleSchema = z.enum(snapshotRoleValues);
export const snapshotTimeFrameSchema = z.enum(snapshotTimeFrameValues);
export const characterDetailMetricSchema = z.enum(characterDetailMetricValues);
export const mythicPlusRunStatusSchema = z.enum(mythicPlusRunStatusValues);
export const mythicPlusAbandonReasonSchema = z.enum(mythicPlusAbandonReasonValues);

export const currenciesSchema = z.object({
  adventurerDawncrest: z.number(),
  veteranDawncrest: z.number(),
  championDawncrest: z.number(),
  heroDawncrest: z.number(),
  mythDawncrest: z.number(),
  radiantSparkDust: z.number(),
});

export const snapshotCurrencyInfoSchema = z.object({
  currencyID: z.number(),
  name: z.string().optional(),
  quantity: z.number(),
  iconFileID: z.number().optional(),
  maxQuantity: z.number().optional(),
  canEarnPerWeek: z.boolean().optional(),
  quantityEarnedThisWeek: z.number().optional(),
  maxWeeklyQuantity: z.number().optional(),
  totalEarned: z.number().optional(),
  discovered: z.boolean().optional(),
  quality: z.number().optional(),
  useTotalEarnedForMaxQty: z.boolean().optional(),
});

export const snapshotCurrencyDetailsSchema = z
  .record(z.string(), snapshotCurrencyInfoSchema)
  .refine((value) => Object.keys(value).length <= addonIngestLimits.maxSnapshotCurrencyDetails);

export const snapshotEquipmentItemSchema = z.object({
  slot: z.string(),
  slotID: z.number(),
  itemID: z.number().optional(),
  itemName: z.string().optional(),
  itemLink: z.string().optional(),
  itemLevel: z.number().optional(),
  quality: z.number().optional(),
  iconFileID: z.number().optional(),
});

export const snapshotEquipmentSchema = z
  .record(z.string(), snapshotEquipmentItemSchema)
  .refine((value) => Object.keys(value).length <= addonIngestLimits.maxSnapshotEquipmentSlots);

export const snapshotWeeklyRewardActivitySchema = z.object({
  type: z.number().optional(),
  index: z.number().optional(),
  id: z.number().optional(),
  level: z.number().optional(),
  threshold: z.number().optional(),
  progress: z.number().optional(),
  activityTierID: z.number().optional(),
  itemLevel: z.number().optional(),
  name: z.string().optional(),
});

export const snapshotWeeklyRewardsSchema = z.object({
  canClaimRewards: z.boolean().optional(),
  isCurrentPeriod: z.boolean().optional(),
  activities: z
    .array(snapshotWeeklyRewardActivitySchema)
    .max(addonIngestLimits.maxSnapshotWeeklyRewardActivities),
});

export const snapshotMajorFactionSchema = z.object({
  factionID: z.number(),
  name: z.string().optional(),
  expansionID: z.number().optional(),
  isUnlocked: z.boolean().optional(),
  renownLevel: z.number().optional(),
  renownReputationEarned: z.number().optional(),
  renownLevelThreshold: z.number().optional(),
  isWeeklyCapped: z.boolean().optional(),
});

export const snapshotMajorFactionsSchema = z.object({
  factions: z.array(snapshotMajorFactionSchema).max(addonIngestLimits.maxSnapshotMajorFactions),
});

export const snapshotClientInfoSchema = z.object({
  addonVersion: z.string().optional(),
  interfaceVersion: z.number().optional(),
  gameVersion: z.string().optional(),
  buildNumber: z.string().optional(),
  buildDate: z.string().optional(),
  tocVersion: z.number().optional(),
  expansion: z.string().optional(),
  locale: z.string().optional(),
});

export const statsSchema = z.object({
  stamina: z.number(),
  strength: z.number(),
  agility: z.number(),
  intellect: z.number(),
  critRating: z.number().optional(),
  critPercent: z.number(),
  hasteRating: z.number().optional(),
  hastePercent: z.number(),
  masteryRating: z.number().optional(),
  masteryPercent: z.number(),
  versatilityRating: z.number().optional(),
  versatilityPercent: z.number(),
  speedRating: z.number().optional(),
  speedPercent: z.number().optional(),
  leechRating: z.number().optional(),
  leechPercent: z.number().optional(),
  avoidanceRating: z.number().optional(),
  avoidancePercent: z.number().optional(),
});

export const ownedKeystoneSchema = z.object({
  level: z.number(),
  mapChallengeModeID: z.number().optional(),
  mapName: z.string().optional(),
});

export const addonSnapshotSchema = z.object({
  takenAt: z.number(),
  level: z.number(),
  spec: z.string(),
  role: snapshotRoleSchema,
  itemLevel: z.number(),
  gold: z.number(),
  playtimeSeconds: z.number(),
  playtimeThisLevelSeconds: z.number().optional(),
  mythicPlusScore: z.number(),
  seasonID: z.number().optional(),
  ownedKeystone: ownedKeystoneSchema.optional(),
  currencies: currenciesSchema,
  currencyDetails: snapshotCurrencyDetailsSchema.optional(),
  stats: statsSchema,
  equipment: snapshotEquipmentSchema.optional(),
  weeklyRewards: snapshotWeeklyRewardsSchema.optional(),
  majorFactions: snapshotMajorFactionsSchema.optional(),
  clientInfo: snapshotClientInfoSchema.optional(),
});

export const addonMythicPlusRunMemberSchema = z.object({
  name: z.string(),
  realm: z.string().optional(),
  classTag: z.string().optional(),
  role: snapshotRoleSchema.optional(),
});

export const addonMythicPlusRunSchema = z.object({
  fingerprint: z.string(),
  attemptId: z.string().optional(),
  canonicalKey: z.string().optional(),
  observedAt: z.number(),
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
  members: z
    .array(addonMythicPlusRunMemberSchema)
    .max(addonIngestLimits.maxMythicPlusRunMembers)
    .optional(),
});

export const addonCharacterSchema = z.object({
  name: z.string(),
  realm: z.string(),
  region: characterRegionSchema,
  class: z.string(),
  race: z.string(),
  faction: characterFactionSchema,
  snapshots: z.array(addonSnapshotSchema).max(addonIngestLimits.maxSnapshotsPerCharacter),
  mythicPlusRuns: z
    .array(addonMythicPlusRunSchema)
    .max(addonIngestLimits.maxMythicPlusRunsPerCharacter)
    .optional(),
});

export const charactersLatestQuerySchema = z.object({
  characterId: z.array(z.string().uuid()).default([]),
});

export const playerRouteParamsSchema = z.object({
  id: z.string().uuid(),
});

export const characterRouteParamsSchema = z.object({
  id: z.string().uuid(),
});

export const characterPageQuerySchema = z.object({
  timeFrame: snapshotTimeFrameSchema,
  includeStats: z.boolean().optional(),
});

export const characterDetailTimelineQuerySchema = z.object({
  timeFrame: snapshotTimeFrameSchema,
  metric: characterDetailMetricSchema,
});

export const characterSnapshotTimelineQuerySchema = z.object({
  timeFrame: snapshotTimeFrameSchema,
});

export const characterMythicPlusQuerySchema = z.object({
  includeAllRuns: z.boolean().optional(),
});

export const updatePlayerDiscordBodySchema = z.object({
  discordUserId: z.string().nullable(),
});

export const updateCharacterBoosterBodySchema = z.object({
  isBooster: z.boolean(),
});

export const updateCharacterSlotsBodySchema = z.object({
  nonTradeableSlots: z.array(nonTradeableSlotSchema),
});

export const addonIngestBodySchema = z.object({
  characters: z.array(addonCharacterSchema).max(addonIngestLimits.maxCharacters),
});

export type CharactersLatestQuery = z.infer<typeof charactersLatestQuerySchema>;
export type PlayerRouteParams = z.infer<typeof playerRouteParamsSchema>;
export type CharacterRouteParams = z.infer<typeof characterRouteParamsSchema>;
export type CharacterPageQuery = z.infer<typeof characterPageQuerySchema>;
export type CharacterDetailTimelineQuery = z.infer<typeof characterDetailTimelineQuerySchema>;
export type CharacterSnapshotTimelineQuery = z.infer<typeof characterSnapshotTimelineQuerySchema>;
export type CharacterMythicPlusQuery = z.infer<typeof characterMythicPlusQuerySchema>;
export type UpdatePlayerDiscordBody = z.infer<typeof updatePlayerDiscordBodySchema>;
export type UpdateCharacterBoosterBody = z.infer<typeof updateCharacterBoosterBodySchema>;
export type UpdateCharacterSlotsBody = z.infer<typeof updateCharacterSlotsBodySchema>;
export type AddonIngestBody = z.infer<typeof addonIngestBodySchema>;
export type AddonCharacterInput = z.infer<typeof addonCharacterSchema>;
export type AddonSnapshotInput = z.infer<typeof addonSnapshotSchema>;
export type AddonMythicPlusRunInput = z.infer<typeof addonMythicPlusRunSchema>;
