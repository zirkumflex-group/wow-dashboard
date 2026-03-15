import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { playersTable } from "./schemas/players";
import { charactersTable } from "./schemas/characters";
import { snapshotsTable } from "./schemas/snapshots";

export default defineSchema({
  players: playersTable,
  characters: charactersTable,
  snapshots: snapshotsTable,
  // Singleton that tracks which IDs were created by the seed so they can be
  // surgically removed on re-seed without touching real user data.
  seedMeta: defineTable({
    userId: v.string(),
    playerId: v.id("players"),
    characterIds: v.array(v.id("characters")),
  }),
});
