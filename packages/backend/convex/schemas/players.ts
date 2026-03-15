import { defineTable } from "convex/server";
import { v } from "convex/values";

export const playersTable = defineTable({
  userId: v.id("users"),
  battleTag: v.string(),
  region: v.union(v.literal("us"), v.literal("eu"), v.literal("kr"), v.literal("tw")),
}).index("by_user", ["userId"]);
