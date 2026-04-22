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
export const mythicPlusRunStatusValues = ["active", "completed", "abandoned"] as const;
export const mythicPlusAbandonReasonValues = [
  "challenge_mode_reset",
  "left_instance",
  "leaver_timer",
  "history_incomplete",
  "stale_recovery",
  "unknown",
] as const;

export const nonTradeableSlotSchema = z.enum(nonTradeableSlotValues);
export const characterRegionSchema = z.enum(characterRegionValues);
export const characterFactionSchema = z.enum(characterFactionValues);
export const snapshotRoleSchema = z.enum(snapshotRoleValues);
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

export const statsSchema = z.object({
  stamina: z.number(),
  strength: z.number(),
  agility: z.number(),
  intellect: z.number(),
  critPercent: z.number(),
  hastePercent: z.number(),
  masteryPercent: z.number(),
  versatilityPercent: z.number(),
  speedPercent: z.number().optional(),
  leechPercent: z.number().optional(),
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
  ownedKeystone: ownedKeystoneSchema.optional(),
  currencies: currenciesSchema,
  stats: statsSchema,
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
  members: z.array(addonMythicPlusRunMemberSchema).optional(),
});

export const addonCharacterSchema = z.object({
  name: z.string(),
  realm: z.string(),
  region: characterRegionSchema,
  class: z.string(),
  race: z.string(),
  faction: characterFactionSchema,
  snapshots: z.array(addonSnapshotSchema),
  mythicPlusRuns: z.array(addonMythicPlusRunSchema).optional(),
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
  characters: z.array(addonCharacterSchema),
});

export type CharactersLatestQuery = z.infer<typeof charactersLatestQuerySchema>;
export type PlayerRouteParams = z.infer<typeof playerRouteParamsSchema>;
export type CharacterRouteParams = z.infer<typeof characterRouteParamsSchema>;
export type UpdatePlayerDiscordBody = z.infer<typeof updatePlayerDiscordBodySchema>;
export type UpdateCharacterBoosterBody = z.infer<typeof updateCharacterBoosterBodySchema>;
export type UpdateCharacterSlotsBody = z.infer<typeof updateCharacterSlotsBodySchema>;
export type AddonIngestBody = z.infer<typeof addonIngestBodySchema>;
export type AddonCharacterInput = z.infer<typeof addonCharacterSchema>;
export type AddonSnapshotInput = z.infer<typeof addonSnapshotSchema>;
export type AddonMythicPlusRunInput = z.infer<typeof addonMythicPlusRunSchema>;
