import { defineTable } from "convex/server";
import { v } from "convex/values";

export const snapshotsTable = defineTable({
  characterId: v.id("characters"),
  takenAt: v.number(),
  level: v.number(),
  spec: v.string(),
  role: v.union(v.literal("tank"), v.literal("healer"), v.literal("dps")),
  itemLevel: v.number(),
  gold: v.number(),
  playtimeSeconds: v.number(),
  mythicPlusScore: v.number(),
  currencies: v.object({
    adventurerDawncrest: v.number(),
    veteranDawncrest: v.number(),
    championDawncrest: v.number(),
    heroDawncrest: v.number(),
    mythDawncrest: v.number(),
    radiantSparkDust: v.number(),
  }),
  stats: v.object({
    stamina: v.number(),
    strength: v.number(),
    agility: v.number(),
    intellect: v.number(),
    critPercent: v.number(),
    hastePercent: v.number(),
    masteryPercent: v.number(),
    versatilityPercent: v.number(),
  }),
})
  .index("by_character", ["characterId"])
  .index("by_character_and_time", ["characterId", "takenAt"]);
