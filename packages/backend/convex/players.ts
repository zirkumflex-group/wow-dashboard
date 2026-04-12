import { v } from "convex/values";

import { internalMutation, mutation } from "./_generated/server";
import { authComponent } from "./auth";

function normalizeDiscordUserId(discordUserId: string | null) {
  if (discordUserId === null) {
    return null;
  }

  const trimmedDiscordUserId = discordUserId.trim();
  if (trimmedDiscordUserId === "") {
    return null;
  }

  const mentionMatch = trimmedDiscordUserId.match(/^<@!?(\d+)>$/);
  const normalizedDiscordUserId = mentionMatch?.[1] ?? trimmedDiscordUserId;

  if (!/^\d{5,30}$/.test(normalizedDiscordUserId)) {
    throw new Error("Discord ID must be a numeric user ID or mention.");
  }

  return normalizedDiscordUserId;
}

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

export const setPlayerDiscordUserId = mutation({
  args: {
    playerId: v.id("players"),
    discordUserId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { playerId, discordUserId }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) {
      throw new Error("Unauthorized");
    }

    const player = await ctx.db.get(playerId);
    if (!player) {
      throw new Error("Player not found.");
    }

    await ctx.db.patch(playerId, {
      discordUserId: normalizeDiscordUserId(discordUserId) ?? undefined,
    });

    return {
      playerId,
      discordUserId: normalizeDiscordUserId(discordUserId),
    };
  },
});
