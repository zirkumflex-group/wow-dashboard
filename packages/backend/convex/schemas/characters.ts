import { defineTable } from "convex/server";
import { v } from "convex/values";

export const charactersTable = defineTable({
  playerId: v.id("players"),
  name: v.string(),
  realm: v.string(),
  class: v.string(),
  race: v.string(),
  faction: v.union(v.literal("alliance"), v.literal("horde")),
})
  .index("by_player", ["playerId"])
  .index("by_player_and_realm", ["playerId", "realm"]);
