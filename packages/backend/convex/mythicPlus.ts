export type MythicPlusRunStatus = "active" | "completed" | "abandoned";
export type MythicPlusRunAbandonReason =
  | "challenge_mode_reset"
  | "left_instance"
  | "leaver_timer"
  | "history_incomplete"
  | "stale_recovery"
  | "unknown";

type MythicPlusRunLike = {
  _id?: string;
  fingerprint?: string;
  attemptId?: string;
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
  abandonReason?: MythicPlusRunAbandonReason;
  thisWeek?: boolean;
  members?: {
    name: string;
    realm?: string;
    classTag?: string;
    role?: "tank" | "healer" | "dps";
  }[];
};

type MythicPlusRunMemberLike = NonNullable<MythicPlusRunLike["members"]>[number];

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

function normalizeMapName(mapName: string) {
  return mapName.trim().toLowerCase();
}

const MYTHIC_PLUS_TIMER_MS_BY_MAP_ID = new Map<number, number>(
  MYTHIC_PLUS_DUNGEONS.map((dungeon) => [dungeon.mapChallengeModeID, dungeon.timerMs] as const),
);
const MYTHIC_PLUS_TIMER_MS_BY_MAP_NAME = new Map<string, number>(
  MYTHIC_PLUS_DUNGEONS.map((dungeon) => [normalizeMapName(dungeon.name), dungeon.timerMs] as const),
);
const MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS = 4 * 60 * 60 * 1000;
const LEGACY_DST_SHIFT_SECONDS = 60 * 60;

function toFingerprintToken(value: boolean | number | string | null | undefined) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return value;
}

function getRunMapFingerprintTokens(run: MythicPlusRunLike): string[] {
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
    if (normalizedName !== "") pushToken(normalizedName);
  }

  return tokens;
}

function getRunMapFingerprintToken(run: MythicPlusRunLike) {
  return getRunMapFingerprintTokens(run)[0] ?? "";
}

function normalizeAttemptId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function buildRunAttemptIdFromStartDate(run: MythicPlusRunLike): string | null {
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

function getRunAttemptId(run: MythicPlusRunLike): string | null {
  const explicitAttemptId = normalizeAttemptId(run.attemptId);
  if (explicitAttemptId !== null) {
    return explicitAttemptId;
  }

  const fingerprint = normalizeAttemptId(run.fingerprint);
  if (fingerprint !== null && fingerprint.startsWith("attempt|")) {
    return fingerprint;
  }

  return buildRunAttemptIdFromStartDate(run);
}

function getRunSeasonTokens(run: MythicPlusRunLike): string[] {
  const seasonToken = run.seasonID !== undefined ? toFingerprintToken(run.seasonID) : "";
  return seasonToken === "" ? [""] : [seasonToken, ""];
}

function getRunDurationSeconds(run: MythicPlusRunLike): number | null {
  const durationMs = getSanitizedRunDurationMs(run);
  if (durationMs === undefined) return null;
  return Math.floor(durationMs / 1000 + 0.5);
}

function getSanitizedRunDurationMs(run: MythicPlusRunLike): number | undefined {
  const durationMs = run.durationMs;
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) {
    return undefined;
  }
  if (durationMs <= MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS) {
    return Math.floor(durationMs);
  }

  const runEndAt = run.completedAt ?? run.endedAt ?? run.abandonedAt;
  if (
    run.startDate !== undefined &&
    runEndAt !== undefined &&
    runEndAt >= run.startDate
  ) {
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

function getRunDerivedStartTimestamp(run: MythicPlusRunLike): number | null {
  if (run.startDate !== undefined) return run.startDate;

  const durationSeconds = getRunDurationSeconds(run);
  const endAt = run.completedAt ?? run.endedAt ?? run.abandonedAt;
  if (durationSeconds !== null && endAt !== undefined) {
    return endAt - durationSeconds;
  }

  return null;
}

function getRunDerivedEndTimestamp(run: MythicPlusRunLike): number | null {
  if (run.completedAt !== undefined) return run.completedAt;
  if (run.endedAt !== undefined) return run.endedAt;
  if (run.abandonedAt !== undefined) return run.abandonedAt;

  const durationSeconds = getRunDurationSeconds(run);
  if (durationSeconds !== null && run.startDate !== undefined) {
    return run.startDate + durationSeconds;
  }

  return null;
}

function hasStrongCompletedRunIdentitySignature(run: MythicPlusRunLike): boolean {
  return (
    run.level !== undefined &&
    getRunMapFingerprintToken(run) !== "" &&
    getSanitizedRunDurationMs(run) !== undefined &&
    run.runScore !== undefined
  );
}

function shouldApplyLegacyHistoryDstForwardShift(run: MythicPlusRunLike): boolean {
  if (getRunAttemptId(run) !== null) {
    return false;
  }
  if (run.startDate !== undefined) {
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

function getRunIdentityCandidates(run: MythicPlusRunLike): number[] {
  const candidates: number[] = [];
  const seen = new Set<number>();

  const pushCandidate = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return;
    const normalized = Math.floor(value);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  const derivedStart = getRunDerivedStartTimestamp(run);
  const derivedEnd = getRunDerivedEndTimestamp(run);
  // Legacy priority (older parser/addon behavior).
  pushCandidate(run.startDate);
  pushCandidate(run.completedAt);
  pushCandidate(run.endedAt);
  pushCandidate(run.abandonedAt);

  // Derived compatibility keys to bridge old/new payload shapes.
  pushCandidate(derivedStart);
  pushCandidate(derivedEnd);
  const likelyPlayedAt = getLikelyPlayedAtTimestamp(run);
  pushCandidate(likelyPlayedAt);
  if (likelyPlayedAt > 0) {
    pushCandidate(Math.floor(likelyPlayedAt / 60) * 60);
  }

  // Compatibility alias for legacy vs new completion timestamps around DST
  // transitions. Restrict to strong completed-run signatures and history-like
  // rows (no explicit startDate) to avoid over-merging genuinely distinct runs.
  if (run.startDate === undefined && hasStrongCompletedRunIdentitySignature(run)) {
    const shiftSources = [run.completedAt, run.endedAt, run.abandonedAt, derivedEnd];
    for (const source of shiftSources) {
      if (source === undefined || source === null) continue;
      pushCandidate(source - LEGACY_DST_SHIFT_SECONDS);
      pushCandidate(source + LEGACY_DST_SHIFT_SECONDS);
    }
  }

  return candidates;
}

function buildRunFingerprintWithIdentity(
  run: MythicPlusRunLike,
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

function getRunIdentityTimestamp(run: MythicPlusRunLike) {
  return getRunIdentityCandidates(run)[0] ?? null;
}

export function hasMythicPlusRunCompletionEvidence(run: MythicPlusRunLike): boolean {
  return run.completed === true || getSanitizedRunDurationMs(run) !== undefined || run.runScore !== undefined || run.completedAt !== undefined;
}

function hasMythicPlusRunAbandonmentEvidence(run: MythicPlusRunLike): boolean {
  return run.abandonedAt !== undefined ||
    run.abandonReason !== undefined ||
    (run.endedAt !== undefined && !hasMythicPlusRunCompletionEvidence(run));
}

export function getMythicPlusRunLifecycleStatus(
  run: MythicPlusRunLike,
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

function getLikelyPlayedAtTimestamp(run: MythicPlusRunLike) {
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

export function getMythicPlusRunSortValue(run: MythicPlusRunLike) {
  return getLikelyPlayedAtTimestamp(run);
}

function getNormalizedMemberName(member: MythicPlusRunMemberLike) {
  return member.name.trim().toLowerCase();
}

function getNormalizedMemberRealm(member: MythicPlusRunMemberLike) {
  return member.realm?.trim().toLowerCase() ?? "";
}

function findMergeableRunMemberIndex(
  members: MythicPlusRunMemberLike[],
  candidateMember: MythicPlusRunMemberLike,
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
  currentMember: MythicPlusRunMemberLike | undefined,
  candidateMember: MythicPlusRunMemberLike,
): MythicPlusRunMemberLike {
  return {
    name: candidateMember.name,
    realm: candidateMember.realm ?? currentMember?.realm,
    classTag: candidateMember.classTag ?? currentMember?.classTag,
    role: candidateMember.role ?? currentMember?.role,
  };
}

export function mergeMythicPlusRunMembers(
  currentMembers: MythicPlusRunLike["members"] | undefined,
  candidateMembers: MythicPlusRunLike["members"] | undefined,
) {
  if ((!currentMembers || currentMembers.length === 0) && (!candidateMembers || candidateMembers.length === 0)) {
    return undefined;
  }

  const mergedMembers: MythicPlusRunMemberLike[] = [];

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
  run:
    | Pick<MythicPlusRunLike, "mapChallengeModeID" | "mapName">
    | string
    | null
    | undefined,
) {
  if (typeof run === "string") {
    return run.trim() === "" ? null : MYTHIC_PLUS_TIMER_MS_BY_MAP_NAME.get(normalizeMapName(run)) ?? null;
  }

  const mapChallengeModeID = run?.mapChallengeModeID;
  if (mapChallengeModeID !== undefined) {
    const timerByMapId = MYTHIC_PLUS_TIMER_MS_BY_MAP_ID.get(mapChallengeModeID);
    if (timerByMapId !== undefined) return timerByMapId;
  }

  const mapName = run?.mapName;
  if (typeof mapName !== "string" || mapName.trim() === "") return null;
  return MYTHIC_PLUS_TIMER_MS_BY_MAP_NAME.get(normalizeMapName(mapName)) ?? null;
}

export function getMythicPlusRunUpgradeCount(run: MythicPlusRunLike): number | null {
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

  // Unknown timing — return null instead of assuming timed/depleted.
  return null;
}

export function getMythicPlusRunTimedState(run: MythicPlusRunLike): boolean | null {
  const upgradeCount = getMythicPlusRunUpgradeCount(run);
  if (upgradeCount === null) {
    return null;
  }

  return upgradeCount > 0;
}

export function buildCanonicalMythicPlusRunFingerprint(run: MythicPlusRunLike) {
  const attemptId = getRunAttemptId(run);
  if (attemptId !== null) {
    return `aid|${attemptId}`;
  }

  const identityTimestamp = getRunIdentityTimestamp(run);
  const durationMs = getSanitizedRunDurationMs(run);

  if (identityTimestamp !== null) {
    const fingerprint = buildRunFingerprintWithIdentity(run, identityTimestamp);
    if (fingerprint !== null) return fingerprint;
  }

  const mapToken = getRunMapFingerprintToken(run);
  if (mapToken === "" || run.level === undefined) {
    return null;
  }

  if (durationMs !== undefined || run.runScore !== undefined) {
    return [
      toFingerprintToken(run.seasonID),
      mapToken,
      toFingerprintToken(run.level),
      toFingerprintToken(durationMs),
      toFingerprintToken(run.runScore),
    ].join("|");
  }

  return null;
}

export function getMythicPlusRunCompletenessScore(run: MythicPlusRunLike) {
  let score = 0;
  const status = getMythicPlusRunLifecycleStatus(run);
  const durationMs = getSanitizedRunDurationMs(run);

  if (run.seasonID !== undefined) score += 1;
  if (run.mapChallengeModeID !== undefined) score += 3;
  if (typeof run.mapName === "string" && run.mapName.trim() !== "") score += 1;
  if (run.level !== undefined) score += 2;
  if (getRunAttemptId(run) !== null) score += 4;
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
  currentRun: MythicPlusRunLike | undefined,
  candidateRun: MythicPlusRunLike,
) {
  if (!currentRun) return true;

  const currentStatus = getMythicPlusRunLifecycleStatus(currentRun);
  const candidateStatus = getMythicPlusRunLifecycleStatus(candidateRun);
  const currentStatusPriority = getRunStatusPriority(currentStatus);
  const candidateStatusPriority = getRunStatusPriority(candidateStatus);
  if (candidateStatusPriority !== currentStatusPriority) {
    return candidateStatusPriority > currentStatusPriority;
  }

  const currentCanonicalFingerprint = buildCanonicalMythicPlusRunFingerprint(currentRun);
  const candidateCanonicalFingerprint = buildCanonicalMythicPlusRunFingerprint(candidateRun);
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

export function getMythicPlusRunDedupKeys(run: MythicPlusRunLike): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const durationMs = getSanitizedRunDurationMs(run);

  const pushKey = (key: string | null | undefined) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };

  const identityCandidates = getRunIdentityCandidates(run);
  const mapTokens = getRunMapFingerprintTokens(run);
  const seasonTokens = getRunSeasonTokens(run);
  const attemptId = getRunAttemptId(run);

  if (attemptId !== null) {
    pushKey(`aid|${attemptId}`);
    pushKey(attemptId);
  }

  for (const identityTimestamp of identityCandidates) {
    pushKey(buildRunFingerprintWithIdentity(run, identityTimestamp));
  }

  for (const identityTimestamp of identityCandidates) {
    for (const mapToken of mapTokens) {
      for (const seasonToken of seasonTokens) {
        pushKey(buildRunFingerprintWithIdentity(run, identityTimestamp, { seasonToken, mapToken }));
      }
    }
  }
  pushKey(buildCanonicalMythicPlusRunFingerprint(run));

  if (
    keys.length === 0 &&
    mapTokens.length > 0 &&
    run.level !== undefined &&
    (durationMs !== undefined || run.runScore !== undefined)
  ) {
    for (const mapToken of mapTokens) {
      for (const seasonToken of seasonTokens) {
        pushKey([
          seasonToken,
          mapToken,
          toFingerprintToken(run.level),
          toFingerprintToken(durationMs),
          toFingerprintToken(run.runScore),
        ].join("|"));
      }
    }
  }

  pushKey(run.fingerprint);
  pushKey(run._id);

  return keys;
}

export function hasMythicPlusRunDedupKeyOverlap(a: MythicPlusRunLike, b: MythicPlusRunLike): boolean {
  const keysA = new Set(getMythicPlusRunDedupKeys(a));
  for (const key of getMythicPlusRunDedupKeys(b)) {
    if (keysA.has(key)) return true;
  }
  return false;
}

export function getMythicPlusRunDedupKey(run: MythicPlusRunLike) {
  return getMythicPlusRunDedupKeys(run)[0] ?? null;
}
