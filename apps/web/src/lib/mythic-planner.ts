export type MythicPlannerDungeonInput = {
  mapChallengeModeID: number | null;
  mapName: string;
  timerMs: number;
  currentScore: number;
  currentBestLevel: number | null;
};

export type MythicPlannerSettings = {
  targetScore: number | null;
  avoidedDungeonKeys: string[];
  maxLevel: number;
};

export type MythicPlannerRunSuggestion = {
  dungeonKey: string;
  mapChallengeModeID: number | null;
  mapName: string;
  timerMs: number;
  currentScore: number;
  projectedScore: number;
  gain: number;
  gainUnits: number;
  level: number;
  requiredDurationMs: number;
  runState: "timed" | "depleted";
};

export type MythicPlannerPlanOption = {
  id: "fastest" | "easiest";
  label: string;
  description: string;
  reachable: boolean;
  projectedScore: number;
  totalGain: number;
  remainingScore: number;
  totalDurationMs: number;
  highestLevel: number;
  timedRuns: number;
  depletedRuns: number;
  runs: MythicPlannerRunSuggestion[];
};

export type MythicPlannerResult = {
  currentScore: number;
  targetScore: number | null;
  scoreGap: number;
  maxLevel: number;
  reachable: boolean;
  options: MythicPlannerPlanOption[];
};

type MythicPlannerStrategy = MythicPlannerPlanOption["id"];

type ReducedCandidate = MythicPlannerRunSuggestion & {
  gainUnits: number;
};

type PlanState = {
  gainUnits: number;
  totalDurationMs: number;
  totalLevel: number;
  highestLevel: number;
  timedRuns: number;
  depletedRuns: number;
  runs: ReducedCandidate[];
};

const SCORE_UNIT = 10;
const MAX_KEY_LEVEL = 30;
const MIN_KEY_LEVEL = 2;
const LEVEL_BASE_SCORES: Record<number, number> = {
  2: 155,
  3: 170,
  4: 200,
  5: 215,
  6: 230,
  7: 260,
  8: 275,
  9: 290,
  10: 320,
  11: 335,
  12: 365,
  13: 380,
  14: 395,
  15: 410,
  16: 425,
  17: 440,
  18: 455,
  19: 470,
  20: 485,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function compareNumbers(a: number, b: number) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function getMythicPlannerDungeonKey(
  dungeon: Pick<MythicPlannerDungeonInput, "mapChallengeModeID" | "mapName">,
) {
  if (dungeon.mapChallengeModeID !== null) {
    return `map:${dungeon.mapChallengeModeID}`;
  }

  return `name:${dungeon.mapName.trim().toLowerCase()}`;
}

export function getMythicPlannerBaseScore(level: number) {
  const normalizedLevel = clamp(Math.floor(level), MIN_KEY_LEVEL, MAX_KEY_LEVEL);
  const explicitScore = LEVEL_BASE_SCORES[normalizedLevel];
  if (explicitScore !== undefined) {
    return explicitScore;
  }

  return LEVEL_BASE_SCORES[20] + (normalizedLevel - 20) * 15;
}

function getTimedScoreRange(level: number) {
  const baseScore = getMythicPlannerBaseScore(level);
  return {
    baseScore,
    minScore: Math.ceil(baseScore),
    maxScore: Math.floor(baseScore + 15),
  };
}

function getDepletedScoreRange(level: number) {
  const baseScore = getMythicPlannerBaseScore(level);
  return {
    baseScore,
    minScore: Math.ceil(baseScore - 30),
    maxScore: Math.floor(baseScore - 15),
  };
}

function getRequiredDurationMs(level: number, timerMs: number, score: number) {
  const baseScore = getMythicPlannerBaseScore(level);

  if (score >= baseScore) {
    const timeFraction = clamp((score - baseScore) / 37.5, 0, 0.4);
    return Math.round(timerMs * (1 - timeFraction));
  }

  const overtimeFraction = clamp((score - baseScore + 15) / 37.5, -0.4, 0);
  return Math.round(timerMs * (1 - overtimeFraction));
}

function compareCandidate(
  strategy: MythicPlannerStrategy,
  current: ReducedCandidate | undefined,
  candidate: ReducedCandidate,
) {
  if (!current) return true;

  const currentStatePenalty = current.runState === "timed" ? 0 : 1;
  const candidateStatePenalty = candidate.runState === "timed" ? 0 : 1;
  const stateComparison = compareNumbers(candidateStatePenalty, currentStatePenalty);
  if (stateComparison !== 0) return stateComparison < 0;

  if (strategy === "fastest") {
    const durationComparison = compareNumbers(candidate.requiredDurationMs, current.requiredDurationMs);
    if (durationComparison !== 0) return durationComparison < 0;

    const levelComparison = compareNumbers(candidate.level, current.level);
    if (levelComparison !== 0) return levelComparison > 0;

    return candidate.projectedScore > current.projectedScore;
  }

  const levelComparison = compareNumbers(candidate.level, current.level);
  if (levelComparison !== 0) return levelComparison < 0;

  const durationComparison = compareNumbers(candidate.requiredDurationMs, current.requiredDurationMs);
  if (durationComparison !== 0) return durationComparison > 0;

  return candidate.projectedScore < current.projectedScore;
}

function buildReducedCandidatesForDungeon(
  dungeon: MythicPlannerDungeonInput,
  maxLevel: number,
  gapUnits: number,
  strategy: MythicPlannerStrategy,
) {
  const reduced = new Map<number, ReducedCandidate>();

  for (let level = MIN_KEY_LEVEL; level <= maxLevel; level += 1) {
    const timedRange = getTimedScoreRange(level);
    const depletedRange = getDepletedScoreRange(level);

    for (let projectedScore = timedRange.minScore; projectedScore <= timedRange.maxScore; projectedScore += 1) {
      if (projectedScore <= dungeon.currentScore) continue;

      const gainUnits = Math.min(
        gapUnits,
        Math.ceil((projectedScore - dungeon.currentScore) * SCORE_UNIT),
      );
      if (gainUnits <= 0) continue;

      const candidate: ReducedCandidate = {
        dungeonKey: getMythicPlannerDungeonKey(dungeon),
        mapChallengeModeID: dungeon.mapChallengeModeID,
        mapName: dungeon.mapName,
        timerMs: dungeon.timerMs,
        currentScore: dungeon.currentScore,
        projectedScore,
        gain: projectedScore - dungeon.currentScore,
        gainUnits,
        level,
        requiredDurationMs: getRequiredDurationMs(level, dungeon.timerMs, projectedScore),
        runState: "timed",
      };

      if (compareCandidate(strategy, reduced.get(gainUnits), candidate)) {
        reduced.set(gainUnits, candidate);
      }
    }

    for (
      let projectedScore = depletedRange.minScore;
      projectedScore <= depletedRange.maxScore;
      projectedScore += 1
    ) {
      if (projectedScore <= dungeon.currentScore) continue;

      const gainUnits = Math.min(
        gapUnits,
        Math.ceil((projectedScore - dungeon.currentScore) * SCORE_UNIT),
      );
      if (gainUnits <= 0) continue;

      const candidate: ReducedCandidate = {
        dungeonKey: getMythicPlannerDungeonKey(dungeon),
        mapChallengeModeID: dungeon.mapChallengeModeID,
        mapName: dungeon.mapName,
        timerMs: dungeon.timerMs,
        currentScore: dungeon.currentScore,
        projectedScore,
        gain: projectedScore - dungeon.currentScore,
        gainUnits,
        level,
        requiredDurationMs: getRequiredDurationMs(level, dungeon.timerMs, projectedScore),
        runState: "depleted",
      };

      if (compareCandidate(strategy, reduced.get(gainUnits), candidate)) {
        reduced.set(gainUnits, candidate);
      }
    }
  }

  return Array.from(reduced.values()).sort((a, b) => a.gainUnits - b.gainUnits);
}

function getEmptyPlanState(): PlanState {
  return {
    gainUnits: 0,
    totalDurationMs: 0,
    totalLevel: 0,
    highestLevel: 0,
    timedRuns: 0,
    depletedRuns: 0,
    runs: [],
  };
}

function appendPlanState(state: PlanState, candidate: ReducedCandidate, gainUnits: number): PlanState {
  return {
    gainUnits,
    totalDurationMs: state.totalDurationMs + candidate.requiredDurationMs,
    totalLevel: state.totalLevel + candidate.level,
    highestLevel: Math.max(state.highestLevel, candidate.level),
    timedRuns: state.timedRuns + (candidate.runState === "timed" ? 1 : 0),
    depletedRuns: state.depletedRuns + (candidate.runState === "depleted" ? 1 : 0),
    runs: [...state.runs, candidate],
  };
}

function comparePlanState(
  strategy: MythicPlannerStrategy,
  current: PlanState | undefined,
  candidate: PlanState,
) {
  if (!current) return true;

  if (strategy === "fastest") {
    const runCountComparison = compareNumbers(candidate.runs.length, current.runs.length);
    if (runCountComparison !== 0) return runCountComparison < 0;

    const durationComparison = compareNumbers(candidate.totalDurationMs, current.totalDurationMs);
    if (durationComparison !== 0) return durationComparison < 0;

    const depletedComparison = compareNumbers(candidate.depletedRuns, current.depletedRuns);
    if (depletedComparison !== 0) return depletedComparison < 0;

    const highestLevelComparison = compareNumbers(candidate.highestLevel, current.highestLevel);
    if (highestLevelComparison !== 0) return highestLevelComparison > 0;

    return candidate.totalLevel > current.totalLevel;
  }

  const highestLevelComparison = compareNumbers(candidate.highestLevel, current.highestLevel);
  if (highestLevelComparison !== 0) return highestLevelComparison < 0;

  const totalLevelComparison = compareNumbers(candidate.totalLevel, current.totalLevel);
  if (totalLevelComparison !== 0) return totalLevelComparison < 0;

  const depletedComparison = compareNumbers(candidate.depletedRuns, current.depletedRuns);
  if (depletedComparison !== 0) return depletedComparison < 0;

  const durationComparison = compareNumbers(candidate.totalDurationMs, current.totalDurationMs);
  if (durationComparison !== 0) return durationComparison > 0;

  return candidate.runs.length < current.runs.length;
}

function buildPlanForStrategy(
  strategy: MythicPlannerStrategy,
  currentScore: number,
  dungeons: MythicPlannerDungeonInput[],
  gapUnits: number,
  maxLevel: number,
): MythicPlannerPlanOption | null {
  let states = new Map<number, PlanState>([[0, getEmptyPlanState()]]);

  for (const dungeon of dungeons) {
    const options = buildReducedCandidatesForDungeon(dungeon, maxLevel, gapUnits, strategy);
    const nextStates = new Map(states);

    for (const [stateGain, state] of states) {
      for (const option of options) {
        const nextGain = Math.min(gapUnits, stateGain + option.gainUnits);
        const nextState = appendPlanState(state, option, nextGain);

        if (comparePlanState(strategy, nextStates.get(nextGain), nextState)) {
          nextStates.set(nextGain, nextState);
        }
      }
    }

    states = nextStates;
  }

  const bestReachable = states.get(gapUnits);
  const bestState =
    bestReachable ??
    Array.from(states.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, state]) => state)[0];

  if (!bestState || bestState.runs.length === 0) {
    return null;
  }

  const totalGain = bestState.runs.reduce((sum, run) => sum + run.gain, 0);
  const projectedScore = currentScore + totalGain;
  const reachable = bestReachable !== undefined;
  const targetScore = currentScore + gapUnits / SCORE_UNIT;

  const descriptions: Record<MythicPlannerStrategy, string> = {
    fastest: "Higher keys and fewer runs to close the gap quickly.",
    easiest: "Prioritizes lower keys, even if the route takes longer.",
  };

  const labels: Record<MythicPlannerStrategy, string> = {
    fastest: "Fastest",
    easiest: "Easiest",
  };

  return {
    id: strategy,
    label: labels[strategy],
    description: descriptions[strategy],
    reachable,
    projectedScore,
    totalGain,
    remainingScore: Math.max(0, targetScore - projectedScore),
    totalDurationMs: bestState.totalDurationMs,
    highestLevel: bestState.highestLevel,
    timedRuns: bestState.timedRuns,
    depletedRuns: bestState.depletedRuns,
    runs: [...bestState.runs].sort((a, b) => {
      if (strategy === "fastest") {
        return b.gain - a.gain || b.level - a.level || a.requiredDurationMs - b.requiredDurationMs;
      }
      return a.level - b.level || a.requiredDurationMs - b.requiredDurationMs || b.gain - a.gain;
    }),
  };
}

export function buildMythicPlannerResult(
  currentScoreInput: number | null | undefined,
  dungeons: MythicPlannerDungeonInput[],
  settings: MythicPlannerSettings,
): MythicPlannerResult {
  const currentScore = currentScoreInput ?? 0;
  const targetScore = settings.targetScore;
  const scoreGap = targetScore === null ? 0 : Math.max(0, targetScore - currentScore);
  const maxLevel = clamp(Math.floor(settings.maxLevel || 0), MIN_KEY_LEVEL, MAX_KEY_LEVEL);

  if (targetScore === null || !Number.isFinite(targetScore)) {
    return {
      currentScore,
      targetScore: null,
      scoreGap: 0,
      maxLevel,
      reachable: false,
      options: [],
    };
  }

  const eligibleDungeons = dungeons.filter(
    (dungeon) => !settings.avoidedDungeonKeys.includes(getMythicPlannerDungeonKey(dungeon)),
  );

  if (targetScore <= currentScore || eligibleDungeons.length === 0) {
    return {
      currentScore,
      targetScore,
      scoreGap,
      maxLevel,
      reachable: targetScore <= currentScore,
      options: [],
    };
  }

  const gapUnits = Math.ceil(scoreGap * SCORE_UNIT);
  const options = (["fastest", "easiest"] as const)
    .map((strategy) =>
      buildPlanForStrategy(strategy, currentScore, eligibleDungeons, gapUnits, maxLevel),
    )
    .filter((option): option is MythicPlannerPlanOption => option !== null);

  return {
    currentScore,
    targetScore,
    scoreGap,
    maxLevel,
    reachable: options.some((option) => option.reachable),
    options,
  };
}
