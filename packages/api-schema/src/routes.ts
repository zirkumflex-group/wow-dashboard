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
export const characterVisibilityValues = ["public", "unlisted", "private"] as const;
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
  maxBodyBytes: 8 * 1024 * 1024,
  maxCharacters: 80,
  maxSnapshotsPerCharacter: 400,
  maxMythicPlusRunsPerCharacter: 750,
  maxMythicPlusRunMembers: 5,
  maxSnapshotCurrencyDetails: 50,
  maxSnapshotEquipmentSlots: 32,
  maxSnapshotWeeklyRewardActivities: 25,
  maxSnapshotMajorFactions: 50,
  maxCharactersLatestIds: 100,
} as const;

export const nonTradeableSlotSchema = z.enum(nonTradeableSlotValues);
export const characterRegionSchema = z.enum(characterRegionValues);
export const characterFactionSchema = z.enum(characterFactionValues);
export const characterVisibilitySchema = z.enum(characterVisibilityValues);
export const snapshotRoleSchema = z.enum(snapshotRoleValues);
export const snapshotTimeFrameSchema = z.enum(snapshotTimeFrameValues);
export const characterDetailMetricSchema = z.enum(characterDetailMetricValues);
export const mythicPlusRunStatusSchema = z.enum(mythicPlusRunStatusValues);
export const mythicPlusAbandonReasonSchema = z.enum(mythicPlusAbandonReasonValues);

const shortAddonStringSchema = z.string().trim().min(1).max(64);
const mediumAddonStringSchema = z.string().trim().min(1).max(128);
const longAddonStringSchema = z.string().trim().min(1).max(512);
const shortAddonRecordKeySchema = z.string().min(1).max(64);
const unixSecondsSchema = z.number().finite().int().min(0).max(4_102_444_800);
const nonNegativeIntegerSchema = z.number().finite().int().min(0);
const nonNegativeNumberSchema = z.number().finite().min(0);
const addonIdSchema = nonNegativeIntegerSchema.max(1_000_000_000);
const addonQuantitySchema = nonNegativeIntegerSchema.max(1_000_000_000);
const characterLevelSchema = z.number().finite().int().min(1).max(100);
const itemLevelSchema = nonNegativeNumberSchema.max(1_000);
const goldSchema = nonNegativeNumberSchema.max(100_000_000_000);
const playtimeSecondsSchema = nonNegativeIntegerSchema.max(2_000_000_000);
const mythicPlusScoreSchema = nonNegativeNumberSchema.max(5_000);
const keystoneLevelSchema = nonNegativeIntegerSchema.max(50);
const percentageSchema = nonNegativeNumberSchema.max(10_000);
const statRatingSchema = nonNegativeNumberSchema.max(10_000_000);
const seasonIdSchema = nonNegativeIntegerSchema.min(1).max(1_000);
const durationMsSchema = nonNegativeIntegerSchema.max(4 * 60 * 60 * 1000);

export const currenciesSchema = z.object({
  adventurerDawncrest: addonQuantitySchema,
  veteranDawncrest: addonQuantitySchema,
  championDawncrest: addonQuantitySchema,
  heroDawncrest: addonQuantitySchema,
  mythDawncrest: addonQuantitySchema,
  radiantSparkDust: addonQuantitySchema,
});

export const snapshotCurrencyInfoSchema = z.object({
  currencyID: addonIdSchema,
  name: mediumAddonStringSchema.optional(),
  quantity: addonQuantitySchema,
  iconFileID: addonIdSchema.optional(),
  maxQuantity: addonQuantitySchema.optional(),
  canEarnPerWeek: z.boolean().optional(),
  quantityEarnedThisWeek: addonQuantitySchema.optional(),
  maxWeeklyQuantity: addonQuantitySchema.optional(),
  totalEarned: addonQuantitySchema.optional(),
  discovered: z.boolean().optional(),
  quality: nonNegativeIntegerSchema.max(10).optional(),
  useTotalEarnedForMaxQty: z.boolean().optional(),
});

export const snapshotCurrencyDetailsSchema = z
  .record(shortAddonRecordKeySchema, snapshotCurrencyInfoSchema)
  .refine((value) => Object.keys(value).length <= addonIngestLimits.maxSnapshotCurrencyDetails);

export const snapshotEquipmentItemSchema = z.object({
  slot: shortAddonStringSchema,
  slotID: nonNegativeIntegerSchema.max(100),
  itemID: addonIdSchema.optional(),
  itemName: mediumAddonStringSchema.optional(),
  itemLink: longAddonStringSchema.optional(),
  itemLevel: itemLevelSchema.optional(),
  quality: nonNegativeIntegerSchema.max(10).optional(),
  iconFileID: addonIdSchema.optional(),
});

export const snapshotEquipmentSchema = z
  .record(shortAddonRecordKeySchema, snapshotEquipmentItemSchema)
  .refine((value) => Object.keys(value).length <= addonIngestLimits.maxSnapshotEquipmentSlots);

export const snapshotWeeklyRewardActivitySchema = z.object({
  type: nonNegativeIntegerSchema.max(100).optional(),
  index: nonNegativeIntegerSchema.max(100).optional(),
  id: addonIdSchema.optional(),
  level: keystoneLevelSchema.optional(),
  threshold: addonQuantitySchema.optional(),
  progress: addonQuantitySchema.optional(),
  activityTierID: addonIdSchema.optional(),
  itemLevel: itemLevelSchema.optional(),
  name: mediumAddonStringSchema.optional(),
});

export const snapshotWeeklyRewardsSchema = z.object({
  canClaimRewards: z.boolean().optional(),
  isCurrentPeriod: z.boolean().optional(),
  activities: z
    .array(snapshotWeeklyRewardActivitySchema)
    .max(addonIngestLimits.maxSnapshotWeeklyRewardActivities),
});

export const snapshotMajorFactionSchema = z.object({
  factionID: addonIdSchema,
  name: mediumAddonStringSchema.optional(),
  expansionID: nonNegativeIntegerSchema.max(100).optional(),
  isUnlocked: z.boolean().optional(),
  renownLevel: nonNegativeIntegerSchema.max(1000).optional(),
  renownReputationEarned: addonQuantitySchema.optional(),
  renownLevelThreshold: addonQuantitySchema.optional(),
  isWeeklyCapped: z.boolean().optional(),
});

export const snapshotMajorFactionsSchema = z.object({
  factions: z.array(snapshotMajorFactionSchema).max(addonIngestLimits.maxSnapshotMajorFactions),
});

export const snapshotClientInfoSchema = z.object({
  addonVersion: shortAddonStringSchema.optional(),
  interfaceVersion: addonIdSchema.optional(),
  gameVersion: shortAddonStringSchema.optional(),
  buildNumber: shortAddonStringSchema.optional(),
  buildDate: shortAddonStringSchema.optional(),
  tocVersion: addonIdSchema.optional(),
  expansion: shortAddonStringSchema.optional(),
  locale: z.string().trim().min(1).max(16).optional(),
});

export const statsSchema = z.object({
  stamina: statRatingSchema,
  strength: statRatingSchema,
  agility: statRatingSchema,
  intellect: statRatingSchema,
  critRating: statRatingSchema.optional(),
  critPercent: percentageSchema,
  hasteRating: statRatingSchema.optional(),
  hastePercent: percentageSchema,
  masteryRating: statRatingSchema.optional(),
  masteryPercent: percentageSchema,
  versatilityRating: statRatingSchema.optional(),
  versatilityPercent: percentageSchema,
  speedRating: statRatingSchema.optional(),
  speedPercent: percentageSchema.optional(),
  leechRating: statRatingSchema.optional(),
  leechPercent: percentageSchema.optional(),
  avoidanceRating: statRatingSchema.optional(),
  avoidancePercent: percentageSchema.optional(),
});

export const ownedKeystoneSchema = z.object({
  level: keystoneLevelSchema,
  mapChallengeModeID: addonIdSchema.optional(),
  mapName: mediumAddonStringSchema.optional(),
});

export const addonSignatureSchema = z.object({
  algorithm: z.literal("wd-djb2-32-v1"),
  installId: z.string().trim().min(8).max(64),
  secret: z.string().trim().min(16).max(128),
  payloadHash: z.string().trim().min(1).max(64),
  signature: z.string().trim().min(1).max(64),
  signedAt: unixSecondsSchema.optional(),
});

export const addonSnapshotSchema = z.object({
  takenAt: unixSecondsSchema,
  level: characterLevelSchema,
  spec: shortAddonStringSchema,
  role: snapshotRoleSchema,
  itemLevel: itemLevelSchema,
  gold: goldSchema,
  playtimeSeconds: playtimeSecondsSchema,
  playtimeThisLevelSeconds: playtimeSecondsSchema.optional(),
  mythicPlusScore: mythicPlusScoreSchema,
  seasonID: seasonIdSchema.optional(),
  ownedKeystone: ownedKeystoneSchema.optional(),
  currencies: currenciesSchema,
  currencyDetails: snapshotCurrencyDetailsSchema.optional(),
  stats: statsSchema,
  equipment: snapshotEquipmentSchema.optional(),
  weeklyRewards: snapshotWeeklyRewardsSchema.optional(),
  majorFactions: snapshotMajorFactionsSchema.optional(),
  clientInfo: snapshotClientInfoSchema.optional(),
  addonSignature: addonSignatureSchema.optional(),
});

export const addonMythicPlusRunMemberSchema = z.object({
  name: shortAddonStringSchema,
  realm: shortAddonStringSchema.optional(),
  classTag: shortAddonStringSchema.optional(),
  role: snapshotRoleSchema.optional(),
});

export const addonMythicPlusRunSchema = z
  .object({
    fingerprint: longAddonStringSchema,
    attemptId: mediumAddonStringSchema.optional(),
    canonicalKey: longAddonStringSchema.optional(),
    observedAt: unixSecondsSchema,
    seasonID: seasonIdSchema.optional(),
    mapChallengeModeID: addonIdSchema.optional(),
    mapName: mediumAddonStringSchema.optional(),
    level: keystoneLevelSchema.optional(),
    status: mythicPlusRunStatusSchema.optional(),
    completed: z.boolean().optional(),
    completedInTime: z.boolean().optional(),
    durationMs: durationMsSchema.optional(),
    runScore: mythicPlusScoreSchema.optional(),
    startDate: unixSecondsSchema.optional(),
    completedAt: unixSecondsSchema.optional(),
    endedAt: unixSecondsSchema.optional(),
    abandonedAt: unixSecondsSchema.optional(),
    abandonReason: mythicPlusAbandonReasonSchema.optional(),
    thisWeek: z.boolean().optional(),
    members: z
      .array(addonMythicPlusRunMemberSchema)
      .max(addonIngestLimits.maxMythicPlusRunMembers)
      .optional(),
    addonSignature: addonSignatureSchema.optional(),
  })
  .superRefine((run, ctx) => {
    const addIssue = (path: string, message: string) => {
      ctx.addIssue({
        code: "custom",
        path: [path],
        message,
      });
    };

    if (run.startDate !== undefined) {
      if (run.completedAt !== undefined && run.completedAt < run.startDate) {
        addIssue("completedAt", "completedAt cannot be before startDate");
      }
      if (run.endedAt !== undefined && run.endedAt < run.startDate) {
        addIssue("endedAt", "endedAt cannot be before startDate");
      }
      if (run.abandonedAt !== undefined && run.abandonedAt < run.startDate) {
        addIssue("abandonedAt", "abandonedAt cannot be before startDate");
      }
    }

    if (run.status === "active" && run.completed === true) {
      addIssue("completed", "active runs cannot be marked completed");
    }
    if (run.status === "completed" && run.completed === false) {
      addIssue("completed", "completed runs cannot be marked incomplete");
    }
    if (run.status === "abandoned" && run.completed === true) {
      addIssue("completed", "abandoned runs cannot be marked completed");
    }
  });

export const addonCharacterSchema = z.object({
  name: shortAddonStringSchema,
  realm: shortAddonStringSchema,
  region: characterRegionSchema,
  class: shortAddonStringSchema,
  race: shortAddonStringSchema,
  faction: characterFactionSchema,
  snapshots: z.array(addonSnapshotSchema).max(addonIngestLimits.maxSnapshotsPerCharacter),
  mythicPlusRuns: z
    .array(addonMythicPlusRunSchema)
    .max(addonIngestLimits.maxMythicPlusRunsPerCharacter)
    .optional(),
});

export const charactersLatestQuerySchema = z.object({
  characterId: z.array(z.string().uuid()).max(addonIngestLimits.maxCharactersLatestIds).default([]),
});

export const playerRouteParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CharacterRouteSlugParts = {
  name: string;
  realm: string;
};

const characterRouteUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatCharacterRouteSlugPart(value: string) {
  return value
    .trim()
    .normalize("NFKC")
    .replace(/[/?#\\]+/g, "-")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isCharacterUuid(value: string) {
  return characterRouteUuidPattern.test(value.trim());
}

export function createCharacterRouteSlug(character: CharacterRouteSlugParts) {
  return `${formatCharacterRouteSlugPart(character.name)}-${formatCharacterRouteSlugPart(
    character.realm,
  )}`;
}

export function createCharacterRouteId(character: CharacterRouteSlugParts) {
  return createCharacterRouteSlug(character);
}

export function parseCharacterRouteSlug(value: string): CharacterRouteSlugParts | null {
  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf("-");
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return null;
  }

  const name = trimmed.slice(0, separatorIndex);
  const realm = trimmed.slice(separatorIndex + 1);
  if (!name || !realm || /[/?#\\]/.test(trimmed)) {
    return null;
  }

  return { name, realm };
}

export function normalizeCharacterRouteLookupPart(value: string) {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s'’_-]+/g, "");
}

export const characterRouteParamsSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine((value) => isCharacterUuid(value) || parseCharacterRouteSlug(value) !== null, {
      message: "Expected a character UUID or Name-Realm route slug.",
    }),
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

export const mythicPlusRunSessionExternalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Use only letters, numbers, underscores, or dashes.");

const nullableMythicPlusRunSessionExternalIdSchema = z.preprocess((value) => {
  if (typeof value === "string" && value.trim().length === 0) {
    return null;
  }
  return value;
}, mythicPlusRunSessionExternalIdSchema.nullable());

export const createMythicPlusRunSessionBodySchema = z.object({
  runIds: z
    .array(z.string().uuid())
    .min(1)
    .max(50)
    .refine((runIds) => new Set(runIds).size === runIds.length, {
      message: "Run IDs must be unique.",
    }),
  isPaid: z.boolean().optional(),
  externalId: nullableMythicPlusRunSessionExternalIdSchema.optional(),
});

export const updateMythicPlusRunSessionPaidBodySchema = z.object({
  isPaid: z.boolean(),
});

export const updateMythicPlusRunSessionExternalIdBodySchema = z.object({
  externalId: nullableMythicPlusRunSessionExternalIdSchema,
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

export const updateCharacterVisibilityBodySchema = z.object({
  visibility: characterVisibilitySchema,
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
export type CreateMythicPlusRunSessionBody = z.infer<typeof createMythicPlusRunSessionBodySchema>;
export type UpdateMythicPlusRunSessionPaidBody = z.infer<
  typeof updateMythicPlusRunSessionPaidBodySchema
>;
export type UpdateMythicPlusRunSessionExternalIdBody = z.infer<
  typeof updateMythicPlusRunSessionExternalIdBodySchema
>;
export type UpdatePlayerDiscordBody = z.infer<typeof updatePlayerDiscordBodySchema>;
export type UpdateCharacterBoosterBody = z.infer<typeof updateCharacterBoosterBodySchema>;
export type UpdateCharacterSlotsBody = z.infer<typeof updateCharacterSlotsBodySchema>;
export type UpdateCharacterVisibilityBody = z.infer<typeof updateCharacterVisibilityBodySchema>;
export type CharacterVisibility = z.infer<typeof characterVisibilitySchema>;
export type AddonIngestBody = z.infer<typeof addonIngestBodySchema>;
export type AddonCharacterInput = z.infer<typeof addonCharacterSchema>;
export type AddonSnapshotInput = z.infer<typeof addonSnapshotSchema>;
export type AddonMythicPlusRunInput = z.infer<typeof addonMythicPlusRunSchema>;
