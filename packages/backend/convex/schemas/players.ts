import { defineTable } from "convex/server";
import { v } from "convex/values";

export const playersTable = defineTable({
  userId: v.string(),
  battleTag: v.string(),
  discordUserId: v.optional(v.string()),
}).index("by_user", ["userId"]);
