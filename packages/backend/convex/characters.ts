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

export const getCharacterSnapshots = query({
  args: { characterId: v.id("characters") },
  handler: async (ctx, { characterId }) => {
    const character = await ctx.db.get(characterId);
    if (!character) return null;

    const snapshots = await ctx.db
      .query("snapshots")
      .withIndex("by_character_and_time", (q) => q.eq("characterId", characterId))
      .order("asc")
      .collect();

    return { character, snapshots };
  },
});

export const getScoreboard = query({
  args: {},
  handler: async (ctx) => {
    const characters = await ctx.db.query("characters").collect();

    const withSnapshots = await Promise.all(
      characters.map(async (char) => {
        const snapshot = await ctx.db
          .query("snapshots")
          .withIndex("by_character_and_time", (q) => q.eq("characterId", char._id))
          .order("desc")
          .first();
        if (!snapshot) return null;

        const player = await ctx.db.get(char.playerId);
        return {
          characterId: char._id,
          name: char.name,
          realm: char.realm,
          region: char.region,
          class: char.class,
          race: char.race,
          faction: char.faction,
          battleTag: player?.battleTag ?? "Unknown",
          mythicPlusScore: snapshot.mythicPlusScore,
          itemLevel: snapshot.itemLevel,
          spec: snapshot.spec,
          role: snapshot.role,
          level: snapshot.level,
          takenAt: snapshot.takenAt,
        };
      }),
    );

    return withSnapshots
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.mythicPlusScore - a.mythicPlusScore || b.itemLevel - a.itemLevel);
  },
});

export const getPlayerScoreboard = query({
  args: {},
  handler: async (ctx) => {
    const characters = await ctx.db.query("characters").collect();

    const playerMap = new Map<
      string,
      { battleTag: string; totalPlaytimeSeconds: number; totalGold: number; characterCount: number }
    >();

    await Promise.all(
      characters.map(async (char) => {
        const snapshot = await ctx.db
          .query("snapshots")
          .withIndex("by_character_and_time", (q) => q.eq("characterId", char._id))
          .order("desc")
          .first();
        if (!snapshot) return;

        const player = await ctx.db.get(char.playerId);
        const battleTag = player?.battleTag ?? "Unknown";
        const playerId = char.playerId.toString();

        const existing = playerMap.get(playerId);
        if (existing) {
          existing.totalPlaytimeSeconds += snapshot.playtimeSeconds;
          existing.totalGold += snapshot.gold;
          existing.characterCount += 1;
        } else {
          playerMap.set(playerId, {
            battleTag,
            totalPlaytimeSeconds: snapshot.playtimeSeconds,
            totalGold: snapshot.gold,
            characterCount: 1,
          });
        }
      }),
    );

    return Array.from(playerMap.values()).sort(
      (a, b) => b.totalPlaytimeSeconds - a.totalPlaytimeSeconds || b.totalGold - a.totalGold,
    );
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
