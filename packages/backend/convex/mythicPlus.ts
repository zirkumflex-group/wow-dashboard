type MythicPlusRunLike = {
  _id?: string;
  fingerprint?: string;
  observedAt?: number;
  seasonID?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  level?: number;
  completed?: boolean;
  completedInTime?: boolean;
  durationMs?: number;
  runScore?: number;
  startDate?: number;
  completedAt?: number;
  thisWeek?: boolean;
};

function toFingerprintToken(value: boolean | number | string | null | undefined) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return value;
}

function getRunMapFingerprintToken(run: MythicPlusRunLike) {
  if (run.mapChallengeModeID !== undefined) {
    return toFingerprintToken(run.mapChallengeModeID);
  }

  if (typeof run.mapName === "string") {
    const normalizedName = run.mapName.trim().toLowerCase();
    if (normalizedName !== "") return normalizedName;
  }

  return "";
}

function getRunIdentityTimestamp(run: MythicPlusRunLike) {
  return run.startDate ?? run.completedAt ?? null;
}

export function getMythicPlusRunSortValue(run: MythicPlusRunLike) {
  return run.completedAt ?? run.startDate ?? run.observedAt ?? 0;
}

export function buildCanonicalMythicPlusRunFingerprint(run: MythicPlusRunLike) {
  const mapToken = getRunMapFingerprintToken(run);
  const identityTimestamp = getRunIdentityTimestamp(run);

  if (mapToken === "" || run.level === undefined) {
    return null;
  }

  if (identityTimestamp !== null) {
    return [
      toFingerprintToken(run.seasonID),
      mapToken,
      toFingerprintToken(run.level),
      toFingerprintToken(identityTimestamp),
    ].join("|");
  }

  if (run.durationMs !== undefined || run.runScore !== undefined) {
    return [
      toFingerprintToken(run.seasonID),
      mapToken,
      toFingerprintToken(run.level),
      toFingerprintToken(run.durationMs),
      toFingerprintToken(run.runScore),
    ].join("|");
  }

  return null;
}

export function getMythicPlusRunCompletenessScore(run: MythicPlusRunLike) {
  let score = 0;

  if (run.seasonID !== undefined) score += 1;
  if (run.mapChallengeModeID !== undefined) score += 3;
  if (typeof run.mapName === "string" && run.mapName.trim() !== "") score += 1;
  if (run.level !== undefined) score += 2;
  if (run.startDate !== undefined) score += 4;
  if (run.completedAt !== undefined) score += 4;
  if (run.durationMs !== undefined) score += 3;
  if (run.runScore !== undefined) score += 3;
  if (run.completedInTime !== undefined) score += 2;
  if (run.completed !== undefined) score += 1;
  if (run.thisWeek !== undefined) score += 1;

  return score;
}

export function shouldReplaceMythicPlusRun(
  currentRun: MythicPlusRunLike | undefined,
  candidateRun: MythicPlusRunLike,
) {
  if (!currentRun) return true;

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

export function getMythicPlusRunDedupKey(run: MythicPlusRunLike) {
  return buildCanonicalMythicPlusRunFingerprint(run) ?? run.fingerprint ?? run._id ?? null;
}
