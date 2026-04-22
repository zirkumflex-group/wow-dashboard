import type {
  MythicPlusAbandonReason,
  MythicPlusRecentRunPreview,
  MythicPlusRunMember,
  MythicPlusRunStatus,
  MythicPlusSummary,
} from "@wow-dashboard/db";

export type MythicPlusRunDocument = {
  _id?: string;
  _creationTime?: number;
  fingerprint?: string;
  attemptId?: string;
  canonicalKey?: string;
  observedAt?: number;
  seasonID?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  level?: number;
  status?: MythicPlusRunStatus;
  completed?: boolean;
  completedInTime?: boolean;
  durationMs?: number;
  runScore?: number;
  startDate?: number;
  completedAt?: number;
  endedAt?: number;
  abandonedAt?: number;
  abandonReason?: MythicPlusAbandonReason;
  thisWeek?: boolean;
  members?: MythicPlusRunMember[];
};

const MYTHIC_PLUS_DUNGEONS = [
  { mapChallengeModeID: 402, name: "Algeth'ar Academy", timerMs: 30 * 60 * 1000 },
  { mapChallengeModeID: 558, name: "Magisters' Terrace", timerMs: 34 * 60 * 1000 },
  { mapChallengeModeID: 560, name: "Maisara Caverns", timerMs: 33 * 60 * 1000 },
  { mapChallengeModeID: 559, name: "Nexus-Point Xenas", timerMs: 30 * 60 * 1000 },
  { mapChallengeModeID: 556, name: "Pit of Saron", timerMs: 30 * 60 * 1000 },
  { mapChallengeModeID: 239, name: "Seat of the Triumvirate", timerMs: 34 * 60 * 1000 },
  { mapChallengeModeID: 161, name: "Skyreach", timerMs: 28 * 60 * 1000 },
  { mapChallengeModeID: 557, name: "Windrunner Spire", timerMs: 33.5 * 60 * 1000 },
] as const;

const MYTHIC_PLUS_TIMER_MS_BY_MAP_ID = new Map<number, number>(
  MYTHIC_PLUS_DUNGEONS.map((dungeon) => [dungeon.mapChallengeModeID, dungeon.timerMs] as const),
);
const MYTHIC_PLUS_TIMER_MS_BY_MAP_NAME = new Map<string, number>(
  MYTHIC_PLUS_DUNGEONS.map((dungeon) => [normalizeMapName(dungeon.name), dungeon.timerMs] as const),
);

const MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS = 4 * 60 * 60 * 1000;
const LEGACY_DST_SHIFT_SECONDS = 60 * 60;
const LEGACY_DST_SHIFT_TOLERANCE_SECONDS = 2 * 60;
const MAX_COMPAT_DURATION_DRIFT_MS = 1000;
const LEGACY_DISPLAY_DUPLICATE_RUN_TOLERANCE_SECONDS = 2 * 60;

function normalizeMapName(mapName: string) {
  return mapName.trim().toLowerCase();
}

function toFingerprintToken(value: boolean | number | string | null | undefined) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return value;
}

function getRunMapFingerprintTokens(run: MythicPlusRunDocument): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const pushToken = (value: string | undefined) => {
    if (!value || value === "" || seen.has(value)) return;
    seen.add(value);
    tokens.push(value);
  };

  if (run.mapChallengeModeID !== undefined) {
    pushToken(toFingerprintToken(run.mapChallengeModeID));
  }
  if (typeof run.mapName === "string") {
    const normalizedName = run.mapName.trim().toLowerCase();
    if (normalizedName !== "") {
      pushToken(normalizedName);
    }
  }

  return tokens;
}

function getRunMapFingerprintToken(run: MythicPlusRunDocument) {
  return getRunMapFingerprintTokens(run)[0] ?? "";
}

function normalizeAttemptId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function isInvalidLegacySyntheticAttemptId(attemptId: string): boolean {
  if (!attemptId.startsWith("attempt|")) {
    return false;
  }

  const tokens = attemptId.split("|");
  if (tokens.length !== 5) {
    return false;
  }

  const startToken = Number(tokens[4]);
  return !Number.isFinite(startToken) || Math.floor(startToken) <= 0;
}

function normalizeCanonicalKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (normalized === "") {
    return null;
  }
  if (!normalized.startsWith("aid|") && !normalized.startsWith("run|")) {
    return null;
  }

  return normalized;
}

function normalizeLifecycleTimestamp(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.floor(value);
}

function hasValidStartDate(run: MythicPlusRunDocument): boolean {
  return normalizeLifecycleTimestamp(run.startDate) !== null;
}

function buildRunAttemptIdFromStartDate(run: MythicPlusRunDocument): string | null {
  const mapToken = getRunMapFingerprintToken(run);
  const startDate = run.startDate;
  if (
    mapToken === "" ||
    run.level === undefined ||
    startDate === undefined ||
    !Number.isFinite(startDate) ||
    startDate <= 0
  ) {
    return null;
  }

  return [
    "attempt",
    toFingerprintToken(run.seasonID),
    mapToken,
    toFingerprintToken(run.level),
    toFingerprintToken(Math.floor(startDate)),
  ].join("|");
}

export function getMythicPlusRunAttemptId(run: MythicPlusRunDocument): string | null {
  const explicitAttemptId = normalizeAttemptId(run.attemptId);
  if (explicitAttemptId !== null && !isInvalidLegacySyntheticAttemptId(explicitAttemptId)) {
    return explicitAttemptId;
  }

  const fingerprint = normalizeAttemptId(run.fingerprint);
  if (
    fingerprint !== null &&
    fingerprint.startsWith("attempt|") &&
    !isInvalidLegacySyntheticAttemptId(fingerprint)
  ) {
    return fingerprint;
  }

  return buildRunAttemptIdFromStartDate(run);
}

function getRunSeasonTokens(run: MythicPlusRunDocument): string[] {
  const seasonToken = run.seasonID !== undefined ? toFingerprintToken(run.seasonID) : "";
  return seasonToken === "" ? [""] : [seasonToken, ""];
}

function getSanitizedRunDurationMs(run: MythicPlusRunDocument): number | undefined {
  const durationMs = run.durationMs;
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) {
    return undefined;
  }
  if (durationMs <= MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS) {
    return Math.floor(durationMs);
  }

  const runEndAt = run.completedAt ?? run.endedAt ?? run.abandonedAt;
  if (run.startDate !== undefined && runEndAt !== undefined && runEndAt >= run.startDate) {
    const derivedDurationMs = (runEndAt - run.startDate) * 1000;
    if (
      Number.isFinite(derivedDurationMs) &&
      derivedDurationMs > 0 &&
      derivedDurationMs <= MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS
    ) {
      return Math.floor(derivedDurationMs);
    }
  }

  return undefined;
}

function getRunDurationSeconds(run: MythicPlusRunDocument): number | null {
  const durationMs = getSanitizedRunDurationMs(run);
  if (durationMs === undefined) {
    return null;
  }

  return Math.floor(durationMs / 1000 + 0.5);
}

function getRunDerivedStartTimestamp(run: MythicPlusRunDocument): number | null {
  if (run.startDate !== undefined) {
    return run.startDate;
  }

  const durationSeconds = getRunDurationSeconds(run);
  const endAt = run.completedAt ?? run.endedAt ?? run.abandonedAt;
  if (durationSeconds !== null && endAt !== undefined) {
    return endAt - durationSeconds;
  }

  return null;
}

function getRunDerivedEndTimestamp(run: MythicPlusRunDocument): number | null {
  if (run.completedAt !== undefined) return run.completedAt;
  if (run.endedAt !== undefined) return run.endedAt;
  if (run.abandonedAt !== undefined) return run.abandonedAt;

  const durationSeconds = getRunDurationSeconds(run);
  if (durationSeconds !== null && run.startDate !== undefined) {
    return run.startDate + durationSeconds;
  }

  return null;
}

function hasStrongCompletedRunIdentitySignature(run: MythicPlusRunDocument): boolean {
  return (
    run.level !== undefined &&
    getRunMapFingerprintToken(run) !== "" &&
    getSanitizedRunDurationMs(run) !== undefined &&
    run.runScore !== undefined
  );
}

function hasLegacyDstCompatibilitySignature(run: MythicPlusRunDocument): boolean {
  return (
    run.level !== undefined &&
    getRunMapFingerprintToken(run) !== "" &&
    getSanitizedRunDurationMs(run) !== undefined &&
    normalizeLifecycleTimestamp(run.completedAt ?? run.endedAt ?? run.abandonedAt) !== null
  );
}

function shouldApplyLegacyHistoryDstForwardShift(run: MythicPlusRunDocument): boolean {
  if (getMythicPlusRunAttemptId(run) !== null) {
    return false;
  }
  if (hasValidStartDate(run)) {
    return false;
  }
  if (!hasStrongCompletedRunIdentitySignature(run)) {
    return false;
  }

  const primaryTimestamp = run.endedAt ?? run.abandonedAt ?? run.completedAt;
  if (primaryTimestamp === undefined) {
    return false;
  }
  if (run.observedAt !== undefined && Math.abs(run.observedAt - primaryTimestamp) <= 6 * 3600) {
    return false;
  }

  return true;
}

function getRunCompatibilityTimestampAliases(run: MythicPlusRunDocument): number[] {
  const candidates: number[] = [];
  const seen = new Set<number>();

  const pushCandidate = (value: number | null | undefined) => {
    const normalized = normalizeLifecycleTimestamp(value);
    if (normalized === null || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  const derivedStart = getRunDerivedStartTimestamp(run);
  const derivedEnd = getRunDerivedEndTimestamp(run);
  pushCandidate(run.startDate);
  pushCandidate(run.completedAt);
  pushCandidate(run.endedAt);
  pushCandidate(run.abandonedAt);
  pushCandidate(derivedStart);
  pushCandidate(derivedEnd);

  const likelyPlayedAt = getLikelyPlayedAtTimestamp(run);
  pushCandidate(likelyPlayedAt);
  if (likelyPlayedAt > 0) {
    pushCandidate(Math.floor(likelyPlayedAt / 60) * 60);
  }

  if (!hasValidStartDate(run) && hasLegacyDstCompatibilitySignature(run)) {
    const shiftSources = [run.completedAt, run.endedAt, run.abandonedAt, derivedEnd];
    for (const source of shiftSources) {
      if (source === undefined || source === null) {
        continue;
      }
      pushCandidate(source - LEGACY_DST_SHIFT_SECONDS);
      pushCandidate(source + LEGACY_DST_SHIFT_SECONDS);
    }
  }

  return candidates;
}

function getRunCanonicalEventTimestamp(run: MythicPlusRunDocument): number | null {
  const explicitTimestamps = [run.startDate, run.completedAt, run.endedAt, run.abandonedAt];
  for (const timestamp of explicitTimestamps) {
    const normalized = normalizeLifecycleTimestamp(timestamp);
    if (normalized !== null) {
      return normalized;
    }
  }

  const derivedCandidates = [getRunDerivedStartTimestamp(run), getRunDerivedEndTimestamp(run)];
  for (const timestamp of derivedCandidates) {
    const normalized = normalizeLifecycleTimestamp(timestamp);
    if (normalized !== null) {
      return normalized;
    }
  }

  return null;
}

function buildRunFingerprintWithIdentity(
  run: MythicPlusRunDocument,
  identityTimestamp: number,
  options?: {
    seasonToken?: string;
    mapToken?: string;
  },
) {
  const mapToken = options?.mapToken ?? getRunMapFingerprintToken(run);
  if (mapToken === "" || run.level === undefined) {
    return null;
  }

  const seasonToken = options?.seasonToken ?? toFingerprintToken(run.seasonID);
  return [
    seasonToken,
    mapToken,
    toFingerprintToken(run.level),
    toFingerprintToken(identityTimestamp),
  ].join("|");
}

export function hasMythicPlusRunCompletionEvidence(run: MythicPlusRunDocument): boolean {
  return (
    run.completed === true ||
    getSanitizedRunDurationMs(run) !== undefined ||
    run.runScore !== undefined ||
    run.completedAt !== undefined
  );
}

function hasMythicPlusRunAbandonmentEvidence(run: MythicPlusRunDocument): boolean {
  return (
    run.abandonedAt !== undefined ||
    run.abandonReason !== undefined ||
    (run.endedAt !== undefined && !hasMythicPlusRunCompletionEvidence(run))
  );
}

export function getMythicPlusRunLifecycleStatus(
  run: MythicPlusRunDocument,
): MythicPlusRunStatus | undefined {
  if (run.status === "active" || run.status === "completed" || run.status === "abandoned") {
    return run.status;
  }

  if (hasMythicPlusRunCompletionEvidence(run)) {
    return "completed";
  }
  if (hasMythicPlusRunAbandonmentEvidence(run)) {
    return "abandoned";
  }

  return undefined;
}

function getRunStatusPriority(status: MythicPlusRunStatus | undefined): number {
  if (status === "completed") return 3;
  if (status === "abandoned") return 2;
  if (status === "active") return 1;
  return 0;
}

function isTemporaryAttemptFingerprint(fingerprint: string | undefined): boolean {
  return typeof fingerprint === "string" && fingerprint.startsWith("attempt|");
}

function getLikelyPlayedAtTimestamp(run: MythicPlusRunDocument) {
  const primaryTimestamp = run.endedAt ?? run.abandonedAt ?? run.completedAt ?? run.startDate;
  if (primaryTimestamp === undefined) {
    return run.observedAt ?? 0;
  }

  const observedAt = run.observedAt;
  if (observedAt !== undefined) {
    const driftSeconds = observedAt - primaryTimestamp;
    const roundedHourDriftSeconds = Math.round(driftSeconds / 3600) * 3600;
    const looksLikeLegacyUtcDrift =
      roundedHourDriftSeconds >= 3600 &&
      roundedHourDriftSeconds <= 3 * 3600 &&
      Math.abs(driftSeconds - roundedHourDriftSeconds) <= 10 * 60;

    if (looksLikeLegacyUtcDrift) {
      return primaryTimestamp + roundedHourDriftSeconds;
    }
  }

  if (shouldApplyLegacyHistoryDstForwardShift(run)) {
    return primaryTimestamp + LEGACY_DST_SHIFT_SECONDS;
  }

  return primaryTimestamp;
}

export function getMythicPlusRunSortValue(run: MythicPlusRunDocument) {
  return getLikelyPlayedAtTimestamp(run);
}

function getNormalizedMemberName(member: MythicPlusRunMember) {
  return member.name.trim().toLowerCase();
}

function getNormalizedMemberRealm(member: MythicPlusRunMember) {
  return member.realm?.trim().toLowerCase() ?? "";
}

function findMergeableRunMemberIndex(
  members: MythicPlusRunMember[],
  candidateMember: MythicPlusRunMember,
) {
  const candidateName = getNormalizedMemberName(candidateMember);
  const candidateRealm = getNormalizedMemberRealm(candidateMember);
  let exactIndex: number | undefined;
  let unresolvedIndex: number | undefined;
  let unresolvedCount = 0;
  let sameNameIndex: number | undefined;
  let sameNameCount = 0;

  for (let index = 0; index < members.length; index += 1) {
    const currentMember = members[index]!;
    if (getNormalizedMemberName(currentMember) !== candidateName) {
      continue;
    }

    sameNameCount += 1;
    sameNameIndex ??= index;
    const currentRealm = getNormalizedMemberRealm(currentMember);
    if (currentRealm === candidateRealm) {
      exactIndex = index;
      break;
    }
    if (currentRealm === "") {
      unresolvedIndex = index;
      unresolvedCount += 1;
    }
  }

  if (exactIndex !== undefined) {
    return exactIndex;
  }
  if (candidateRealm === "") {
    return sameNameCount === 1 ? unresolvedIndex ?? sameNameIndex : undefined;
  }

  return unresolvedCount === 1 ? unresolvedIndex : undefined;
}

function mergeMythicPlusRunMember(
  currentMember: MythicPlusRunMember | undefined,
  candidateMember: MythicPlusRunMember,
): MythicPlusRunMember {
  return {
    name: candidateMember.name,
    realm: candidateMember.realm ?? currentMember?.realm,
    classTag: candidateMember.classTag ?? currentMember?.classTag,
    role: candidateMember.role ?? currentMember?.role,
  };
}

export function mergeMythicPlusRunMembers(
  currentMembers: MythicPlusRunMember[] | undefined,
  candidateMembers: MythicPlusRunMember[] | undefined,
) {
  if (
    (!currentMembers || currentMembers.length === 0) &&
    (!candidateMembers || candidateMembers.length === 0)
  ) {
    return undefined;
  }

  const mergedMembers: MythicPlusRunMember[] = [];

  for (const members of [candidateMembers, currentMembers]) {
    for (const member of members ?? []) {
      const mergedIndex = findMergeableRunMemberIndex(mergedMembers, member);
      if (mergedIndex === undefined) {
        mergedMembers.push(member);
        continue;
      }

      mergedMembers[mergedIndex] = mergeMythicPlusRunMember(mergedMembers[mergedIndex], member);
    }
  }

  return mergedMembers.length > 0 ? mergedMembers : undefined;
}

export function getMythicPlusRunTimerMs(
  run: Pick<MythicPlusRunDocument, "mapChallengeModeID" | "mapName"> | string | null | undefined,
) {
  if (typeof run === "string") {
    return run.trim() === "" ? null : MYTHIC_PLUS_TIMER_MS_BY_MAP_NAME.get(normalizeMapName(run)) ?? null;
  }

  const mapChallengeModeID = run?.mapChallengeModeID;
  if (mapChallengeModeID !== undefined) {
    const timerByMapId = MYTHIC_PLUS_TIMER_MS_BY_MAP_ID.get(mapChallengeModeID);
    if (timerByMapId !== undefined) {
      return timerByMapId;
    }
  }

  const mapName = run?.mapName;
  if (typeof mapName !== "string" || mapName.trim() === "") {
    return null;
  }

  return MYTHIC_PLUS_TIMER_MS_BY_MAP_NAME.get(normalizeMapName(mapName)) ?? null;
}

export function getMythicPlusRunUpgradeCount(run: MythicPlusRunDocument): number | null {
  const durationMs = getSanitizedRunDurationMs(run);
  const timerMs = getMythicPlusRunTimerMs(run);
  if (timerMs !== null && durationMs !== undefined) {
    if (durationMs <= timerMs * 0.6) return 3;
    if (durationMs <= timerMs * 0.8) return 2;
    if (durationMs <= timerMs) return 1;
    return 0;
  }

  if (run.completedInTime !== undefined) {
    return run.completedInTime ? 1 : 0;
  }

  return null;
}

export function getMythicPlusRunTimedState(run: MythicPlusRunDocument): boolean | null {
  const upgradeCount = getMythicPlusRunUpgradeCount(run);
  if (upgradeCount === null) {
    return null;
  }

  return upgradeCount > 0;
}

function buildRunCanonicalKeyWithIdentityTimestamp(
  run: MythicPlusRunDocument,
  identityTimestamp: number,
): string | null {
  const mapToken = getRunMapFingerprintToken(run);
  if (mapToken === "" || run.level === undefined) {
    return null;
  }

  return [
    "run",
    toFingerprintToken(run.seasonID),
    mapToken,
    toFingerprintToken(run.level),
    toFingerprintToken(identityTimestamp),
  ].join("|");
}

export function getMythicPlusRunCanonicalKey(run: MythicPlusRunDocument): string | null {
  const explicitCanonicalKey = normalizeCanonicalKey(run.canonicalKey);
  if (explicitCanonicalKey !== null) {
    return explicitCanonicalKey;
  }

  const attemptId = getMythicPlusRunAttemptId(run);
  if (attemptId !== null) {
    return `aid|${attemptId}`;
  }

  const identityTimestamp = getRunCanonicalEventTimestamp(run);
  if (identityTimestamp === null) {
    return null;
  }

  return buildRunCanonicalKeyWithIdentityTimestamp(run, identityTimestamp);
}

export function buildCanonicalMythicPlusRunFingerprint(run: MythicPlusRunDocument) {
  return getMythicPlusRunCanonicalKey(run);
}

function getRunLegacyFingerprintAliasesForTimestamp(
  run: MythicPlusRunDocument,
  identityTimestamp: number,
): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();
  const mapTokens = getRunMapFingerprintTokens(run);
  const seasonTokens = getRunSeasonTokens(run);

  const pushAlias = (value: string | null) => {
    if (value === null || value === "" || seen.has(value)) {
      return;
    }
    seen.add(value);
    aliases.push(value);
  };

  pushAlias(buildRunFingerprintWithIdentity(run, identityTimestamp));

  for (const mapToken of mapTokens) {
    for (const seasonToken of seasonTokens) {
      pushAlias(buildRunFingerprintWithIdentity(run, identityTimestamp, { seasonToken, mapToken }));
    }
  }

  return aliases;
}

function getRunLegacyDstShiftCompatibilityTimestamps(run: MythicPlusRunDocument): number[] {
  if (hasValidStartDate(run) || !hasLegacyDstCompatibilitySignature(run)) {
    return [];
  }

  const derivedEnd = getRunDerivedEndTimestamp(run);
  const shiftSources = [run.completedAt, run.endedAt, run.abandonedAt, derivedEnd];
  const shiftedTimestamps: number[] = [];
  const seen = new Set<number>();

  for (const source of shiftSources) {
    const normalizedSource = normalizeLifecycleTimestamp(source);
    if (normalizedSource === null) {
      continue;
    }

    for (const shiftedTimestamp of [
      normalizedSource - LEGACY_DST_SHIFT_SECONDS,
      normalizedSource + LEGACY_DST_SHIFT_SECONDS,
    ]) {
      const normalizedShifted = normalizeLifecycleTimestamp(shiftedTimestamp);
      if (normalizedShifted === null || seen.has(normalizedShifted)) {
        continue;
      }
      seen.add(normalizedShifted);
      shiftedTimestamps.push(normalizedShifted);
    }
  }

  return shiftedTimestamps;
}

export function getMythicPlusRunCompatibilityLookupAliases(run: MythicPlusRunDocument): string[] {
  const aliases: string[] = [];
  const seen = new Set<string>();

  const pushAlias = (value: string | null | undefined) => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    aliases.push(value);
  };

  for (const timestamp of getRunCompatibilityTimestampAliases(run)) {
    for (const alias of getRunLegacyFingerprintAliasesForTimestamp(run, timestamp)) {
      pushAlias(alias);
    }
  }

  for (const timestamp of getRunLegacyDstShiftCompatibilityTimestamps(run)) {
    for (const alias of getRunLegacyFingerprintAliasesForTimestamp(run, timestamp)) {
      pushAlias(alias);
    }
  }

  pushAlias(run.fingerprint);
  return aliases;
}

function getRunStrictEventTimestamps(run: MythicPlusRunDocument): number[] {
  const timestamps: number[] = [];
  const seen = new Set<number>();

  const pushTimestamp = (value: number | null | undefined) => {
    const normalized = normalizeLifecycleTimestamp(value);
    if (normalized === null || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    timestamps.push(normalized);
  };

  pushTimestamp(run.startDate);
  pushTimestamp(run.completedAt);
  pushTimestamp(run.endedAt);
  pushTimestamp(run.abandonedAt);

  if (!hasValidStartDate(run)) {
    pushTimestamp(getRunDerivedStartTimestamp(run));
  }
  if (run.completedAt === undefined && run.endedAt === undefined && run.abandonedAt === undefined) {
    pushTimestamp(getRunDerivedEndTimestamp(run));
  }

  return timestamps;
}

function areRunCoreIdentityFieldsCompatible(
  a: MythicPlusRunDocument,
  b: MythicPlusRunDocument,
): boolean {
  const mapTokenA = getRunMapFingerprintToken(a);
  const mapTokenB = getRunMapFingerprintToken(b);
  if (mapTokenA === "" || mapTokenB === "" || mapTokenA !== mapTokenB) {
    return false;
  }

  if (a.level === undefined || b.level === undefined || a.level !== b.level) {
    return false;
  }

  const seasonTokenA = toFingerprintToken(a.seasonID);
  const seasonTokenB = toFingerprintToken(b.seasonID);
  if (seasonTokenA !== "" && seasonTokenB !== "" && seasonTokenA !== seasonTokenB) {
    return false;
  }

  return true;
}

function hasSharedStrictCompatibilityTimestamp(
  a: MythicPlusRunDocument,
  b: MythicPlusRunDocument,
): boolean {
  const timestampsA = new Set(getRunStrictEventTimestamps(a));
  for (const timestamp of getRunStrictEventTimestamps(b)) {
    if (timestampsA.has(timestamp)) {
      return true;
    }
  }

  return false;
}

function hasCompatibleLegacyDstShift(a: MythicPlusRunDocument, b: MythicPlusRunDocument): boolean {
  if (!hasLegacyDstCompatibilitySignature(a) || !hasLegacyDstCompatibilitySignature(b)) {
    return false;
  }

  const aTimestamps = getRunStrictEventTimestamps(a);
  const bTimestamps = getRunStrictEventTimestamps(b);
  if (aTimestamps.length === 0 || bTimestamps.length === 0) {
    return false;
  }

  const aDuration = getSanitizedRunDurationMs(a);
  const bDuration = getSanitizedRunDurationMs(b);
  if (
    aDuration !== undefined &&
    bDuration !== undefined &&
    Math.abs(aDuration - bDuration) > MAX_COMPAT_DURATION_DRIFT_MS
  ) {
    return false;
  }

  if (a.runScore !== undefined && b.runScore !== undefined && a.runScore !== b.runScore) {
    return false;
  }

  for (const timestampA of aTimestamps) {
    for (const timestampB of bTimestamps) {
      if (
        Math.abs(Math.abs(timestampA - timestampB) - LEGACY_DST_SHIFT_SECONDS) <=
        LEGACY_DST_SHIFT_TOLERANCE_SECONDS
      ) {
        return true;
      }
    }
  }

  return false;
}

export function canMergeMythicPlusRunsAcrossCanonicalMismatch(
  existingRun: MythicPlusRunDocument,
  candidateRun: MythicPlusRunDocument,
): boolean {
  return hasCompatibleLegacyDstShift(existingRun, candidateRun);
}

export function canUseMythicPlusRunCompatibilityAliasMatch(
  existingRun: MythicPlusRunDocument,
  candidateRun: MythicPlusRunDocument,
): boolean {
  const existingAttemptId = getMythicPlusRunAttemptId(existingRun);
  const candidateAttemptId = getMythicPlusRunAttemptId(candidateRun);
  if (existingAttemptId !== null && candidateAttemptId !== null) {
    return existingAttemptId === candidateAttemptId;
  }

  if (!areRunCoreIdentityFieldsCompatible(existingRun, candidateRun)) {
    return false;
  }

  if (hasSharedStrictCompatibilityTimestamp(existingRun, candidateRun)) {
    return true;
  }

  return hasCompatibleLegacyDstShift(existingRun, candidateRun);
}

export function getMythicPlusRunCompletenessScore(run: MythicPlusRunDocument) {
  let score = 0;
  const status = getMythicPlusRunLifecycleStatus(run);
  const durationMs = getSanitizedRunDurationMs(run);

  if (run.seasonID !== undefined) score += 1;
  if (run.mapChallengeModeID !== undefined) score += 3;
  if (typeof run.mapName === "string" && run.mapName.trim() !== "") score += 1;
  if (run.level !== undefined) score += 2;
  if (getMythicPlusRunAttemptId(run) !== null) score += 4;
  if (getMythicPlusRunCanonicalKey(run) !== null) score += 4;
  if (status === "active") score += 2;
  if (status === "abandoned") score += 3;
  if (status === "completed") score += 4;
  if (run.startDate !== undefined) score += 4;
  if (run.completedAt !== undefined) score += 4;
  if (run.endedAt !== undefined) score += 3;
  if (run.abandonedAt !== undefined) score += 2;
  if (run.abandonReason !== undefined) score += 1;
  if (durationMs !== undefined) score += 3;
  if (run.runScore !== undefined) score += 3;
  if (run.completedInTime !== undefined) score += 2;
  if (run.completed !== undefined) score += 1;
  if (run.thisWeek !== undefined) score += 1;
  if ((run.members?.length ?? 0) > 0) score += 3;

  return score;
}

export function shouldReplaceMythicPlusRun(
  currentRun: MythicPlusRunDocument | undefined,
  candidateRun: MythicPlusRunDocument,
) {
  if (!currentRun) {
    return true;
  }

  const currentStatus = getMythicPlusRunLifecycleStatus(currentRun);
  const candidateStatus = getMythicPlusRunLifecycleStatus(candidateRun);
  const currentStatusPriority = getRunStatusPriority(currentStatus);
  const candidateStatusPriority = getRunStatusPriority(candidateStatus);
  if (candidateStatusPriority !== currentStatusPriority) {
    return candidateStatusPriority > currentStatusPriority;
  }

  const currentCanonicalFingerprint = getMythicPlusRunCanonicalKey(currentRun);
  const candidateCanonicalFingerprint = getMythicPlusRunCanonicalKey(candidateRun);
  if (
    currentCanonicalFingerprint !== null &&
    candidateCanonicalFingerprint !== null &&
    currentCanonicalFingerprint === candidateCanonicalFingerprint
  ) {
    const currentIsTemporary = isTemporaryAttemptFingerprint(currentRun.fingerprint);
    const candidateIsTemporary = isTemporaryAttemptFingerprint(candidateRun.fingerprint);
    if (currentIsTemporary !== candidateIsTemporary) {
      return !candidateIsTemporary;
    }
  }

  const currentScore = getMythicPlusRunCompletenessScore(currentRun);
  const candidateScore = getMythicPlusRunCompletenessScore(candidateRun);
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  const currentSortValue = getMythicPlusRunSortValue(currentRun);
  const candidateSortValue = getMythicPlusRunSortValue(candidateRun);
  if (candidateSortValue !== currentSortValue) {
    return candidateSortValue > currentSortValue;
  }

  return (candidateRun.observedAt ?? 0) > (currentRun.observedAt ?? 0);
}

function getRunTimestamp(run: MythicPlusRunDocument): number {
  return getMythicPlusRunSortValue(run);
}

function getMapLabel(run: MythicPlusRunDocument): string {
  if (run.mapName && run.mapName.trim() !== "") return run.mapName;
  if (run.mapChallengeModeID !== undefined) return `Dungeon ${run.mapChallengeModeID}`;
  return "Unknown Dungeon";
}

function getMythicPlusRunProgressionKey(run: MythicPlusRunDocument): string {
  const mapToken =
    run.mapChallengeModeID !== undefined
      ? String(run.mapChallengeModeID)
      : getMapLabel(run).trim().toLowerCase();
  const seasonToken = run.seasonID !== undefined ? String(run.seasonID) : "unknown";
  return `${seasonToken}|${mapToken}`;
}

function isCompletedRun(run: MythicPlusRunDocument): boolean {
  return getMythicPlusRunLifecycleStatus(run) === "completed";
}

function isAbandonedRun(run: MythicPlusRunDocument): boolean {
  return getMythicPlusRunLifecycleStatus(run) === "abandoned";
}

function isActiveRun(run: MythicPlusRunDocument): boolean {
  return getMythicPlusRunLifecycleStatus(run) === "active";
}

function isTerminalRun(run: MythicPlusRunDocument): boolean {
  return isCompletedRun(run) || isAbandonedRun(run);
}

function isTimedRun(run: MythicPlusRunDocument): boolean | null {
  return getMythicPlusRunTimedState(run);
}

function shouldReplaceBestTimedRun(
  currentRun: MythicPlusRunDocument | null,
  candidateRun: MythicPlusRunDocument,
) {
  if (!currentRun) {
    return true;
  }

  const currentLevel = currentRun.level ?? -1;
  const candidateLevel = candidateRun.level ?? -1;
  if (candidateLevel !== currentLevel) {
    return candidateLevel > currentLevel;
  }

  const currentUpgradeCount = getMythicPlusRunUpgradeCount(currentRun) ?? -1;
  const candidateUpgradeCount = getMythicPlusRunUpgradeCount(candidateRun) ?? -1;
  if (candidateUpgradeCount !== currentUpgradeCount) {
    return candidateUpgradeCount > currentUpgradeCount;
  }

  const currentScore = currentRun.runScore ?? -1;
  const candidateScore = candidateRun.runScore ?? -1;
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  const currentDuration = currentRun.durationMs ?? Number.MAX_SAFE_INTEGER;
  const candidateDuration = candidateRun.durationMs ?? Number.MAX_SAFE_INTEGER;
  if (candidateDuration !== currentDuration) {
    return candidateDuration < currentDuration;
  }

  return getRunTimestamp(candidateRun) > getRunTimestamp(currentRun);
}

function buildMythicPlusBucketSummary(runs: MythicPlusRunDocument[]) {
  let totalAttempts = 0;
  let completedRuns = 0;
  let abandonedRuns = 0;
  let activeRuns = 0;
  let timedRuns = 0;
  let timed2To9 = 0;
  let timed10To11 = 0;
  let timed12To13 = 0;
  let timed14Plus = 0;
  let bestLevel: number | null = null;
  let bestScore: number | null = null;
  let totalLevel = 0;
  let levelCount = 0;
  let totalScore = 0;
  let scoreCount = 0;
  let lastRunAt: number | null = null;
  let bestTimedRun: MythicPlusRunDocument | null = null;

  for (const run of runs) {
    const runAt = getRunTimestamp(run);
    if (lastRunAt === null || runAt > lastRunAt) {
      lastRunAt = runAt;
    }

    const completed = isCompletedRun(run);
    const abandoned = isAbandonedRun(run);
    const active = isActiveRun(run);

    if (completed) {
      completedRuns += 1;
      totalAttempts += 1;
    } else if (abandoned) {
      abandonedRuns += 1;
      totalAttempts += 1;
    } else if (active) {
      activeRuns += 1;
    }

    if (completed && isTimedRun(run)) {
      timedRuns += 1;
      if (shouldReplaceBestTimedRun(bestTimedRun, run)) {
        bestTimedRun = run;
      }
      const level = run.level ?? 0;

      if (level >= 14) {
        timed14Plus += 1;
      } else if (level >= 12) {
        timed12To13 += 1;
      } else if (level >= 10) {
        timed10To11 += 1;
      } else if (level >= 2) {
        timed2To9 += 1;
      }
    }

    if ((completed || abandoned) && run.level !== undefined) {
      bestLevel = bestLevel === null ? run.level : Math.max(bestLevel, run.level);
      totalLevel += run.level;
      levelCount += 1;
    }

    if ((completed || abandoned) && run.runScore !== undefined) {
      bestScore = bestScore === null ? run.runScore : Math.max(bestScore, run.runScore);
      totalScore += run.runScore;
      scoreCount += 1;
    }
  }

  return {
    totalRuns: totalAttempts,
    totalAttempts,
    completedRuns,
    abandonedRuns,
    activeRuns,
    timedRuns,
    timed2To9,
    timed10To11,
    timed12To13,
    timed14Plus,
    bestLevel,
    bestTimedLevel: bestTimedRun?.level ?? null,
    bestTimedUpgradeCount: bestTimedRun ? getMythicPlusRunUpgradeCount(bestTimedRun) : null,
    bestTimedScore: bestTimedRun?.runScore ?? null,
    bestTimedDurationMs: bestTimedRun?.durationMs ?? null,
    bestScore,
    averageLevel: levelCount > 0 ? totalLevel / levelCount : null,
    averageScore: scoreCount > 0 ? totalScore / scoreCount : null,
    lastRunAt,
  };
}

function buildDungeonSummaries(runs: MythicPlusRunDocument[]) {
  const byDungeon = new Map<
    string,
    {
      mapChallengeModeID: number | null;
      mapName: string;
      totalRuns: number;
      timedRuns: number;
      bestLevel: number | null;
      bestTimedRun: MythicPlusRunDocument | null;
      bestScore: number | null;
      lastRunAt: number | null;
    }
  >();

  for (const run of runs) {
    if (!isTerminalRun(run)) {
      continue;
    }

    const key = String(run.mapChallengeModeID ?? getMapLabel(run));
    const current = byDungeon.get(key) ?? {
      mapChallengeModeID: run.mapChallengeModeID ?? null,
      mapName: getMapLabel(run),
      totalRuns: 0,
      timedRuns: 0,
      bestLevel: null,
      bestTimedRun: null,
      bestScore: null,
      lastRunAt: null,
    };

    current.totalRuns += 1;
    if (isCompletedRun(run) && isTimedRun(run)) {
      current.timedRuns += 1;
      if (shouldReplaceBestTimedRun(current.bestTimedRun, run)) {
        current.bestTimedRun = run;
      }
    }
    if (run.level !== undefined) {
      current.bestLevel = current.bestLevel === null ? run.level : Math.max(current.bestLevel, run.level);
    }
    if (run.runScore !== undefined) {
      current.bestScore =
        current.bestScore === null ? run.runScore : Math.max(current.bestScore, run.runScore);
    }

    const runAt = getRunTimestamp(run);
    current.lastRunAt = current.lastRunAt === null ? runAt : Math.max(current.lastRunAt, runAt);
    byDungeon.set(key, current);
  }

  return Array.from(byDungeon.values())
    .map((dungeon) => ({
      mapChallengeModeID: dungeon.mapChallengeModeID,
      mapName: dungeon.mapName,
      totalRuns: dungeon.totalRuns,
      timedRuns: dungeon.timedRuns,
      bestLevel: dungeon.bestLevel,
      bestTimedLevel: dungeon.bestTimedRun?.level ?? null,
      bestTimedUpgradeCount: dungeon.bestTimedRun
        ? getMythicPlusRunUpgradeCount(dungeon.bestTimedRun)
        : null,
      bestTimedScore: dungeon.bestTimedRun?.runScore ?? null,
      bestTimedDurationMs: dungeon.bestTimedRun?.durationMs ?? null,
      bestScore: dungeon.bestScore,
      lastRunAt: dungeon.lastRunAt,
    }))
    .sort((a, b) => {
      const timedA = a.bestTimedLevel ?? -1;
      const timedB = b.bestTimedLevel ?? -1;
      if (timedB !== timedA) return timedB - timedA;
      const upgradesA = a.bestTimedUpgradeCount ?? 0;
      const upgradesB = b.bestTimedUpgradeCount ?? 0;
      if (upgradesB !== upgradesA) return upgradesB - upgradesA;
      const timedScoreA = a.bestTimedScore ?? -1;
      const timedScoreB = b.bestTimedScore ?? -1;
      if (timedScoreB !== timedScoreA) return timedScoreB - timedScoreA;
      const timedDurationA = a.bestTimedDurationMs ?? Number.MAX_SAFE_INTEGER;
      const timedDurationB = b.bestTimedDurationMs ?? Number.MAX_SAFE_INTEGER;
      if (timedDurationA !== timedDurationB) return timedDurationA - timedDurationB;
      const bestA = a.bestLevel ?? -1;
      const bestB = b.bestLevel ?? -1;
      if (bestB !== bestA) return bestB - bestA;
      return b.timedRuns - a.timedRuns;
    });
}

function getRunMemberIdentityFingerprint(run: MythicPlusRunDocument) {
  return (run.members ?? [])
    .map((member) =>
      [
        member.name.trim().toLowerCase(),
        member.realm?.trim().toLowerCase() ?? "",
        member.role ?? "",
        member.classTag?.trim().toLowerCase() ?? "",
      ].join("|"),
    )
    .sort()
    .join(",");
}

function getLegacyDisplayDuplicateSignature(run: MythicPlusRunDocument) {
  if (!isCompletedRun(run) || run.level === undefined || run.durationMs === undefined) {
    return null;
  }

  const mapToken =
    run.mapChallengeModeID !== undefined
      ? String(run.mapChallengeModeID)
      : getMapLabel(run).trim().toLowerCase();
  const timedToken = String(getMythicPlusRunTimedState(run) ?? "unknown");
  return `${mapToken}|${run.level}|${run.durationMs}|${timedToken}`;
}

function areLegacyDisplayDuplicatePartiesCompatible(
  a: MythicPlusRunDocument,
  b: MythicPlusRunDocument,
) {
  const partyFingerprintA = getRunMemberIdentityFingerprint(a);
  const partyFingerprintB = getRunMemberIdentityFingerprint(b);
  if (partyFingerprintA === "" || partyFingerprintB === "") {
    return true;
  }
  if (partyFingerprintA === partyFingerprintB) {
    return true;
  }

  const mergedMembers = mergeMythicPlusRunMembers(a.members, b.members);
  if (!mergedMembers) {
    return false;
  }

  return mergedMembers.length <= Math.max(a.members?.length ?? 0, b.members?.length ?? 0);
}

function mergeLegacyDisplayDuplicateRuns(
  currentRun: MythicPlusRunDocument,
  candidateRun: MythicPlusRunDocument,
): MythicPlusRunDocument {
  const candidatePreferred = shouldReplaceMythicPlusRun(currentRun, candidateRun);
  const preferredRun = candidatePreferred ? candidateRun : currentRun;
  const fallbackRun = candidatePreferred ? currentRun : candidateRun;

  return {
    ...fallbackRun,
    ...preferredRun,
    members: mergeMythicPlusRunMembers(currentRun.members, candidateRun.members),
  };
}

function collapseLegacyDisplayDuplicateRuns(runs: MythicPlusRunDocument[]) {
  const collapsedRuns: MythicPlusRunDocument[] = [];
  const collapseIndexesBySignature = new Map<string, number[]>();

  for (const run of runs) {
    const signature = getLegacyDisplayDuplicateSignature(run);
    if (!signature) {
      collapsedRuns.push(run);
      continue;
    }

    const playedAt = getRunTimestamp(run);
    const candidateIndexes = collapseIndexesBySignature.get(signature) ?? [];
    let matchedIndex = -1;

    for (const candidateIndex of candidateIndexes) {
      const currentRun = collapsedRuns[candidateIndex];
      if (!currentRun) {
        continue;
      }
      if (
        Math.abs(getRunTimestamp(currentRun) - playedAt) >
        LEGACY_DISPLAY_DUPLICATE_RUN_TOLERANCE_SECONDS
      ) {
        continue;
      }
      if (!areLegacyDisplayDuplicatePartiesCompatible(currentRun, run)) {
        continue;
      }

      matchedIndex = candidateIndex;
      break;
    }

    if (matchedIndex < 0) {
      collapseIndexesBySignature.set(signature, [...candidateIndexes, collapsedRuns.length]);
      collapsedRuns.push(run);
      continue;
    }

    collapsedRuns[matchedIndex] = mergeLegacyDisplayDuplicateRuns(collapsedRuns[matchedIndex]!, run);
  }

  return collapsedRuns;
}

export function buildMythicPlusSummary(
  runs: MythicPlusRunDocument[],
  currentScore: number | null,
): MythicPlusSummary {
  const normalizedRuns = collapseLegacyDisplayDuplicateRuns(runs);
  let latestSeasonID: number | null = null;
  for (const run of normalizedRuns) {
    if (run.seasonID === undefined) {
      continue;
    }
    latestSeasonID = latestSeasonID === null ? run.seasonID : Math.max(latestSeasonID, run.seasonID);
  }

  const currentSeasonRuns =
    latestSeasonID === null ? [] : normalizedRuns.filter((run) => run.seasonID === latestSeasonID);

  return {
    latestSeasonID,
    currentScore,
    overall: buildMythicPlusBucketSummary(normalizedRuns),
    currentSeason: latestSeasonID === null ? null : buildMythicPlusBucketSummary(currentSeasonRuns),
    currentSeasonDungeons: buildDungeonSummaries(currentSeasonRuns),
  };
}

export function buildRecentRuns(runs: MythicPlusRunDocument[]): MythicPlusRecentRunPreview[] {
  const normalizedRuns = collapseLegacyDisplayDuplicateRuns(runs);
  const bestPreviousScoreByDungeon = new Map<string, number>();
  const scoreIncreaseByRunId = new Map<string, number>();

  const normalizeIdentityToken = (value: string | undefined): string | null => {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized === "" ? null : normalized;
  };

  const getRecentRunRowKey = (run: MythicPlusRunDocument, playedAt: number): string => {
    if (typeof run._id === "string" && run._id.trim() !== "") {
      return run._id;
    }

    const identityTokens: string[] = [];
    const attemptId = getMythicPlusRunAttemptId(run);
    if (attemptId !== null) {
      identityTokens.push(`aid:${attemptId}`);
    }

    const canonicalKey = getMythicPlusRunCanonicalKey(run);
    if (canonicalKey !== null) {
      identityTokens.push(`ck:${canonicalKey}`);
    }

    const fingerprint = normalizeIdentityToken(run.fingerprint);
    if (fingerprint !== null) {
      identityTokens.push(`fp:${fingerprint}`);
    }

    const identityComposite = identityTokens.length > 0 ? identityTokens.join("|") : "run";
    return `${identityComposite}|${playedAt}`;
  };

  for (let index = normalizedRuns.length - 1; index >= 0; index -= 1) {
    const run = normalizedRuns[index];
    if (!run || !isCompletedRun(run) || run.runScore === undefined) {
      continue;
    }

    const progressionKey = getMythicPlusRunProgressionKey(run);
    const bestPreviousScore = bestPreviousScoreByDungeon.get(progressionKey);
    if (run._id) {
      if (bestPreviousScore === undefined) {
        if (run.runScore > 0) {
          scoreIncreaseByRunId.set(run._id, run.runScore);
        }
      } else if (run.runScore > bestPreviousScore) {
        scoreIncreaseByRunId.set(run._id, run.runScore - bestPreviousScore);
      }
    }

    bestPreviousScoreByDungeon.set(
      progressionKey,
      bestPreviousScore === undefined ? run.runScore : Math.max(bestPreviousScore, run.runScore),
    );
  }

  return normalizedRuns.map((run) => {
    const status = getMythicPlusRunLifecycleStatus(run);
    const sortTimestamp = getRunTimestamp(run);
    return {
      ...(run._id ? { _id: run._id } : {}),
      ...(run._creationTime !== undefined ? { _creationTime: run._creationTime } : {}),
      rowKey: getRecentRunRowKey(run, sortTimestamp),
      fingerprint: run.fingerprint ?? "",
      ...(run.attemptId ? { attemptId: run.attemptId } : {}),
      ...(run.canonicalKey ? { canonicalKey: run.canonicalKey } : {}),
      observedAt: run.observedAt ?? 0,
      playedAt: sortTimestamp,
      sortTimestamp,
      ...(run.seasonID !== undefined ? { seasonID: run.seasonID } : {}),
      ...(run.mapChallengeModeID !== undefined ? { mapChallengeModeID: run.mapChallengeModeID } : {}),
      ...(run.mapName ? { mapName: run.mapName } : {}),
      ...(run.level !== undefined ? { level: run.level } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(run.completed !== undefined ? { completed: run.completed } : {}),
      ...(run.completedInTime !== undefined ? { completedInTime: run.completedInTime } : {}),
      ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
      ...(run.runScore !== undefined ? { runScore: run.runScore } : {}),
      ...(run.startDate !== undefined ? { startDate: run.startDate } : {}),
      ...(run.completedAt !== undefined ? { completedAt: run.completedAt } : {}),
      ...(run.endedAt !== undefined ? { endedAt: run.endedAt } : {}),
      ...(run.abandonedAt !== undefined ? { abandonedAt: run.abandonedAt } : {}),
      ...(run.abandonReason !== undefined ? { abandonReason: run.abandonReason } : {}),
      ...(run.thisWeek !== undefined ? { thisWeek: run.thisWeek } : {}),
      ...(run.members ? { members: run.members } : {}),
      upgradeCount: getMythicPlusRunUpgradeCount(run),
      scoreIncrease: run._id ? (scoreIncreaseByRunId.get(run._id) ?? null) : null,
    };
  });
}

export function dedupeMythicPlusRuns(runs: MythicPlusRunDocument[]) {
  const dedupedRuns: MythicPlusRunDocument[] = [];
  const runLookups = {
    byAttemptId: new Map<string, number>(),
    byCanonicalKey: new Map<string, number>(),
    byCompatibilityAlias: new Map<string, number>(),
  };

  const pickDefinedValue = <T>(preferredValue: T | undefined, fallbackValue: T | undefined) =>
    preferredValue !== undefined ? preferredValue : fallbackValue;

  const mergeLifecycleTimestamp = (
    preferredValue: number | undefined,
    fallbackValue: number | undefined,
  ): number | undefined => {
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
  };

  const setPreferredRunLookup = (
    map: Map<string, number>,
    key: string | undefined | null,
    runIndex: number,
  ) => {
    if (!key) {
      return;
    }

    const currentIndex = map.get(key);
    if (
      currentIndex === undefined ||
      shouldReplaceMythicPlusRun(dedupedRuns[currentIndex], dedupedRuns[runIndex]!)
    ) {
      map.set(key, runIndex);
    }
  };

  const registerRunLookups = (
    run: MythicPlusRunDocument,
    runIndex: number,
    aliases: Array<string | undefined | null> = [],
  ) => {
    setPreferredRunLookup(runLookups.byAttemptId, getMythicPlusRunAttemptId(run), runIndex);
    setPreferredRunLookup(runLookups.byCanonicalKey, getMythicPlusRunCanonicalKey(run), runIndex);

    const compatibilityAliases = new Set<string>();
    for (const alias of getMythicPlusRunCompatibilityLookupAliases(run)) {
      compatibilityAliases.add(alias);
    }
    for (const alias of aliases) {
      if (alias) {
        compatibilityAliases.add(alias);
      }
    }

    for (const alias of compatibilityAliases) {
      setPreferredRunLookup(runLookups.byCompatibilityAlias, alias, runIndex);
    }
  };

  const findMatchingRunIndex = (run: MythicPlusRunDocument) => {
    const attemptId = getMythicPlusRunAttemptId(run);
    if (attemptId) {
      const attemptMatchIndex = runLookups.byAttemptId.get(attemptId);
      if (attemptMatchIndex !== undefined) {
        return attemptMatchIndex;
      }
    }

    const canonicalKey = getMythicPlusRunCanonicalKey(run);
    if (canonicalKey) {
      const canonicalMatchIndex = runLookups.byCanonicalKey.get(canonicalKey);
      if (canonicalMatchIndex !== undefined) {
        return canonicalMatchIndex;
      }
    }

    for (const compatibilityAlias of getMythicPlusRunCompatibilityLookupAliases(run)) {
      const candidateIndex = runLookups.byCompatibilityAlias.get(compatibilityAlias);
      if (candidateIndex === undefined) {
        continue;
      }

      const candidate = dedupedRuns[candidateIndex];
      if (!candidate || !canUseMythicPlusRunCompatibilityAliasMatch(candidate, run)) {
        continue;
      }

      const candidateCanonicalKey = getMythicPlusRunCanonicalKey(candidate);
      if (
        canonicalKey &&
        candidateCanonicalKey &&
        canonicalKey !== candidateCanonicalKey &&
        !canMergeMythicPlusRunsAcrossCanonicalMismatch(candidate, run)
      ) {
        continue;
      }

      return candidateIndex;
    }

    for (let candidateIndex = 0; candidateIndex < dedupedRuns.length; candidateIndex += 1) {
      const candidate = dedupedRuns[candidateIndex];
      if (!candidate || !canUseMythicPlusRunCompatibilityAliasMatch(candidate, run)) {
        continue;
      }

      const candidateCanonicalKey = getMythicPlusRunCanonicalKey(candidate);
      if (
        canonicalKey &&
        candidateCanonicalKey &&
        canonicalKey !== candidateCanonicalKey &&
        !canMergeMythicPlusRunsAcrossCanonicalMismatch(candidate, run)
      ) {
        continue;
      }

      return candidateIndex;
    }

    return -1;
  };

  const mergeDuplicateRuns = (currentRun: MythicPlusRunDocument, candidateRun: MythicPlusRunDocument) => {
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

    const merged: MythicPlusRunDocument = {
      ...fallbackRun,
      ...preferredRun,
      fingerprint:
        buildCanonicalMythicPlusRunFingerprint(preferredRun) ??
        buildCanonicalMythicPlusRunFingerprint(fallbackRun) ??
        preferredRun.fingerprint,
      observedAt:
        mergedObservedAt > 0
          ? mergedObservedAt
          : pickDefinedValue(preferredRun.observedAt, fallbackRun.observedAt) ?? 0,
      attemptId: pickDefinedValue(
        getMythicPlusRunAttemptId(preferredRun) ?? undefined,
        getMythicPlusRunAttemptId(fallbackRun) ?? undefined,
      ),
      canonicalKey: pickDefinedValue(
        getMythicPlusRunCanonicalKey(preferredRun) ?? undefined,
        getMythicPlusRunCanonicalKey(fallbackRun) ?? undefined,
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
    merged.canonicalKey = getMythicPlusRunCanonicalKey(merged) ?? merged.canonicalKey;
    merged.attemptId = getMythicPlusRunAttemptId(merged) ?? merged.attemptId;

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
  };

  for (const run of runs) {
    const matchIndex = findMatchingRunIndex(run);

    if (matchIndex < 0) {
      dedupedRuns.push(run);
      registerRunLookups(run, dedupedRuns.length - 1);
      continue;
    }

    const currentRun = dedupedRuns[matchIndex]!;
    const mergedRun = mergeDuplicateRuns(currentRun, run);
    dedupedRuns[matchIndex] = mergedRun;
    registerRunLookups(mergedRun, matchIndex, [
      currentRun.fingerprint,
      getMythicPlusRunAttemptId(currentRun),
      getMythicPlusRunCanonicalKey(currentRun),
      run.fingerprint,
      getMythicPlusRunAttemptId(run),
      getMythicPlusRunCanonicalKey(run),
      mergedRun.fingerprint,
      getMythicPlusRunAttemptId(mergedRun),
      getMythicPlusRunCanonicalKey(mergedRun),
    ]);
  }

  return dedupedRuns.sort((a, b) => {
    const timeDiff = getRunTimestamp(b) - getRunTimestamp(a);
    if (timeDiff !== 0) return timeDiff;
    return (b.observedAt ?? 0) - (a.observedAt ?? 0);
  });
}
