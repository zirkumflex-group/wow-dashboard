import { inArray } from "drizzle-orm";
import { snapshots } from "@wow-dashboard/db";
import { db } from "../db";

const deleteChunkSize = 500;

function snapshotKey(snapshot: typeof snapshots.$inferSelect): string {
  return JSON.stringify({
    characterId: snapshot.characterId,
    level: snapshot.level,
    spec: snapshot.spec,
    role: snapshot.role,
    itemLevel: snapshot.itemLevel,
    gold: snapshot.gold,
    playtimeSeconds: snapshot.playtimeSeconds,
    ...(snapshot.playtimeThisLevelSeconds != null
      ? {
          playtimeThisLevelSeconds: snapshot.playtimeThisLevelSeconds,
        }
      : {}),
    mythicPlusScore: snapshot.mythicPlusScore,
    ...(snapshot.ownedKeystone
      ? {
          ownedKeystone: snapshot.ownedKeystone,
        }
      : {}),
    currencies: snapshot.currencies,
    stats: snapshot.stats,
  });
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

export async function deduplicateSnapshots() {
  const allSnapshots = await db.query.snapshots.findMany();
  const sortedSnapshots = allSnapshots
    .slice()
    .sort((left, right) => left.takenAt.getTime() - right.takenAt.getTime());

  const seen = new Map<string, string>();
  const duplicateIds: string[] = [];

  for (const snapshot of sortedSnapshots) {
    const key = snapshotKey(snapshot);
    if (seen.has(key)) {
      duplicateIds.push(snapshot.id);
      continue;
    }

    seen.set(key, snapshot.id);
  }

  for (const ids of chunk(duplicateIds, deleteChunkSize)) {
    await db.delete(snapshots).where(inArray(snapshots.id, ids));
  }

  return {
    deleted: duplicateIds.length,
    total: allSnapshots.length,
  };
}
