import { defineTable } from "convex/server";
import { v } from "convex/values";
import { mythicPlusRunMemberValidator } from "./mythicPlusRuns";
import {
  currenciesValidator,
  ownedKeystoneValidator,
  specValidator,
  statsValidator,
} from "./snapshots";

export const nonTradeableSlotValidator = v.union(
  v.literal("head"),
  v.literal("shoulders"),
  v.literal("chest"),
  v.literal("wrist"),
  v.literal("hands"),
  v.literal("waist"),
  v.literal("legs"),
  v.literal("feet"),
  v.literal("neck"),
  v.literal("back"),
  v.literal("finger1"),
  v.literal("finger2"),
  v.literal("trinket1"),
  v.literal("trinket2"),
  v.literal("mainHand"),
  v.literal("offHand"),
);

const latestSnapshotSummaryValidator = v.object({
  takenAt: v.number(),
  level: v.number(),
  spec: specValidator,
  role: v.union(v.literal("tank"), v.literal("healer"), v.literal("dps")),
  itemLevel: v.number(),
  gold: v.number(),
  playtimeSeconds: v.number(),
  playtimeThisLevelSeconds: v.optional(v.number()),
  mythicPlusScore: v.number(),
  ownedKeystone: v.optional(ownedKeystoneValidator),
});

const latestSnapshotDetailsValidator = v.object({
  takenAt: v.number(),
  level: v.number(),
  spec: specValidator,
  role: v.union(v.literal("tank"), v.literal("healer"), v.literal("dps")),
  itemLevel: v.number(),
  gold: v.number(),
  playtimeSeconds: v.number(),
  playtimeThisLevelSeconds: v.optional(v.number()),
  mythicPlusScore: v.number(),
  ownedKeystone: v.optional(ownedKeystoneValidator),
  currencies: currenciesValidator,
  stats: statsValidator,
});

const mythicPlusBucketSummaryValidator = v.object({
  totalRuns: v.number(),
  totalAttempts: v.optional(v.number()),
  completedRuns: v.number(),
  abandonedRuns: v.optional(v.number()),
  activeRuns: v.optional(v.number()),
  timedRuns: v.number(),
  timed2To9: v.number(),
  timed10To11: v.number(),
  timed12To13: v.number(),
  timed14Plus: v.number(),
  bestLevel: v.union(v.number(), v.null()),
  bestTimedLevel: v.union(v.number(), v.null()),
  bestTimedUpgradeCount: v.union(v.number(), v.null()),
  bestTimedScore: v.union(v.number(), v.null()),
  bestTimedDurationMs: v.union(v.number(), v.null()),
  bestScore: v.union(v.number(), v.null()),
  averageLevel: v.union(v.number(), v.null()),
  averageScore: v.union(v.number(), v.null()),
  lastRunAt: v.union(v.number(), v.null()),
});

const mythicPlusDungeonSummaryValidator = v.object({
  mapChallengeModeID: v.union(v.number(), v.null()),
  mapName: v.string(),
  totalRuns: v.number(),
  timedRuns: v.number(),
  bestLevel: v.union(v.number(), v.null()),
  bestTimedLevel: v.union(v.number(), v.null()),
  bestTimedUpgradeCount: v.union(v.number(), v.null()),
  bestTimedScore: v.union(v.number(), v.null()),
  bestTimedDurationMs: v.union(v.number(), v.null()),
  bestScore: v.union(v.number(), v.null()),
  lastRunAt: v.union(v.number(), v.null()),
});

const mythicPlusSummaryValidator = v.object({
  latestSeasonID: v.union(v.number(), v.null()),
  currentScore: v.union(v.number(), v.null()),
  overall: mythicPlusBucketSummaryValidator,
  currentSeason: v.union(mythicPlusBucketSummaryValidator, v.null()),
  currentSeasonDungeons: v.array(mythicPlusDungeonSummaryValidator),
});

const mythicPlusRecentRunPreviewValidator = v.object({
  _id: v.optional(v.id("mythicPlusRuns")),
  _creationTime: v.optional(v.number()),
  characterId: v.optional(v.id("characters")),
  rowKey: v.string(),
  fingerprint: v.string(),
  attemptId: v.optional(v.string()),
  canonicalKey: v.optional(v.string()),
  observedAt: v.number(),
  playedAt: v.number(),
  sortTimestamp: v.number(),
  seasonID: v.optional(v.number()),
  mapChallengeModeID: v.optional(v.number()),
  mapName: v.optional(v.string()),
  level: v.optional(v.number()),
  status: v.optional(
    v.union(v.literal("active"), v.literal("completed"), v.literal("abandoned")),
  ),
  completed: v.optional(v.boolean()),
  completedInTime: v.optional(v.boolean()),
  durationMs: v.optional(v.number()),
  runScore: v.optional(v.number()),
  startDate: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  abandonedAt: v.optional(v.number()),
  abandonReason: v.optional(
    v.union(
      v.literal("challenge_mode_reset"),
      v.literal("left_instance"),
      v.literal("leaver_timer"),
      v.literal("history_incomplete"),
      v.literal("stale_recovery"),
      v.literal("unknown"),
    ),
  ),
  thisWeek: v.optional(v.boolean()),
  members: v.optional(v.array(mythicPlusRunMemberValidator)),
  upgradeCount: v.union(v.number(), v.null()),
  scoreIncrease: v.union(v.number(), v.null()),
});

export const charactersTable = defineTable({
  playerId: v.id("players"),
  name: v.string(),
  realm: v.string(),
  region: v.union(v.literal("us"), v.literal("eu"), v.literal("kr"), v.literal("tw")),
  class: v.string(),
  race: v.string(),
  faction: v.union(v.literal("alliance"), v.literal("horde")),
  isBooster: v.optional(v.boolean()),
  nonTradeableSlots: v.optional(v.array(nonTradeableSlotValidator)),
  latestSnapshot: v.optional(latestSnapshotSummaryValidator),
  latestSnapshotDetails: v.optional(latestSnapshotDetailsValidator),
  mythicPlusSummary: v.optional(mythicPlusSummaryValidator),
  mythicPlusRecentRunsPreview: v.optional(v.array(mythicPlusRecentRunPreviewValidator)),
  mythicPlusRunCount: v.optional(v.number()),
  firstSnapshotAt: v.optional(v.number()),
  snapshotCount: v.optional(v.number()),
})
  .index("by_player", ["playerId"])
  .index("by_player_and_realm", ["playerId", "realm"])
  .index("by_booster", ["isBooster"]);
