import { defineTable } from "convex/server";
import { v } from "convex/values";
import { ownedKeystoneValidator, specValidator } from "./snapshots";

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
  latestSnapshot: v.optional(latestSnapshotSummaryValidator),
})
  .index("by_player", ["playerId"])
  .index("by_player_and_realm", ["playerId", "realm"]);
