import { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

function snapshotKey(snap: {
  characterId: string;
  level: number;
  spec: string;
  role: string;
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  mythicPlusScore: number;
  currencies: {
    adventurerDawncrest: number;
    veteranDawncrest: number;
    championDawncrest: number;
    heroDawncrest: number;
    mythDawncrest: number;
    radiantSparkDust: number;
  };
  stats: {
    stamina: number;
    strength: number;
    agility: number;
    intellect: number;
    critPercent: number;
    hastePercent: number;
    masteryPercent: number;
    versatilityPercent: number;
  };
}): string {
  return JSON.stringify({
    characterId: snap.characterId,
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
}

export const deduplicateSnapshots = internalMutation({
  args: {},
  handler: async (ctx) => {
    const snapshots = await ctx.db.query("snapshots").collect();

    // Group snapshots by their content key (excluding _id, _creationTime, takenAt)
    const seen = new Map<string, Id<"snapshots">>();
    const toDelete: Id<"snapshots">[] = [];

    // Sort by takenAt ascending so we keep the earliest snapshot
    const sorted = snapshots.slice().sort((a, b) => a.takenAt - b.takenAt);

    for (const snap of sorted) {
      const key = snapshotKey(snap);
      if (seen.has(key)) {
        toDelete.push(snap._id);
      } else {
        seen.set(key, snap._id);
      }
    }

    for (const id of toDelete) {
      await ctx.db.delete(id);
    }

    return { deleted: toDelete.length, total: snapshots.length };
  },
});
