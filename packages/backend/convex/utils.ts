import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function deleteSeedCharacterData(ctx: MutationCtx, characterIds: Id<"characters">[]) {
  for (const charId of characterIds) {
    const mythicPlusRuns = await ctx.db
      .query("mythicPlusRuns")
      .withIndex("by_character", (q) => q.eq("characterId", charId))
      .collect();
    const snapshots = await ctx.db
      .query("snapshots")
      .withIndex("by_character", (q) => q.eq("characterId", charId))
      .collect();
    await Promise.all(mythicPlusRuns.map((run) => ctx.db.delete(run._id)));
    await Promise.all(snapshots.map((s) => ctx.db.delete(s._id)));
    await ctx.db.delete(charId);
  }
}

// ---------------------------------------------------------------------------
// seed — wipe only previously seeded records, then recreate them
// ---------------------------------------------------------------------------

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find existing seed metadata (singleton)
    const meta = await ctx.db.query("seedMeta").first();

    if (meta) {
      // Delete seed characters + their snapshots
      await deleteSeedCharacterData(ctx, meta.characterIds);

      // Delete seed player
      await ctx.db.delete(meta.playerId);

      // Delete seed user from the betterAuth component
      await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
        input: {
          model: "user",
          where: [{ field: "_id", value: meta.userId }],
        },
      });

      // Remove old meta so we write a fresh one below
      await ctx.db.delete(meta._id);
    }

    // Create betterAuth user
    const user = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Arthas#1337",
          email: "12345678.Arthas-1337@battlenet.local",
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    const playerId = await ctx.db.insert("players", {
      userId: user._id as string,
      battleTag: "Arthas#1337",
    });

    // Character 1 — Protection Warrior, Stormrage, US, Alliance
    const char1Id = await ctx.db.insert("characters", {
      playerId,
      name: "Arthas",
      realm: "Stormrage",
      region: "us",
      class: "Warrior",
      race: "Human",
      faction: "alliance",
    });

    // Character 2 — Restoration Shaman, Illidan, US, Horde
    const char2Id = await ctx.db.insert("characters", {
      playerId,
      name: "Thrallbane",
      realm: "Illidan",
      region: "us",
      class: "Shaman",
      race: "Orc",
      faction: "horde",
    });

    const DAY = 86_400_000;

    for (let i = 0; i < 10; i++) {
      const takenAt = now - (9 - i) * DAY;

      await ctx.db.insert("snapshots", {
        characterId: char1Id,
        takenAt,
        level: 80,
        spec: "Protection",
        role: "tank",
        itemLevel: 610 + i * 2,
        gold: 50_000 + i * 1_200,
        playtimeSeconds: 3_600_000 + i * 7_200,
        playtimeThisLevelSeconds: 18_000 + i * 300,
        mythicPlusScore: 2800 + i * 30,
        currencies: {
          adventurerDawncrest: 1500 - i * 20,
          veteranDawncrest: 1200 - i * 15,
          championDawncrest: 900 - i * 10,
          heroDawncrest: 600 - i * 8,
          mythDawncrest: 300 - i * 5,
          radiantSparkDust: 120 + i * 3,
        },
        stats: {
          stamina: 98_000 + i * 500,
          strength: 12_000 + i * 100,
          agility: 4_000,
          intellect: 3_500,
          critPercent: 18.5 + i * 0.2,
          hastePercent: 14.0 + i * 0.15,
          masteryPercent: 22.0 + i * 0.1,
          versatilityPercent: 8.0 + i * 0.05,
          speedPercent: 4.8 + i * 0.02,
          leechPercent: 2.1 + i * 0.03,
          avoidancePercent: 1.4 + i * 0.02,
        },
      });

      await ctx.db.insert("snapshots", {
        characterId: char2Id,
        takenAt,
        level: 80,
        spec: "Restoration",
        role: "healer",
        itemLevel: 605 + i * 2,
        gold: 30_000 + i * 800,
        playtimeSeconds: 2_400_000 + i * 5_400,
        playtimeThisLevelSeconds: 14_400 + i * 240,
        mythicPlusScore: 2600 + i * 25,
        currencies: {
          adventurerDawncrest: 1400 - i * 18,
          veteranDawncrest: 1100 - i * 12,
          championDawncrest: 850 - i * 9,
          heroDawncrest: 550 - i * 7,
          mythDawncrest: 250 - i * 4,
          radiantSparkDust: 100 + i * 4,
        },
        stats: {
          stamina: 92_000 + i * 450,
          strength: 3_200,
          agility: 3_800,
          intellect: 14_500 + i * 120,
          critPercent: 20.0 + i * 0.25,
          hastePercent: 19.5 + i * 0.2,
          masteryPercent: 16.0 + i * 0.1,
          versatilityPercent: 10.0 + i * 0.08,
          speedPercent: 3.2 + i * 0.03,
          leechPercent: 0,
          avoidancePercent: 1.1 + i * 0.02,
        },
      });
    }

    // Persist seed metadata for future runs
    await ctx.db.insert("seedMeta", {
      userId: user._id,
      playerId,
      characterIds: [char1Id, char2Id],
    });
  },
});

// ---------------------------------------------------------------------------
// deleteSeedCharacters — remove only the seeded characters + their snapshots
// ---------------------------------------------------------------------------

export const deleteSeedCharacters = internalMutation({
  args: {},
  handler: async (ctx) => {
    const meta = await ctx.db.query("seedMeta").first();
    if (!meta) return;

    await deleteSeedCharacterData(ctx, meta.characterIds);

    await ctx.db.patch(meta._id, { characterIds: [] });
  },
});
