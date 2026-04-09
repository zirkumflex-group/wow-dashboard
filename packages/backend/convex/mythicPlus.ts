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

function getMythicPlusRunMemberKey(member: MythicPlusRunMemberLike) {
  return `${member.name.toLowerCase()}|${member.realm?.toLowerCase() ?? ""}`;
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

  const mergedMembers = new Map<string, MythicPlusRunMemberLike>();
  const orderedKeys: string[] = [];

  for (const members of [candidateMembers, currentMembers]) {
    for (const member of members ?? []) {
      const key = getMythicPlusRunMemberKey(member);
      if (!mergedMembers.has(key)) {
        orderedKeys.push(key);
      }
      mergedMembers.set(key, mergeMythicPlusRunMember(mergedMembers.get(key), member));
    }
  }

  return orderedKeys.map((key) => mergedMembers.get(key)!);
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

export function getMythicPlusRunUpgradeCount(run: MythicPlusRunLike) {
  const timerMs = getMythicPlusRunTimerMs(run);
  if (timerMs !== null && run.durationMs !== undefined && run.durationMs > 0) {
    if (run.durationMs <= timerMs * 0.6) return 3;
    if (run.durationMs <= timerMs * 0.8) return 2;
    if (run.durationMs <= timerMs) return 1;
    return 0;
  }

  if (run.completedInTime !== undefined) {
    return run.completedInTime ? 1 : 0;
  }

  return run.completed === true ? 1 : 0;
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
  if ((run.members?.length ?? 0) > 0) score += 3;

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
