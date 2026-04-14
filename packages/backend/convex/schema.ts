import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { playersTable } from "./schemas/players";
import { charactersTable } from "./schemas/characters";
import { characterDailySnapshotsTable } from "./schemas/characterDailySnapshots";
import { mythicPlusRunsTable } from "./schemas/mythicPlusRuns";
import { snapshotsTable } from "./schemas/snapshots";

export default defineSchema({
  players: playersTable,
  characters: charactersTable,
  characterDailySnapshots: characterDailySnapshotsTable,
  mythicPlusRuns: mythicPlusRunsTable,
  snapshots: snapshotsTable,
  // Singleton that tracks which IDs were created by the seed so they can be
  // surgically removed on re-seed without touching real user data.
  seedMeta: defineTable({
    userId: v.string(),
    playerId: v.id("players"),
    characterIds: v.array(v.id("characters")),
  }),
  // Full audit trail of auth events, data mutations, and errors.
  auditLog: defineTable({
    userId: v.optional(v.string()),
    event: v.string(),
    metadata: v.optional(v.any()),
    error: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_user_and_time", ["userId", "timestamp"])
    .index("by_time", ["timestamp"]),
  // Short-lived one-time codes used for the Electron OAuth token handoff.
  loginCodes: defineTable({
    code: v.string(),
    token: v.string(),
    expiresAt: v.number(),
    used: v.boolean(),
  }).index("by_code", ["code"]),
});
