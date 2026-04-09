import { defineTable } from "convex/server";
import { v } from "convex/values";

const mythicPlusRunMemberFields = {
  name: v.string(),
  realm: v.optional(v.string()),
  classTag: v.optional(v.string()),
  role: v.optional(v.union(v.literal("tank"), v.literal("healer"), v.literal("dps"))),
} as const;

export const mythicPlusRunMemberValidator = v.object(mythicPlusRunMemberFields);

const mythicPlusRunFields = {
  fingerprint: v.string(),
  observedAt: v.number(),
  seasonID: v.optional(v.number()),
  mapChallengeModeID: v.optional(v.number()),
  mapName: v.optional(v.string()),
  level: v.optional(v.number()),
  completed: v.optional(v.boolean()),
  completedInTime: v.optional(v.boolean()),
  durationMs: v.optional(v.number()),
  runScore: v.optional(v.number()),
  startDate: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  thisWeek: v.optional(v.boolean()),
  members: v.optional(v.array(mythicPlusRunMemberValidator)),
} as const;

export const mythicPlusRunValidator = v.object(mythicPlusRunFields);

export const mythicPlusRunsTable = defineTable({
  characterId: v.id("characters"),
  ...mythicPlusRunFields,
})
  .index("by_character", ["characterId"])
  .index("by_character_and_fingerprint", ["characterId", "fingerprint"])
  .index("by_character_and_observedAt", ["characterId", "observedAt"]);
