import { inArray } from "drizzle-orm";
import { snapshots } from "@wow-dashboard/db";
import { db } from "../db";

const deleteChunkSize = 500;

function snapshotIdentityKey(snapshot: typeof snapshots.$inferSelect): string {
  return JSON.stringify({
    characterId: snapshot.characterId,
    takenAt: snapshot.takenAt.toISOString(),
  });
}

function snapshotCompletenessScore(snapshot: typeof snapshots.$inferSelect): number {
  let score = 0;

  if (snapshot.playtimeThisLevelSeconds !== null) score += 1;
  if (snapshot.ownedKeystone) score += 1;
  if (snapshot.stats.speedPercent !== undefined) score += 2;
  if (snapshot.stats.leechPercent !== undefined) score += 2;
  if (snapshot.stats.avoidancePercent !== undefined) score += 2;

  return score;
}

function shouldReplaceSnapshot(
  currentSnapshot: typeof snapshots.$inferSelect | undefined,
  candidateSnapshot: typeof snapshots.$inferSelect,
): boolean {
  if (!currentSnapshot) {
    return true;
  }

  const currentScore = snapshotCompletenessScore(currentSnapshot);
  const candidateScore = snapshotCompletenessScore(candidateSnapshot);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  return candidateSnapshot.id.localeCompare(currentSnapshot.id) < 0;
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
  const keptByIdentity = new Map<string, typeof snapshots.$inferSelect>();
  const duplicateIds: string[] = [];

  for (const snapshot of allSnapshots) {
    const identityKey = snapshotIdentityKey(snapshot);
    const currentSnapshot = keptByIdentity.get(identityKey);
    if (!currentSnapshot) {
      keptByIdentity.set(identityKey, snapshot);
      continue;
    }

    if (shouldReplaceSnapshot(currentSnapshot, snapshot)) {
      duplicateIds.push(currentSnapshot.id);
      keptByIdentity.set(identityKey, snapshot);
      continue;
    }

    duplicateIds.push(snapshot.id);
  }

  for (const ids of chunk(duplicateIds, deleteChunkSize)) {
    await db.delete(snapshots).where(inArray(snapshots.id, ids));
  }

  return {
    deleted: duplicateIds.length,
    total: allSnapshots.length,
  };
}
