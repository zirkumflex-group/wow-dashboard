import { v } from "convex/values";

import { mutation } from "./_generated/server";
import { authComponent } from "./auth";
import { rateLimiter } from "./rateLimiter";
import { specValidator } from "./schemas/snapshots";

const currenciesValidator = v.object({
  adventurerDawncrest: v.number(),
  veteranDawncrest: v.number(),
  championDawncrest: v.number(),
  heroDawncrest: v.number(),
  mythDawncrest: v.number(),
  radiantSparkDust: v.number(),
});

const statsValidator = v.object({
  stamina: v.number(),
  strength: v.number(),
  agility: v.number(),
  intellect: v.number(),
  critPercent: v.number(),
  hastePercent: v.number(),
  masteryPercent: v.number(),
  versatilityPercent: v.number(),
});

const snapshotValidator = v.object({
  takenAt: v.number(),
  level: v.number(),
  spec: specValidator,
  role: v.union(v.literal("tank"), v.literal("healer"), v.literal("dps")),
  itemLevel: v.number(),
  gold: v.number(),
  playtimeSeconds: v.number(),
  mythicPlusScore: v.number(),
  currencies: currenciesValidator,
  stats: statsValidator,
});

const characterValidator = v.object({
  name: v.string(),
  realm: v.string(),
  region: v.union(v.literal("us"), v.literal("eu"), v.literal("kr"), v.literal("tw")),
  class: v.string(),
  race: v.string(),
  faction: v.union(v.literal("alliance"), v.literal("horde")),
  snapshots: v.array(snapshotValidator),
});

export const ingestAddonData = mutation({
  args: { characters: v.array(characterValidator) },
  handler: async (ctx, { characters }) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) throw new Error("Not authenticated");

    await rateLimiter.limit(ctx, "addonIngest", {
      key: authUser._id as string,
      throws: true,
    });

    const player = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", authUser._id as string))
      .first();

    if (!player) {
      throw new Error(
        "Player record not found — do a Battle.net sync first to create your player profile.",
      );
    }

    let newChars = 0;
    let newSnapshots = 0;

    for (const charData of characters) {
      const existing = await ctx.db
        .query("characters")
        .withIndex("by_player_and_realm", (q) =>
          q.eq("playerId", player._id).eq("realm", charData.realm),
        )
        .filter((q) => q.eq(q.field("name"), charData.name))
        .first();

      let characterId;

      if (!existing) {
        characterId = await ctx.db.insert("characters", {
          playerId: player._id,
          name: charData.name,
          realm: charData.realm,
          region: charData.region,
          class: charData.class,
          race: charData.race,
          faction: charData.faction,
        });
        newChars++;
      } else {
        await ctx.db.patch(existing._id, {
          region: charData.region,
          class: charData.class,
          race: charData.race,
          faction: charData.faction,
        });
        characterId = existing._id;
      }

      for (const snap of charData.snapshots) {
        const existingSnap = await ctx.db
          .query("snapshots")
          .withIndex("by_character_and_time", (q) =>
            q.eq("characterId", characterId).eq("takenAt", snap.takenAt),
          )
          .first();

        if (!existingSnap) {
          await ctx.db.insert("snapshots", {
            characterId,
            takenAt: snap.takenAt,
            level: snap.level,
            spec: snap.spec,
            role: snap.role,
            itemLevel: snap.itemLevel,
            gold: snap.gold,
            playtimeSeconds: snap.playtimeSeconds,
            mythicPlusScore: snap.mythicPlusScore,
            currencies: snap.currencies,
            stats: snap.stats,
          });
          newSnapshots++;
        }
      }
    }

    return { newChars, newSnapshots };
  },
});
