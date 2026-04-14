import { defineTable } from "convex/server";
import { v } from "convex/values";
import { ownedKeystoneValidator, specValidator } from "./snapshots";

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
  firstSnapshotAt: v.optional(v.number()),
  snapshotCount: v.optional(v.number()),
})
  .index("by_player", ["playerId"])
  .index("by_player_and_realm", ["playerId", "realm"])
  .index("by_booster", ["isBooster"]);
