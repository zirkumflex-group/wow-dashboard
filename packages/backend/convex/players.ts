import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

export const upsertFromBattleNet = internalMutation({
  args: {
    userId: v.string(),
    battleTag: v.string(),
  },
  handler: async (ctx, { userId, battleTag }) => {
    const existing = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) return;

    await ctx.db.insert("players", {
      userId,
      battleTag,
    });
  },
});
