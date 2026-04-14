import { defineTable } from "convex/server";
import { v } from "convex/values";

export const characterDailySnapshotsTable = defineTable({
  characterId: v.id("characters"),
  dayStartAt: v.number(),
  lastTakenAt: v.number(),
  itemLevel: v.number(),
  gold: v.number(),
  playtimeSeconds: v.number(),
  mythicPlusScore: v.number(),
})
  .index("by_character", ["characterId"])
  .index("by_character_and_day", ["characterId", "dayStartAt"]);
