import { and, eq } from "drizzle-orm";
import type { AddonCharacterInput } from "@wow-dashboard/api-schema";
import {
  characterDailySnapshots,
  characters,
  mythicPlusRuns,
  players,
  snapshotSpecs,
  snapshots,
  type Currencies,
  type LatestSnapshotDetails,
  type LatestSnapshotSummary,
  type MythicPlusRecentRunPreview,
  type MythicPlusSummary,
  type OwnedKeystone,
  type SnapshotRole,
  type SnapshotSpec,
  type Stats,
} from "@wow-dashboard/db";
import { db } from "../db";
import { insertAuditEvent } from "../lib/audit";
import { limitAddonIngest } from "../lib/rateLimit";
import {
  buildCanonicalMythicPlusRunFingerprint,
  buildMythicPlusSummary,
  buildRecentRuns,
  canUseMythicPlusRunCompatibilityAliasMatch,
  dedupeMythicPlusRuns,
  getMythicPlusRunAttemptId,
  getMythicPlusRunCanonicalKey,
  getMythicPlusRunCompatibilityLookupAliases,
  getMythicPlusRunLifecycleStatus,
  mergeMythicPlusRunMembers,
  shouldReplaceMythicPlusRun,
  type MythicPlusRunDocument,
} from "./mythicPlus";

type DbExecutor = Pick<typeof db, "delete" | "insert" | "query" | "update">;
type SnapshotRow = typeof snapshots.$inferSelect;
type CharacterDailySnapshotRow = typeof characterDailySnapshots.$inferSelect;
type MythicPlusRunRow = typeof mythicPlusRuns.$inferSelect;

type SnapshotFields = {
  takenAt: number;
  level: number;
  spec: SnapshotSpec;
  role: SnapshotRole;
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  playtimeThisLevelSeconds?: number;
  mythicPlusScore: number;
  ownedKeystone?: OwnedKeystone;
  currencies: Currencies;
  stats: Stats;
};

type MythicPlusRunInputDocument = MythicPlusRunDocument;
type MythicPlusRunPatch = {
  fingerprint?: string;
  attemptId?: string;
  canonicalKey?: string;
  observedAt?: number;
  seasonID?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  level?: number;
  status?: MythicPlusRunDocument["status"];
  completed?: boolean;
  completedInTime?: boolean;
  durationMs?: number;
  runScore?: number;
  startDate?: number;
  completedAt?: number;
  endedAt?: number;
  abandonedAt?: number;
  abandonReason?: MythicPlusRunDocument["abandonReason"];
  thisWeek?: boolean;
  members?: MythicPlusRunDocument["members"];
};

type ExistingRunLookups = {
  byAttemptId: Map<string, MythicPlusRunDocument>;
  byCanonicalKey: Map<string, MythicPlusRunDocument>;
  byCompatibilityAlias: Map<string, MythicPlusRunDocument>;
  byId: Map<string, MythicPlusRunDocument>;
};

const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_PAST_MS = 30 * 24 * 60 * 60 * 1000;
const LEGACY_DST_SHIFT_SECONDS = 60 * 60;
const LEGACY_DST_SHIFT_TOLERANCE_SECONDS = 2 * 60;
const MYTHIC_PLUS_PREVIEW_RUN_LIMIT = 20;
const validSnapshotSpecNames = new Set<string>(snapshotSpecs);

export class AddonIngestServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AddonIngestServiceError";
  }
}

function isUniqueConstraintViolation(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function normalizeSnapshotSpec(value: string): SnapshotSpec | null {
  const normalized = value.trim();
  if (normalized === "" || normalized === "Unknown") {
    return null;
  }

  return validSnapshotSpecNames.has(normalized) ? (normalized as SnapshotSpec) : null;
}

function toUnixSeconds(value: Date | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  return Math.floor(value);
}

function fromUnixSeconds(value: number): Date {
  return new Date(value * 1000);
}

function toSnapshotFields(snapshot: SnapshotFields): SnapshotFields {
  return {
    takenAt: snapshot.takenAt,
    level: snapshot.level,
    spec: snapshot.spec,
    role: snapshot.role,
    itemLevel: snapshot.itemLevel,
    gold: snapshot.gold,
    playtimeSeconds: snapshot.playtimeSeconds,
    playtimeThisLevelSeconds: snapshot.playtimeThisLevelSeconds,
    mythicPlusScore: snapshot.mythicPlusScore,
    ownedKeystone: snapshot.ownedKeystone,
    currencies: snapshot.currencies,
    stats: snapshot.stats,
  };
}

function snapshotRowToFields(snapshot: SnapshotRow): SnapshotFields {
  return {
    takenAt: toUnixSeconds(snapshot.takenAt)!,
    level: snapshot.level,
    spec: snapshot.spec,
    role: snapshot.role,
    itemLevel: snapshot.itemLevel,
    gold: snapshot.gold,
    playtimeSeconds: snapshot.playtimeSeconds,
    ...(snapshot.playtimeThisLevelSeconds !== null
      ? { playtimeThisLevelSeconds: snapshot.playtimeThisLevelSeconds }
      : {}),
    mythicPlusScore: snapshot.mythicPlusScore,
    ...(snapshot.ownedKeystone ? { ownedKeystone: snapshot.ownedKeystone } : {}),
    currencies: snapshot.currencies,
    stats: snapshot.stats,
  };
}

function snapshotFieldsToInsert(characterId: string, snapshot: SnapshotFields) {
  return {
    characterId,
    takenAt: fromUnixSeconds(snapshot.takenAt),
    level: snapshot.level,
    spec: snapshot.spec,
    role: snapshot.role,
    itemLevel: snapshot.itemLevel,
    gold: snapshot.gold,
    playtimeSeconds: snapshot.playtimeSeconds,
    playtimeThisLevelSeconds: snapshot.playtimeThisLevelSeconds ?? null,
    mythicPlusScore: snapshot.mythicPlusScore,
    ownedKeystone: snapshot.ownedKeystone,
    currencies: snapshot.currencies,
    stats: snapshot.stats,
    legacyConvexId: null,
  };
}

function mergeSnapshotFields(existingSnapshot: SnapshotFields, incomingSnapshot: SnapshotFields): SnapshotFields {
  return {
    ...incomingSnapshot,
    playtimeSeconds:
      incomingSnapshot.playtimeSeconds > 0
        ? incomingSnapshot.playtimeSeconds
        : existingSnapshot.playtimeSeconds,
    playtimeThisLevelSeconds:
      incomingSnapshot.playtimeThisLevelSeconds ?? existingSnapshot.playtimeThisLevelSeconds,
    ownedKeystone: incomingSnapshot.ownedKeystone ?? existingSnapshot.ownedKeystone,
    stats: {
      ...incomingSnapshot.stats,
      speedPercent: incomingSnapshot.stats.speedPercent ?? existingSnapshot.stats.speedPercent,
      leechPercent: incomingSnapshot.stats.leechPercent ?? existingSnapshot.stats.leechPercent,
      avoidancePercent: incomingSnapshot.stats.avoidancePercent ?? existingSnapshot.stats.avoidancePercent,
    },
  };
}

function snapshotFieldsEqual(a: SnapshotFields, b: SnapshotFields) {
  return JSON.stringify(toSnapshotFields(a)) === JSON.stringify(toSnapshotFields(b));
}

function toCharacterLatestSnapshot(snapshot: SnapshotFields): LatestSnapshotSummary {
  return {
    takenAt: snapshot.takenAt,
    level: snapshot.level,
    spec: snapshot.spec,
    role: snapshot.role,
    itemLevel: snapshot.itemLevel,
    gold: snapshot.gold,
    playtimeSeconds: snapshot.playtimeSeconds,
    ...(snapshot.playtimeThisLevelSeconds !== undefined
      ? { playtimeThisLevelSeconds: snapshot.playtimeThisLevelSeconds }
      : {}),
    mythicPlusScore: snapshot.mythicPlusScore,
    ...(snapshot.ownedKeystone ? { ownedKeystone: snapshot.ownedKeystone } : {}),
  };
}

function toCharacterLatestSnapshotDetails(snapshot: SnapshotFields): LatestSnapshotDetails {
  return {
    ...toCharacterLatestSnapshot(snapshot),
    currencies: snapshot.currencies,
    stats: snapshot.stats,
  };
}

function isSameCharacterLatestSnapshot(
  currentSnapshot: LatestSnapshotSummary | null | undefined,
  nextSnapshot: LatestSnapshotSummary | null | undefined,
) {
  if (!currentSnapshot && !nextSnapshot) return true;
  if (!currentSnapshot || !nextSnapshot) return false;

  const currentKeystone = currentSnapshot.ownedKeystone;
  const nextKeystone = nextSnapshot.ownedKeystone;
  const sameKeystone =
    (!currentKeystone && !nextKeystone) ||
    (!!currentKeystone &&
      !!nextKeystone &&
      currentKeystone.level === nextKeystone.level &&
      currentKeystone.mapChallengeModeID === nextKeystone.mapChallengeModeID &&
      currentKeystone.mapName === nextKeystone.mapName);

  return (
    currentSnapshot.takenAt === nextSnapshot.takenAt &&
    currentSnapshot.level === nextSnapshot.level &&
    currentSnapshot.spec === nextSnapshot.spec &&
    currentSnapshot.role === nextSnapshot.role &&
    currentSnapshot.itemLevel === nextSnapshot.itemLevel &&
    currentSnapshot.gold === nextSnapshot.gold &&
    currentSnapshot.playtimeSeconds === nextSnapshot.playtimeSeconds &&
    currentSnapshot.playtimeThisLevelSeconds === nextSnapshot.playtimeThisLevelSeconds &&
    currentSnapshot.mythicPlusScore === nextSnapshot.mythicPlusScore &&
    sameKeystone
  );
}

function shouldReplaceCharacterLatestSnapshot(
  currentSnapshot: LatestSnapshotSummary | null | undefined,
  nextSnapshot: LatestSnapshotSummary,
) {
  if (!currentSnapshot) return true;
  if (nextSnapshot.takenAt > currentSnapshot.takenAt) return true;
  if (nextSnapshot.takenAt < currentSnapshot.takenAt) return false;
  return !isSameCharacterLatestSnapshot(currentSnapshot, nextSnapshot);
}

function isSameCharacterLatestSnapshotDetails(
  currentSnapshot: LatestSnapshotDetails | null | undefined,
  nextSnapshot: LatestSnapshotDetails | null | undefined,
) {
  if (!currentSnapshot && !nextSnapshot) return true;
  if (!currentSnapshot || !nextSnapshot) return false;

  return JSON.stringify(currentSnapshot) === JSON.stringify(nextSnapshot);
}

function getSnapshotDayStart(takenAt: number) {
  return Math.floor(takenAt / 86400) * 86400;
}

function toCharacterDailySnapshotFields(snapshot: SnapshotFields) {
  return {
    dayStartAt: fromUnixSeconds(getSnapshotDayStart(snapshot.takenAt)),
    lastTakenAt: fromUnixSeconds(snapshot.takenAt),
    itemLevel: snapshot.itemLevel,
    gold: snapshot.gold,
    playtimeSeconds: snapshot.playtimeSeconds,
    mythicPlusScore: snapshot.mythicPlusScore,
    currencies: snapshot.currencies,
    stats: snapshot.stats,
  };
}

function shouldReplaceCharacterDailySnapshot(
  currentSnapshot: Pick<CharacterDailySnapshotRow, "lastTakenAt"> | null,
  nextSnapshot: SnapshotFields,
) {
  if (!currentSnapshot) return true;
  return nextSnapshot.takenAt >= toUnixSeconds(currentSnapshot.lastTakenAt)!;
}

function pickDefinedValue<T>(preferredValue: T | undefined, fallbackValue: T | undefined): T | undefined {
  return preferredValue !== undefined ? preferredValue : fallbackValue;
}

function mergeLifecycleTimestamp(
  preferredValue: number | undefined,
  fallbackValue: number | undefined,
): number | undefined {
  if (preferredValue === undefined) {
    return fallbackValue;
  }
  if (fallbackValue === undefined) {
    return preferredValue;
  }

  const preferredTimestamp = Math.floor(preferredValue);
  const fallbackTimestamp = Math.floor(fallbackValue);
  if (preferredTimestamp === fallbackTimestamp) {
    return preferredTimestamp;
  }

  if (
    Math.abs(Math.abs(preferredTimestamp - fallbackTimestamp) - LEGACY_DST_SHIFT_SECONDS) <=
    LEGACY_DST_SHIFT_TOLERANCE_SECONDS
  ) {
    return Math.max(preferredTimestamp, fallbackTimestamp);
  }

  return preferredValue;
}

function deriveAttemptIdFromRun(run: MythicPlusRunInputDocument): string | undefined {
  return getMythicPlusRunAttemptId(run) ?? undefined;
}

function deriveCanonicalKeyFromRun(run: MythicPlusRunInputDocument): string | undefined {
  return getMythicPlusRunCanonicalKey(run) ?? undefined;
}

function mergeMythicPlusRunData(
  currentRun: MythicPlusRunInputDocument | undefined,
  candidateRun: MythicPlusRunInputDocument,
): MythicPlusRunInputDocument {
  if (!currentRun) {
    const merged: MythicPlusRunInputDocument = {
      ...candidateRun,
      attemptId: deriveAttemptIdFromRun(candidateRun),
      canonicalKey: deriveCanonicalKeyFromRun(candidateRun),
      fingerprint: candidateRun.fingerprint,
    };
    merged.canonicalKey = deriveCanonicalKeyFromRun(merged);
    merged.fingerprint =
      buildCanonicalMythicPlusRunFingerprint(merged) ??
      merged.canonicalKey ??
      candidateRun.fingerprint;
    const status = getMythicPlusRunLifecycleStatus(merged);
    if (status !== undefined) {
      merged.status = status;
      if (status === "completed") {
        merged.completed = true;
        merged.endedAt = merged.endedAt ?? merged.completedAt;
      } else if (status === "abandoned") {
        merged.endedAt = merged.endedAt ?? merged.abandonedAt;
        merged.abandonedAt = merged.abandonedAt ?? merged.endedAt;
      }
    }
    return merged;
  }

  const candidatePreferred = shouldReplaceMythicPlusRun(currentRun, candidateRun);
  const preferredRun = candidatePreferred ? candidateRun : currentRun;
  const fallbackRun = candidatePreferred ? currentRun : candidateRun;

  const preferredObservedAt = preferredRun.observedAt ?? 0;
  const fallbackObservedAt = fallbackRun.observedAt ?? 0;
  const mergedObservedAt =
    preferredObservedAt > 0 && fallbackObservedAt > 0
      ? Math.min(preferredObservedAt, fallbackObservedAt)
      : preferredObservedAt > 0
        ? preferredObservedAt
        : fallbackObservedAt;

  const merged: MythicPlusRunInputDocument = {
    fingerprint:
      buildCanonicalMythicPlusRunFingerprint(preferredRun) ??
      deriveCanonicalKeyFromRun(preferredRun) ??
      buildCanonicalMythicPlusRunFingerprint(fallbackRun) ??
      deriveCanonicalKeyFromRun(fallbackRun) ??
      preferredRun.fingerprint ??
      fallbackRun.fingerprint,
    observedAt:
      mergedObservedAt > 0
        ? mergedObservedAt
        : pickDefinedValue(preferredRun.observedAt, fallbackRun.observedAt) ?? 0,
    attemptId: pickDefinedValue(deriveAttemptIdFromRun(preferredRun), deriveAttemptIdFromRun(fallbackRun)),
    canonicalKey: pickDefinedValue(
      deriveCanonicalKeyFromRun(preferredRun),
      deriveCanonicalKeyFromRun(fallbackRun),
    ),
    seasonID: pickDefinedValue(preferredRun.seasonID, fallbackRun.seasonID),
    mapChallengeModeID: pickDefinedValue(
      preferredRun.mapChallengeModeID,
      fallbackRun.mapChallengeModeID,
    ),
    mapName: pickDefinedValue(preferredRun.mapName, fallbackRun.mapName),
    level: pickDefinedValue(preferredRun.level, fallbackRun.level),
    status: pickDefinedValue(preferredRun.status, fallbackRun.status),
    completed: pickDefinedValue(preferredRun.completed, fallbackRun.completed),
    completedInTime: pickDefinedValue(preferredRun.completedInTime, fallbackRun.completedInTime),
    durationMs: pickDefinedValue(preferredRun.durationMs, fallbackRun.durationMs),
    runScore: pickDefinedValue(preferredRun.runScore, fallbackRun.runScore),
    startDate: mergeLifecycleTimestamp(preferredRun.startDate, fallbackRun.startDate),
    completedAt: mergeLifecycleTimestamp(preferredRun.completedAt, fallbackRun.completedAt),
    endedAt: mergeLifecycleTimestamp(preferredRun.endedAt, fallbackRun.endedAt),
    abandonedAt: mergeLifecycleTimestamp(preferredRun.abandonedAt, fallbackRun.abandonedAt),
    abandonReason: pickDefinedValue(preferredRun.abandonReason, fallbackRun.abandonReason),
    thisWeek: pickDefinedValue(preferredRun.thisWeek, fallbackRun.thisWeek),
    members: mergeMythicPlusRunMembers(currentRun.members, candidateRun.members),
  };

  const canonicalFingerprint = buildCanonicalMythicPlusRunFingerprint(merged);
  if (canonicalFingerprint) {
    merged.fingerprint = canonicalFingerprint;
  }
  merged.attemptId = deriveAttemptIdFromRun(merged);
  merged.canonicalKey = deriveCanonicalKeyFromRun(merged);

  const status = getMythicPlusRunLifecycleStatus(merged);
  if (status !== undefined) {
    merged.status = status;
    if (status === "completed") {
      merged.completed = true;
      merged.endedAt = merged.endedAt ?? merged.completedAt;
    } else if (status === "abandoned") {
      merged.endedAt = merged.endedAt ?? merged.abandonedAt;
      merged.abandonedAt = merged.abandonedAt ?? merged.endedAt;
    }
  }

  return merged;
}

function buildMythicPlusRunPatch(
  existingRun: MythicPlusRunDocument,
  mergedRun: MythicPlusRunInputDocument,
): MythicPlusRunPatch {
  const patch: MythicPlusRunPatch = {};
  if (existingRun.fingerprint !== mergedRun.fingerprint) patch.fingerprint = mergedRun.fingerprint;
  if (mergedRun.attemptId !== undefined && existingRun.attemptId !== mergedRun.attemptId) {
    patch.attemptId = mergedRun.attemptId;
  }
  if (mergedRun.canonicalKey !== undefined && existingRun.canonicalKey !== mergedRun.canonicalKey) {
    patch.canonicalKey = mergedRun.canonicalKey;
  }
  if (existingRun.observedAt !== mergedRun.observedAt) patch.observedAt = mergedRun.observedAt;
  if (mergedRun.seasonID !== undefined && existingRun.seasonID !== mergedRun.seasonID) {
    patch.seasonID = mergedRun.seasonID;
  }
  if (
    mergedRun.mapChallengeModeID !== undefined &&
    existingRun.mapChallengeModeID !== mergedRun.mapChallengeModeID
  ) {
    patch.mapChallengeModeID = mergedRun.mapChallengeModeID;
  }
  if (mergedRun.mapName !== undefined && existingRun.mapName !== mergedRun.mapName) {
    patch.mapName = mergedRun.mapName;
  }
  if (mergedRun.level !== undefined && existingRun.level !== mergedRun.level) patch.level = mergedRun.level;
  if (mergedRun.status !== undefined && existingRun.status !== mergedRun.status) patch.status = mergedRun.status;
  if (mergedRun.completed !== undefined && existingRun.completed !== mergedRun.completed) {
    patch.completed = mergedRun.completed;
  }
  if (
    mergedRun.completedInTime !== undefined &&
    existingRun.completedInTime !== mergedRun.completedInTime
  ) {
    patch.completedInTime = mergedRun.completedInTime;
  }
  if (mergedRun.durationMs !== undefined && existingRun.durationMs !== mergedRun.durationMs) {
    patch.durationMs = mergedRun.durationMs;
  }
  if (mergedRun.runScore !== undefined && existingRun.runScore !== mergedRun.runScore) {
    patch.runScore = mergedRun.runScore;
  }
  if (mergedRun.startDate !== undefined && existingRun.startDate !== mergedRun.startDate) {
    patch.startDate = mergedRun.startDate;
  }
  if (mergedRun.completedAt !== undefined && existingRun.completedAt !== mergedRun.completedAt) {
    patch.completedAt = mergedRun.completedAt;
  }
  if (mergedRun.endedAt !== undefined && existingRun.endedAt !== mergedRun.endedAt) {
    patch.endedAt = mergedRun.endedAt;
  }
  if (mergedRun.abandonedAt !== undefined && existingRun.abandonedAt !== mergedRun.abandonedAt) {
    patch.abandonedAt = mergedRun.abandonedAt;
  }
  if (
    mergedRun.abandonReason !== undefined &&
    existingRun.abandonReason !== mergedRun.abandonReason
  ) {
    patch.abandonReason = mergedRun.abandonReason;
  }
  if (mergedRun.thisWeek !== undefined && existingRun.thisWeek !== mergedRun.thisWeek) {
    patch.thisWeek = mergedRun.thisWeek;
  }
  if (JSON.stringify(existingRun.members ?? []) !== JSON.stringify(mergedRun.members ?? [])) {
    patch.members = mergedRun.members;
  }
  return patch;
}

function setPreferredRunLookup(
  map: Map<string, MythicPlusRunDocument>,
  key: string | undefined | null,
  run: MythicPlusRunDocument,
) {
  if (!key) {
    return;
  }

  const current = map.get(key);
  if (shouldReplaceMythicPlusRun(current, run)) {
    map.set(key, run);
  }
}

function registerRunLookups(
  lookups: ExistingRunLookups,
  run: MythicPlusRunDocument,
  aliases: Array<string | undefined | null> = [],
) {
  if (typeof run._id === "string" && run._id.trim() !== "") {
    lookups.byId.set(run._id, run);
  }

  const attemptId = getMythicPlusRunAttemptId(run);
  if (attemptId) {
    setPreferredRunLookup(lookups.byAttemptId, attemptId, run);
  }

  const canonicalKey = getMythicPlusRunCanonicalKey(run);
  if (canonicalKey) {
    setPreferredRunLookup(lookups.byCanonicalKey, canonicalKey, run);
  }

  const compatibilityAliases = new Set<string>();
  for (const alias of getMythicPlusRunCompatibilityLookupAliases(run)) {
    compatibilityAliases.add(alias);
  }
  for (const alias of aliases) {
    if (alias) {
      compatibilityAliases.add(alias);
    }
  }

  for (const compatibilityAlias of compatibilityAliases) {
    setPreferredRunLookup(lookups.byCompatibilityAlias, compatibilityAlias, run);
  }
}

function findMatchingExistingRunByIdentity(
  lookups: ExistingRunLookups,
  run: MythicPlusRunInputDocument,
) {
  const attemptId = getMythicPlusRunAttemptId(run);
  if (attemptId) {
    const attemptMatch = lookups.byAttemptId.get(attemptId);
    if (attemptMatch) {
      return attemptMatch;
    }
  }

  const canonicalKey = getMythicPlusRunCanonicalKey(run);
  if (canonicalKey) {
    const canonicalMatch = lookups.byCanonicalKey.get(canonicalKey);
    if (canonicalMatch) {
      return canonicalMatch;
    }
  }

  for (const compatibilityAlias of getMythicPlusRunCompatibilityLookupAliases(run)) {
    const candidate = lookups.byCompatibilityAlias.get(compatibilityAlias);
    if (!candidate) {
      continue;
    }
    if (!canUseMythicPlusRunCompatibilityAliasMatch(candidate, run)) {
      continue;
    }
    return candidate;
  }

  let fallbackMatch: MythicPlusRunDocument | undefined;
  for (const candidate of lookups.byId.values()) {
    if (!canUseMythicPlusRunCompatibilityAliasMatch(candidate, run)) {
      continue;
    }
    if (fallbackMatch === undefined || shouldReplaceMythicPlusRun(fallbackMatch, candidate)) {
      fallbackMatch = candidate;
    }
  }

  return fallbackMatch;
}

function mythicPlusRunRowToDocument(run: MythicPlusRunRow): MythicPlusRunDocument {
  return {
    _id: run.id,
    fingerprint: run.fingerprint,
    ...(run.attemptId ? { attemptId: run.attemptId } : {}),
    ...(run.canonicalKey ? { canonicalKey: run.canonicalKey } : {}),
    observedAt: toUnixSeconds(run.observedAt) ?? 0,
    ...(run.seasonId !== null ? { seasonID: run.seasonId } : {}),
    ...(run.mapChallengeModeId !== null ? { mapChallengeModeID: run.mapChallengeModeId } : {}),
    ...(run.mapName ? { mapName: run.mapName } : {}),
    ...(run.level !== null ? { level: run.level } : {}),
    ...(run.status ? { status: run.status } : {}),
    ...(run.completed !== null ? { completed: run.completed } : {}),
    ...(run.completedInTime !== null ? { completedInTime: run.completedInTime } : {}),
    ...(run.durationMs !== null ? { durationMs: run.durationMs } : {}),
    ...(run.runScore !== null ? { runScore: run.runScore } : {}),
    ...(run.startDate ? { startDate: toUnixSeconds(run.startDate)! } : {}),
    ...(run.completedAt ? { completedAt: toUnixSeconds(run.completedAt)! } : {}),
    ...(run.endedAt ? { endedAt: toUnixSeconds(run.endedAt)! } : {}),
    ...(run.abandonedAt ? { abandonedAt: toUnixSeconds(run.abandonedAt)! } : {}),
    ...(run.abandonReason ? { abandonReason: run.abandonReason } : {}),
    ...(run.thisWeek !== null ? { thisWeek: run.thisWeek } : {}),
    ...(run.members ? { members: run.members } : {}),
  };
}

function mythicPlusRunDocumentToInsert(characterId: string, run: MythicPlusRunInputDocument) {
  return {
    characterId,
    fingerprint: run.fingerprint ?? "",
    attemptId: run.attemptId ?? null,
    canonicalKey: run.canonicalKey ?? null,
    observedAt: fromUnixSeconds(run.observedAt ?? 0),
    seasonId: run.seasonID ?? null,
    mapChallengeModeId: run.mapChallengeModeID ?? null,
    mapName: run.mapName ?? null,
    level: run.level ?? null,
    status: run.status ?? null,
    completed: run.completed ?? null,
    completedInTime: run.completedInTime ?? null,
    durationMs: run.durationMs ?? null,
    runScore: run.runScore ?? null,
    startDate: run.startDate !== undefined ? fromUnixSeconds(run.startDate) : null,
    completedAt: run.completedAt !== undefined ? fromUnixSeconds(run.completedAt) : null,
    endedAt: run.endedAt !== undefined ? fromUnixSeconds(run.endedAt) : null,
    abandonedAt: run.abandonedAt !== undefined ? fromUnixSeconds(run.abandonedAt) : null,
    abandonReason: run.abandonReason ?? null,
    thisWeek: run.thisWeek ?? null,
    members: run.members,
    legacyConvexId: null,
  };
}

function mythicPlusRunPatchToDbPatch(patch: MythicPlusRunPatch) {
  return {
    ...(patch.fingerprint !== undefined ? { fingerprint: patch.fingerprint } : {}),
    ...(patch.attemptId !== undefined ? { attemptId: patch.attemptId } : {}),
    ...(patch.canonicalKey !== undefined ? { canonicalKey: patch.canonicalKey } : {}),
    ...(patch.observedAt !== undefined ? { observedAt: fromUnixSeconds(patch.observedAt) } : {}),
    ...(patch.seasonID !== undefined ? { seasonId: patch.seasonID } : {}),
    ...(patch.mapChallengeModeID !== undefined ? { mapChallengeModeId: patch.mapChallengeModeID } : {}),
    ...(patch.mapName !== undefined ? { mapName: patch.mapName } : {}),
    ...(patch.level !== undefined ? { level: patch.level } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
    ...(patch.completedInTime !== undefined ? { completedInTime: patch.completedInTime } : {}),
    ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
    ...(patch.runScore !== undefined ? { runScore: patch.runScore } : {}),
    ...(patch.startDate !== undefined ? { startDate: fromUnixSeconds(patch.startDate) } : {}),
    ...(patch.completedAt !== undefined ? { completedAt: fromUnixSeconds(patch.completedAt) } : {}),
    ...(patch.endedAt !== undefined ? { endedAt: fromUnixSeconds(patch.endedAt) } : {}),
    ...(patch.abandonedAt !== undefined ? { abandonedAt: fromUnixSeconds(patch.abandonedAt) } : {}),
    ...(patch.abandonReason !== undefined ? { abandonReason: patch.abandonReason } : {}),
    ...(patch.thisWeek !== undefined ? { thisWeek: patch.thisWeek } : {}),
    ...(patch.members !== undefined ? { members: patch.members } : {}),
  };
}

async function collapseDuplicateMythicPlusRunsForCharacter(tx: DbExecutor, characterId: string) {
  const runs = await tx.query.mythicPlusRuns.findMany({
    where: eq(mythicPlusRuns.characterId, characterId),
  });

  if (runs.length < 2) {
    return 0;
  }

  const clusters: Array<{
    representative: MythicPlusRunDocument;
    mergedRun: MythicPlusRunInputDocument;
    runIds: string[];
  }> = [];

  for (const runRow of runs) {
    const run = mythicPlusRunRowToDocument(runRow);
    const runAttemptId = getMythicPlusRunAttemptId(run);
    const runCanonicalKey = getMythicPlusRunCanonicalKey(run);
    let matchedClusterIndex = -1;

    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index]!;
      const clusterAttemptId = getMythicPlusRunAttemptId(cluster.mergedRun);
      const clusterCanonicalKey = getMythicPlusRunCanonicalKey(cluster.mergedRun);
      const hasExactAttemptMatch =
        runAttemptId !== null && clusterAttemptId !== null && runAttemptId === clusterAttemptId;
      const hasExactCanonicalMatch =
        runCanonicalKey !== null &&
        clusterCanonicalKey !== null &&
        runCanonicalKey === clusterCanonicalKey;
      const hasCompatibilityMatch =
        !hasExactAttemptMatch &&
        !hasExactCanonicalMatch &&
        canUseMythicPlusRunCompatibilityAliasMatch(cluster.mergedRun, run);

      if (hasExactAttemptMatch || hasExactCanonicalMatch || hasCompatibilityMatch) {
        matchedClusterIndex = index;
        break;
      }
    }

    if (matchedClusterIndex < 0) {
      clusters.push({
        representative: run,
        mergedRun: mergeMythicPlusRunData(undefined, run),
        runIds: run._id ? [run._id] : [],
      });
      continue;
    }

    const matchedCluster = clusters[matchedClusterIndex]!;
    matchedCluster.mergedRun = mergeMythicPlusRunData(matchedCluster.mergedRun, run);
    if (shouldReplaceMythicPlusRun(matchedCluster.representative, run)) {
      matchedCluster.representative = run;
    }
    if (run._id) {
      matchedCluster.runIds.push(run._id);
    }
  }

  let collapsedCount = 0;
  for (const cluster of clusters) {
    if (cluster.runIds.length <= 1 || !cluster.representative._id) {
      continue;
    }

    const representativeId = cluster.representative._id;
    const patch = buildMythicPlusRunPatch(cluster.representative, cluster.mergedRun);
    const dbPatch = mythicPlusRunPatchToDbPatch(patch);
    if (Object.keys(dbPatch).length > 0) {
      await tx.update(mythicPlusRuns).set(dbPatch).where(eq(mythicPlusRuns.id, representativeId));
    }

    for (const runId of cluster.runIds) {
      if (runId === representativeId) continue;
      await tx.delete(mythicPlusRuns).where(eq(mythicPlusRuns.id, runId));
      collapsedCount += 1;
    }
  }

  return collapsedCount;
}

export async function ingestAddonData(userId: string, inputCharacters: AddonCharacterInput[]) {
  const rateLimit = await limitAddonIngest(userId);
  if (!rateLimit.ok) {
    throw new AddonIngestServiceError(
      "Too many requests — please wait a moment before trying again.",
      429,
    );
  }

  const player = await db.query.players.findFirst({
    where: eq(players.userId, userId),
  });

  if (!player) {
    throw new AddonIngestServiceError(
      "Player record not found — do a Battle.net sync first to create your player profile.",
      400,
    );
  }

  const result = await db.transaction(async (tx) => {
    const now = Date.now();
    let newChars = 0;
    let newSnapshots = 0;
    let newMythicPlusRuns = 0;
    let collapsedMythicPlusRuns = 0;

    for (const charData of inputCharacters) {
      const existingCharacter = await tx.query.characters.findFirst({
        where: and(
          eq(characters.playerId, player.id),
          eq(characters.realm, charData.realm),
          eq(characters.name, charData.name),
        ),
      });

      let characterId = existingCharacter?.id ?? null;
      let currentCharacterRow = existingCharacter ?? null;

      if (!existingCharacter) {
        const [insertedCharacter] = await tx
          .insert(characters)
          .values({
            playerId: player.id,
            name: charData.name,
            realm: charData.realm,
            region: charData.region,
            class: charData.class,
            race: charData.race,
            faction: charData.faction,
            legacyConvexId: null,
          })
          .returning();

        characterId = insertedCharacter!.id;
        currentCharacterRow = insertedCharacter ?? null;
        newChars += 1;
      } else {
        await tx
          .update(characters)
          .set({
            region: charData.region,
            class: charData.class,
            race: charData.race,
            faction: charData.faction,
          })
          .where(eq(characters.id, existingCharacter.id));
      }

      if (!characterId) {
        continue;
      }

      let nextCharacterLatestSnapshot = currentCharacterRow?.latestSnapshot ?? null;
      let nextCharacterLatestSnapshotDetails = currentCharacterRow?.latestSnapshotDetails ?? null;
      let shouldPersistLatestSnapshot = false;
      let shouldPersistLatestSnapshotDetails = false;
      let nextCharacterFirstSnapshotAt = toUnixSeconds(currentCharacterRow?.firstSnapshotAt);
      let nextCharacterSnapshotCount = currentCharacterRow?.snapshotCount ?? undefined;
      let shouldPersistSnapshotMetadata = false;

      if (nextCharacterFirstSnapshotAt === null || nextCharacterSnapshotCount === null || nextCharacterSnapshotCount === undefined) {
        const existingSnapshots = await tx.query.snapshots.findMany({
          where: eq(snapshots.characterId, characterId),
        });

        const seenTakenAt = new Set<number>();
        let firstSnapshotAt: number | undefined;
        for (const snapshot of existingSnapshots) {
          const takenAt = toUnixSeconds(snapshot.takenAt);
          if (takenAt === null || seenTakenAt.has(takenAt)) {
            continue;
          }
          seenTakenAt.add(takenAt);
          if (firstSnapshotAt === undefined || takenAt < firstSnapshotAt) {
            firstSnapshotAt = takenAt;
          }
        }

        nextCharacterFirstSnapshotAt = firstSnapshotAt ?? null;
        nextCharacterSnapshotCount = seenTakenAt.size;
        shouldPersistSnapshotMetadata =
          toUnixSeconds(currentCharacterRow?.firstSnapshotAt) !== nextCharacterFirstSnapshotAt ||
          currentCharacterRow?.snapshotCount !== nextCharacterSnapshotCount;
      }

      for (const snapshotInput of charData.snapshots) {
        const normalizedSpec = normalizeSnapshotSpec(snapshotInput.spec);
        if (!normalizedSpec) {
          continue;
        }

        const takenAtMs = snapshotInput.takenAt * 1000;
        if (takenAtMs > now + MAX_FUTURE_MS) {
          throw new AddonIngestServiceError(
            `Snapshot timestamp is in the future (takenAt=${snapshotInput.takenAt}s, now=${Math.floor(now / 1000)}s)`,
            400,
          );
        }
        if (takenAtMs < now - MAX_PAST_MS) {
          throw new AddonIngestServiceError(
            `Snapshot timestamp is older than 30 days (takenAt=${snapshotInput.takenAt}s, now=${Math.floor(now / 1000)}s)`,
            400,
          );
        }

        const nextSnapshot: SnapshotFields = {
          takenAt: snapshotInput.takenAt,
          level: snapshotInput.level,
          spec: normalizedSpec,
          role: snapshotInput.role,
          itemLevel: snapshotInput.itemLevel,
          gold: snapshotInput.gold,
          playtimeSeconds: snapshotInput.playtimeSeconds,
          ...(snapshotInput.playtimeThisLevelSeconds !== undefined
            ? { playtimeThisLevelSeconds: snapshotInput.playtimeThisLevelSeconds }
            : {}),
          mythicPlusScore: snapshotInput.mythicPlusScore,
          ...(snapshotInput.ownedKeystone ? { ownedKeystone: snapshotInput.ownedKeystone } : {}),
          currencies: snapshotInput.currencies,
          stats: snapshotInput.stats,
        };

        const takenAt = fromUnixSeconds(snapshotInput.takenAt);
        let existingSnapshotRow = await tx.query.snapshots.findFirst({
          where: and(
            eq(snapshots.characterId, characterId),
            eq(snapshots.takenAt, takenAt),
          ),
        });

        let latestSnapshotCandidate: LatestSnapshotSummary | null = null;
        let latestSnapshotDetailsCandidate: LatestSnapshotDetails | null = null;
        let dailySnapshotSource: SnapshotFields | null = null;

        if (!existingSnapshotRow) {
          try {
            await tx.insert(snapshots).values(snapshotFieldsToInsert(characterId, nextSnapshot));
            newSnapshots += 1;
            latestSnapshotCandidate = toCharacterLatestSnapshot(nextSnapshot);
            latestSnapshotDetailsCandidate = toCharacterLatestSnapshotDetails(nextSnapshot);
            dailySnapshotSource = nextSnapshot;
            nextCharacterFirstSnapshotAt =
              nextCharacterFirstSnapshotAt === null
                ? nextSnapshot.takenAt
                : Math.min(nextCharacterFirstSnapshotAt, nextSnapshot.takenAt);
            nextCharacterSnapshotCount = (nextCharacterSnapshotCount ?? 0) + 1;
            shouldPersistSnapshotMetadata = true;
          } catch (error) {
            if (!isUniqueConstraintViolation(error)) {
              throw error;
            }

            existingSnapshotRow = await tx.query.snapshots.findFirst({
              where: and(eq(snapshots.characterId, characterId), eq(snapshots.takenAt, takenAt)),
            });

            if (!existingSnapshotRow) {
              throw error;
            }
          }
        }

        if (existingSnapshotRow) {
          const existingSnapshotFields = snapshotRowToFields(existingSnapshotRow);
          const mergedSnapshot = mergeSnapshotFields(existingSnapshotFields, nextSnapshot);

          if (!snapshotFieldsEqual(existingSnapshotFields, mergedSnapshot)) {
            await tx
              .update(snapshots)
              .set(snapshotFieldsToInsert(characterId, mergedSnapshot))
              .where(eq(snapshots.id, existingSnapshotRow.id));
            latestSnapshotCandidate = toCharacterLatestSnapshot(mergedSnapshot);
            latestSnapshotDetailsCandidate = toCharacterLatestSnapshotDetails(mergedSnapshot);
            dailySnapshotSource = mergedSnapshot;
          } else {
            latestSnapshotCandidate = toCharacterLatestSnapshot(existingSnapshotFields);
            latestSnapshotDetailsCandidate = toCharacterLatestSnapshotDetails(existingSnapshotFields);
            dailySnapshotSource = existingSnapshotFields;
          }
        }

        if (!latestSnapshotCandidate || !latestSnapshotDetailsCandidate || !dailySnapshotSource) {
          throw new Error("Snapshot ingest did not produce a resolved snapshot state.");
        }

        const dayStartAt = getSnapshotDayStart(dailySnapshotSource.takenAt);
        const existingDailySnapshot = await tx.query.characterDailySnapshots.findFirst({
          where: and(
            eq(characterDailySnapshots.characterId, characterId),
            eq(characterDailySnapshots.dayStartAt, fromUnixSeconds(dayStartAt)),
          ),
        });

        const nextDailySnapshot = toCharacterDailySnapshotFields(dailySnapshotSource);
        if (!existingDailySnapshot) {
          await tx.insert(characterDailySnapshots).values({
            characterId,
            ...nextDailySnapshot,
            legacyConvexId: null,
          });
        } else if (shouldReplaceCharacterDailySnapshot(existingDailySnapshot, dailySnapshotSource)) {
          await tx
            .update(characterDailySnapshots)
            .set(nextDailySnapshot)
            .where(eq(characterDailySnapshots.id, existingDailySnapshot.id));
        }

        if (
          shouldReplaceCharacterLatestSnapshot(nextCharacterLatestSnapshot, latestSnapshotCandidate) &&
          !isSameCharacterLatestSnapshot(nextCharacterLatestSnapshot, latestSnapshotCandidate)
        ) {
          nextCharacterLatestSnapshot = latestSnapshotCandidate;
          shouldPersistLatestSnapshot = true;
        }
        if (
          nextCharacterLatestSnapshot?.takenAt === latestSnapshotCandidate.takenAt &&
          !isSameCharacterLatestSnapshotDetails(
            nextCharacterLatestSnapshotDetails,
            latestSnapshotDetailsCandidate,
          )
        ) {
          nextCharacterLatestSnapshotDetails = latestSnapshotDetailsCandidate;
          shouldPersistLatestSnapshotDetails = true;
        }
      }

      const characterPatch: Record<string, unknown> = {};
      if (shouldPersistLatestSnapshot && nextCharacterLatestSnapshot) {
        characterPatch.latestSnapshot = nextCharacterLatestSnapshot;
      }
      if (shouldPersistLatestSnapshotDetails && nextCharacterLatestSnapshotDetails) {
        characterPatch.latestSnapshotDetails = nextCharacterLatestSnapshotDetails;
      }
      if (shouldPersistSnapshotMetadata) {
        if (nextCharacterFirstSnapshotAt !== null && nextCharacterFirstSnapshotAt !== undefined) {
          characterPatch.firstSnapshotAt = fromUnixSeconds(nextCharacterFirstSnapshotAt);
        }
        if (nextCharacterSnapshotCount !== undefined && nextCharacterSnapshotCount !== null) {
          characterPatch.snapshotCount = nextCharacterSnapshotCount;
        }
      }
      if (Object.keys(characterPatch).length > 0) {
        await tx.update(characters).set(characterPatch).where(eq(characters.id, characterId));
      }

      const existingCharacterRuns = await tx.query.mythicPlusRuns.findMany({
        where: eq(mythicPlusRuns.characterId, characterId),
      });
      const currentCharacterRuns = new Map(
        existingCharacterRuns.map((run) => {
          const document = mythicPlusRunRowToDocument(run);
          return [document._id!, document] as const;
        }),
      );

      const existingRunLookups: ExistingRunLookups = {
        byAttemptId: new Map<string, MythicPlusRunDocument>(),
        byCanonicalKey: new Map<string, MythicPlusRunDocument>(),
        byCompatibilityAlias: new Map<string, MythicPlusRunDocument>(),
        byId: new Map<string, MythicPlusRunDocument>(),
      };
      for (const existingRun of currentCharacterRuns.values()) {
        registerRunLookups(existingRunLookups, existingRun);
      }

      const incomingRunsDeduped: MythicPlusRunInputDocument[] = [];
      const incomingByAttemptId = new Map<string, number>();
      const incomingByCanonicalKey = new Map<string, number>();
      for (const incomingRun of charData.mythicPlusRuns ?? []) {
        const normalizedIncomingRun = mergeMythicPlusRunData(undefined, {
          ...incomingRun,
          fingerprint: incomingRun.fingerprint,
        });
        const incomingAttemptId = deriveAttemptIdFromRun(normalizedIncomingRun);
        const incomingCanonicalKey = deriveCanonicalKeyFromRun(normalizedIncomingRun);
        let matchedIndex =
          incomingAttemptId !== undefined ? (incomingByAttemptId.get(incomingAttemptId) ?? -1) : -1;
        if (matchedIndex < 0 && incomingCanonicalKey !== undefined) {
          matchedIndex = incomingByCanonicalKey.get(incomingCanonicalKey) ?? -1;
        }

        if (matchedIndex < 0) {
          incomingRunsDeduped.push(normalizedIncomingRun);
          matchedIndex = incomingRunsDeduped.length - 1;
        } else {
          incomingRunsDeduped[matchedIndex] = mergeMythicPlusRunData(
            incomingRunsDeduped[matchedIndex],
            normalizedIncomingRun,
          );
        }

        const mergedIncomingRun = incomingRunsDeduped[matchedIndex]!;
        const mergedAttemptId = deriveAttemptIdFromRun(mergedIncomingRun);
        const mergedCanonicalKey = deriveCanonicalKeyFromRun(mergedIncomingRun);
        if (mergedAttemptId !== undefined) {
          incomingByAttemptId.set(mergedAttemptId, matchedIndex);
        }
        if (mergedCanonicalKey !== undefined) {
          incomingByCanonicalKey.set(mergedCanonicalKey, matchedIndex);
        }
      }

      for (const run of incomingRunsDeduped) {
        const nextFingerprint =
          buildCanonicalMythicPlusRunFingerprint(run) ??
          deriveCanonicalKeyFromRun(run) ??
          run.fingerprint;
        const nextCanonicalKey = deriveCanonicalKeyFromRun(run);
        const nextAttemptId = deriveAttemptIdFromRun(run);
        if (!nextFingerprint) {
          continue;
        }

        const nextRun: MythicPlusRunInputDocument = {
          ...run,
          fingerprint: nextFingerprint,
          ...(nextAttemptId ? { attemptId: nextAttemptId } : {}),
          ...(nextCanonicalKey ? { canonicalKey: nextCanonicalKey } : {}),
        };

        const existingRun = findMatchingExistingRunByIdentity(existingRunLookups, nextRun);
        if (!existingRun) {
          const [insertedRun] = await tx
            .insert(mythicPlusRuns)
            .values(mythicPlusRunDocumentToInsert(characterId, nextRun))
            .returning();

          const insertedDocument = mythicPlusRunRowToDocument(insertedRun!);
          registerRunLookups(existingRunLookups, insertedDocument, [nextRun.fingerprint, nextFingerprint]);
          currentCharacterRuns.set(insertedDocument._id!, insertedDocument);
          newMythicPlusRuns += 1;
          continue;
        }

        const mergedRun = mergeMythicPlusRunData(existingRun, nextRun);
        const patch = buildMythicPlusRunPatch(existingRun, mergedRun);
        const dbPatch = mythicPlusRunPatchToDbPatch(patch);

        if (Object.keys(dbPatch).length > 0 && existingRun._id) {
          await tx.update(mythicPlusRuns).set(dbPatch).where(eq(mythicPlusRuns.id, existingRun._id));
          currentCharacterRuns.set(existingRun._id, {
            ...existingRun,
            ...patch,
          });
          registerRunLookups(existingRunLookups, { ...existingRun, ...patch }, [
            existingRun.fingerprint,
            nextRun.fingerprint,
            mergedRun.fingerprint,
          ]);
        } else {
          registerRunLookups(existingRunLookups, existingRun, [
            existingRun.fingerprint,
            nextRun.fingerprint,
            mergedRun.fingerprint,
          ]);
        }
      }

      const currentScore =
        nextCharacterLatestSnapshot?.mythicPlusScore ??
        nextCharacterLatestSnapshotDetails?.mythicPlusScore ??
        null;
      const dedupedRuns = dedupeMythicPlusRuns(Array.from(currentCharacterRuns.values()));
      const recentRuns = buildRecentRuns(dedupedRuns);
      const mythicPlusSummary = buildMythicPlusSummary(dedupedRuns, currentScore);
      const mythicPlusRecentRunsPreview = recentRuns.slice(
        0,
        MYTHIC_PLUS_PREVIEW_RUN_LIMIT,
      ) as MythicPlusRecentRunPreview[];
      const mythicPlusRunCount = recentRuns.length;

      if (
        JSON.stringify(currentCharacterRow?.mythicPlusSummary ?? null) !==
          JSON.stringify(mythicPlusSummary) ||
        JSON.stringify(currentCharacterRow?.mythicPlusRecentRunsPreview ?? null) !==
          JSON.stringify(mythicPlusRecentRunsPreview) ||
        currentCharacterRow?.mythicPlusRunCount !== mythicPlusRunCount
      ) {
        await tx
          .update(characters)
          .set({
            mythicPlusSummary: mythicPlusSummary as MythicPlusSummary,
            mythicPlusRecentRunsPreview,
            mythicPlusRunCount,
          })
          .where(eq(characters.id, characterId));
      }

      collapsedMythicPlusRuns += await collapseDuplicateMythicPlusRunsForCharacter(tx, characterId);
    }

    return {
      newChars,
      newSnapshots,
      newMythicPlusRuns,
      collapsedMythicPlusRuns,
    };
  });

  await insertAuditEvent("addon.ingest", {
    userId,
    metadata: {
      ...result,
      totalCharacters: inputCharacters.length,
    },
  });

  return result;
}
