import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

export const upsertFromBattleNet = internalMutation({
  args: {
    userId: v.string(),
    region: v.union(v.literal("us"), v.literal("eu"), v.literal("kr"), v.literal("tw")),
    characters: v.array(
      v.object({
        name: v.string(),
        realm: v.string(),
        class: v.string(),
        race: v.string(),
        faction: v.union(v.literal("alliance"), v.literal("horde")),
      }),
    ),
  },
  handler: async (ctx, { userId, region, characters }) => {
    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (!player) return;

    for (const char of characters) {
      const existing = await ctx.db
        .query("characters")
        .withIndex("by_player_and_realm", (q) =>
          q.eq("playerId", player._id).eq("realm", char.realm),
        )
        .filter((q) => q.eq(q.field("name"), char.name))
        .first();

      if (!existing) {
        await ctx.db.insert("characters", {
          playerId: player._id,
          name: char.name,
          realm: char.realm,
          region,
          class: char.class,
          race: char.race,
          faction: char.faction,
        });
      } else {
        await ctx.db.patch(existing._id, {
          class: char.class,
          race: char.race,
          faction: char.faction,
        });
      }
    }
  },
});

export const resyncCharacters = mutation({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return;

    const account = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "account",
      where: [
        { field: "userId", value: authUser._id as string },
        { field: "providerId", value: "battlenet" },
      ],
    });

    if (!account?.accessToken) return;

    await ctx.scheduler.runAfter(0, internal.battlenet.syncCharacters, {
      userId: authUser._id as string,
      accessToken: account.accessToken as string,
    });
  },
});

export const getMyCharactersWithSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;

    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", authUser._id as string))
      .first();

    if (!player) return null;

    const characters = await ctx.db
      .query("characters")
      .withIndex("by_player", (q) => q.eq("playerId", player._id))
      .collect();

    return await Promise.all(
      characters.map(async (char) => {
        const snapshot = await ctx.db
          .query("snapshots")
          .withIndex("by_character_and_time", (q) => q.eq("characterId", char._id))
          .order("desc")
          .first();
        return { ...char, snapshot: snapshot ?? null };
      }),
    );
  },
});
