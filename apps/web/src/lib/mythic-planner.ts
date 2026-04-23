import { getMythicPlusDungeonEaseRank } from "./mythic-plus-static";

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
  requiredUpgradeCount: 0 | 1 | 2 | 3;
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

type MythicPlannerResult = {
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
  easeRank: number;
  timingPressure: number;
};

type PlanState = {
  gainUnits: number;
  totalDurationMs: number;
  totalLevel: number;
  highestLevel: number;
  timedRuns: number;
  depletedRuns: number;
  highestRequiredUpgradeCount: number;
  totalRequiredUpgradeCount: number;
  hardestEaseRank: number;
  totalEaseRank: number;
  highestTimingPressure: number;
  totalTimingPressure: number;
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

function getMythicPlannerBaseScore(level: number) {
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
    minScore: baseScore,
    maxScore: baseScore + 15,
  };
}

function getDepletedScoreRange(level: number) {
  const baseScore = getMythicPlannerBaseScore(level);
  return {
    baseScore,
    minScore: baseScore - 30,
    maxScore: baseScore - 15,
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

function getTimingPressure(timerMs: number, requiredDurationMs: number, runState: "timed" | "depleted") {
  if (runState === "depleted") {
    return 0;
  }

  return clamp((timerMs - requiredDurationMs) / timerMs, 0, 0.4);
}

function getRequiredUpgradeCount(
  timerMs: number,
  requiredDurationMs: number,
  runState: "timed" | "depleted",
): 0 | 1 | 2 | 3 {
  if (runState === "depleted") {
    return 0;
  }

  const remainingFraction = clamp((timerMs - requiredDurationMs) / timerMs, 0, 0.4);
  if (remainingFraction >= 0.4) {
    return 3;
  }
  if (remainingFraction >= 0.2) {
    return 2;
  }
  return 1;
}

function compareCandidate(
  strategy: MythicPlannerStrategy,
  current: ReducedCandidate | undefined,
  candidate: ReducedCandidate,
) {
  if (!current) return true;

  if (strategy === "fastest") {
    const currentStatePenalty = current.runState === "timed" ? 0 : 1;
    const candidateStatePenalty = candidate.runState === "timed" ? 0 : 1;
    const stateComparison = compareNumbers(candidateStatePenalty, currentStatePenalty);
    if (stateComparison !== 0) return stateComparison < 0;

    const upgradeComparison = compareNumbers(
      candidate.requiredUpgradeCount,
      current.requiredUpgradeCount,
    );
    if (upgradeComparison !== 0) return upgradeComparison < 0;

    const durationComparison = compareNumbers(candidate.requiredDurationMs, current.requiredDurationMs);
    if (durationComparison !== 0) return durationComparison < 0;

    const levelComparison = compareNumbers(candidate.level, current.level);
    if (levelComparison !== 0) return levelComparison > 0;

    return candidate.projectedScore > current.projectedScore;
  }

  const currentStatePenalty = current.runState === "timed" ? 0 : 1;
  const candidateStatePenalty = candidate.runState === "timed" ? 0 : 1;
  const stateComparison = compareNumbers(candidateStatePenalty, currentStatePenalty);
  if (stateComparison !== 0) return stateComparison < 0;

  const upgradeComparison = compareNumbers(
    candidate.requiredUpgradeCount,
    current.requiredUpgradeCount,
  );
  if (upgradeComparison !== 0) return upgradeComparison < 0;

  const levelComparison = compareNumbers(candidate.level, current.level);
  if (levelComparison !== 0) return levelComparison < 0;

  const easeRankComparison = compareNumbers(candidate.easeRank, current.easeRank);
  if (easeRankComparison !== 0) return easeRankComparison < 0;

  const timingPressureComparison = compareNumbers(candidate.timingPressure, current.timingPressure);
  if (timingPressureComparison !== 0) return timingPressureComparison < 0;

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

    for (
      let projectedScoreUnits = Math.ceil(timedRange.minScore * SCORE_UNIT);
      projectedScoreUnits <= Math.floor(timedRange.maxScore * SCORE_UNIT);
      projectedScoreUnits += 1
    ) {
      const projectedScore = projectedScoreUnits / SCORE_UNIT;
      if (projectedScore <= dungeon.currentScore) continue;

      const gainUnits = Math.min(
        gapUnits,
        Math.ceil((projectedScore - dungeon.currentScore) * SCORE_UNIT),
      );
      if (gainUnits <= 0) continue;
      const requiredDurationMs = getRequiredDurationMs(level, dungeon.timerMs, projectedScore);

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
        requiredDurationMs,
        runState: "timed",
        requiredUpgradeCount: getRequiredUpgradeCount(dungeon.timerMs, requiredDurationMs, "timed"),
        easeRank: getMythicPlusDungeonEaseRank(dungeon.mapChallengeModeID, dungeon.mapName),
        timingPressure: getTimingPressure(
          dungeon.timerMs,
          requiredDurationMs,
          "timed",
        ),
      };

      if (compareCandidate(strategy, reduced.get(gainUnits), candidate)) {
        reduced.set(gainUnits, candidate);
      }
    }

    for (
      let projectedScoreUnits = Math.ceil(depletedRange.minScore * SCORE_UNIT);
      projectedScoreUnits <= Math.floor(depletedRange.maxScore * SCORE_UNIT);
      projectedScoreUnits += 1
    ) {
      const projectedScore = projectedScoreUnits / SCORE_UNIT;
      if (projectedScore <= dungeon.currentScore) continue;

      const gainUnits = Math.min(
        gapUnits,
        Math.ceil((projectedScore - dungeon.currentScore) * SCORE_UNIT),
      );
      if (gainUnits <= 0) continue;
      const requiredDurationMs = getRequiredDurationMs(level, dungeon.timerMs, projectedScore);

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
        requiredDurationMs,
        runState: "depleted",
        requiredUpgradeCount: getRequiredUpgradeCount(dungeon.timerMs, requiredDurationMs, "depleted"),
        easeRank: getMythicPlusDungeonEaseRank(dungeon.mapChallengeModeID, dungeon.mapName),
        timingPressure: getTimingPressure(
          dungeon.timerMs,
          requiredDurationMs,
          "depleted",
        ),
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
    highestRequiredUpgradeCount: 0,
    totalRequiredUpgradeCount: 0,
    hardestEaseRank: 0,
    totalEaseRank: 0,
    highestTimingPressure: 0,
    totalTimingPressure: 0,
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
    highestRequiredUpgradeCount: Math.max(
      state.highestRequiredUpgradeCount,
      candidate.requiredUpgradeCount,
    ),
    totalRequiredUpgradeCount: state.totalRequiredUpgradeCount + candidate.requiredUpgradeCount,
    hardestEaseRank: Math.max(state.hardestEaseRank, candidate.easeRank),
    totalEaseRank: state.totalEaseRank + candidate.easeRank,
    highestTimingPressure: Math.max(state.highestTimingPressure, candidate.timingPressure),
    totalTimingPressure: state.totalTimingPressure + candidate.timingPressure,
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
    const highestUpgradeComparison = compareNumbers(
      candidate.highestRequiredUpgradeCount,
      current.highestRequiredUpgradeCount,
    );
    if (highestUpgradeComparison !== 0) return highestUpgradeComparison < 0;

    const totalUpgradeComparison = compareNumbers(
      candidate.totalRequiredUpgradeCount,
      current.totalRequiredUpgradeCount,
    );
    if (totalUpgradeComparison !== 0) return totalUpgradeComparison < 0;

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

  const highestUpgradeComparison = compareNumbers(
    candidate.highestRequiredUpgradeCount,
    current.highestRequiredUpgradeCount,
  );
  if (highestUpgradeComparison !== 0) return highestUpgradeComparison < 0;

  const hardestEaseRankComparison = compareNumbers(candidate.hardestEaseRank, current.hardestEaseRank);
  if (hardestEaseRankComparison !== 0) return hardestEaseRankComparison < 0;

  const averageEaseRankComparison = compareNumbers(
    candidate.totalEaseRank / candidate.runs.length,
    current.totalEaseRank / current.runs.length,
  );
  if (averageEaseRankComparison !== 0) return averageEaseRankComparison < 0;

  const highestTimingPressureComparison = compareNumbers(
    candidate.highestTimingPressure,
    current.highestTimingPressure,
  );
  if (highestTimingPressureComparison !== 0) return highestTimingPressureComparison < 0;

  const averageUpgradeComparison = compareNumbers(
    candidate.totalRequiredUpgradeCount / candidate.runs.length,
    current.totalRequiredUpgradeCount / current.runs.length,
  );
  if (averageUpgradeComparison !== 0) return averageUpgradeComparison < 0;

  const timingPressureComparison = compareNumbers(
    candidate.totalTimingPressure / candidate.runs.length,
    current.totalTimingPressure / current.runs.length,
  );
  if (timingPressureComparison !== 0) return timingPressureComparison < 0;

  const depletedComparison = compareNumbers(candidate.depletedRuns, current.depletedRuns);
  if (depletedComparison !== 0) return depletedComparison < 0;

  const runCountComparison = compareNumbers(candidate.runs.length, current.runs.length);
  if (runCountComparison !== 0) return runCountComparison > 0;

  const easeRankComparison = compareNumbers(candidate.totalEaseRank, current.totalEaseRank);
  if (easeRankComparison !== 0) return easeRankComparison < 0;

  return candidate.totalDurationMs < current.totalDurationMs;
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
    fastest: "Fewer runs when possible, without forcing heavy +3 timer pressure.",
    easiest: "Prioritizes easier dungeons and softer timer requirements.",
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
      return (
        a.easeRank - b.easeRank ||
        a.level - b.level ||
        a.timingPressure - b.timingPressure ||
        b.gain - a.gain
      );
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
