import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Calculator, Clock3, Flag, Swords, Target } from "lucide-react";
import { Badge } from "@wow-dashboard/ui/components/badge";
import { Button } from "@wow-dashboard/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wow-dashboard/ui/components/card";
import { Input } from "@wow-dashboard/ui/components/input";
import { Label } from "@wow-dashboard/ui/components/label";
import { CURRENT_SEASON_DUNGEONS, getMythicPlusDungeonMeta } from "../lib/mythic-plus-static";
import {
  buildMythicPlannerResult,
  getMythicPlannerDungeonKey,
  type MythicPlannerDungeonInput,
  type MythicPlannerPlanOption,
  type MythicPlannerRunSuggestion,
  type MythicPlannerSettings,
} from "../lib/mythic-planner";

type MythicPlannerDungeonSummaryInput = {
  mapChallengeModeID: number | null;
  mapName: string;
  bestScore: number | null;
  bestLevel: number | null;
  bestTimedLevel: number | null;
};

type StoredPlannerSettings = {
  targetScore: number | null;
  avoidedDungeonKeys: string[];
  maxLevel: number;
};

type MythicPlannerPanelProps = {
  characterId: string;
  characterName: string;
  currentScore: number | null;
  dungeons: MythicPlannerDungeonSummaryInput[];
};

const SCORE_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function getDefaultTargetScore(currentScore: number | null) {
  if (currentScore === null || !Number.isFinite(currentScore)) {
    return null;
  }

  return Math.ceil((currentScore + 1) / 100) * 100;
}

function getStorageKey(characterId: string) {
  return `wow-mythic-planner:${characterId}`;
}

function readStoredSettings(characterId: string, currentScore: number | null): StoredPlannerSettings {
  const fallback: StoredPlannerSettings = {
    targetScore: getDefaultTargetScore(currentScore),
    avoidedDungeonKeys: [],
    maxLevel: 15,
  };

  try {
    const raw = localStorage.getItem(getStorageKey(characterId));
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<StoredPlannerSettings>;
    const rawAvoidedDungeonKeys = Array.isArray(parsed.avoidedDungeonKeys)
      ? parsed.avoidedDungeonKeys.filter(
          (value): value is string => typeof value === "string" && value.trim() !== "",
        )
      : typeof (parsed as { avoidedDungeonKey?: unknown }).avoidedDungeonKey === "string"
        ? [(parsed as { avoidedDungeonKey: string }).avoidedDungeonKey]
        : fallback.avoidedDungeonKeys;
    return {
      targetScore:
        typeof parsed.targetScore === "number" && Number.isFinite(parsed.targetScore)
          ? parsed.targetScore
          : fallback.targetScore,
      avoidedDungeonKeys: rawAvoidedDungeonKeys,
      maxLevel:
        typeof parsed.maxLevel === "number" && Number.isFinite(parsed.maxLevel)
          ? parsed.maxLevel
          : fallback.maxLevel,
    };
  } catch {
    return fallback;
  }
}

function writeStoredSettings(characterId: string, settings: StoredPlannerSettings) {
  try {
    localStorage.setItem(getStorageKey(characterId), JSON.stringify(settings));
  } catch {
    // Ignore storage failures and keep the planner usable.
  }
}

function toggleDungeonSelection(selectedKeys: string[], dungeonKey: string) {
  return selectedKeys.includes(dungeonKey)
    ? selectedKeys.filter((key) => key !== dungeonKey)
    : [...selectedKeys, dungeonKey];
}

function formatScore(value: number) {
  return SCORE_FORMATTER.format(value);
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRunWindow(run: MythicPlannerRunSuggestion) {
  if (run.runState === "timed") {
    const earlyMs = Math.max(0, run.timerMs - run.requiredDurationMs);
    if (earlyMs === 0) {
      return `Finish in ${formatDuration(run.requiredDurationMs)} or faster`;
    }
    return `Finish in ${formatDuration(run.requiredDurationMs)} or faster (${formatDuration(earlyMs)} early)`;
  }

  const overtimeMs = Math.max(0, run.requiredDurationMs - run.timerMs);
  if (overtimeMs === 0) {
    return `Finish within ${formatDuration(run.requiredDurationMs)}`;
  }
  return `Finish within ${formatDuration(run.requiredDurationMs)} (${formatDuration(overtimeMs)} overtime)`;
}

function getPlannerDungeons(dungeons: MythicPlannerDungeonSummaryInput[]) {
  const summariesByKey = new Map(
    dungeons.map((dungeon) => [
      getMythicPlannerDungeonKey({
        mapChallengeModeID: dungeon.mapChallengeModeID,
        mapName: dungeon.mapName,
      }),
      dungeon,
    ]),
  );

  return CURRENT_SEASON_DUNGEONS.map((dungeonMeta) => {
    const existingSummary = summariesByKey.get(
      getMythicPlannerDungeonKey({
        mapChallengeModeID: dungeonMeta.mapChallengeModeID,
        mapName: dungeonMeta.name,
      }),
    );

    return {
      mapChallengeModeID: dungeonMeta.mapChallengeModeID,
      mapName: dungeonMeta.name,
      timerMs: dungeonMeta.timerMs,
      currentScore: existingSummary?.bestScore ?? 0,
      currentBestLevel: existingSummary?.bestLevel ?? existingSummary?.bestTimedLevel ?? null,
    } satisfies MythicPlannerDungeonInput;
  });
}

function OptionCard({
  option,
  targetScore,
}: {
  option: MythicPlannerPlanOption;
  targetScore: number | null;
}) {
  return (
    <Card className="border-border/70">
      <CardHeader className="border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{option.label}</CardTitle>
            <CardDescription>{option.description}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Runs {option.runs.length}</Badge>
            <Badge variant="outline">Highest +{option.highestLevel}</Badge>
            {option.depletedRuns > 0 && (
              <Badge variant="outline" className="border-amber-400/35 text-amber-200">
                {option.depletedRuns} depleted
              </Badge>
            )}
            {!option.reachable && (
              <Badge variant="outline" className="border-orange-400/35 text-orange-200">
                Best effort
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
              Projected
            </div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              {formatScore(option.projectedScore)}
            </div>
            {targetScore !== null && (
              <div className="mt-1 text-xs text-muted-foreground">
                Target {formatScore(targetScore)}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
              Total Gain
            </div>
            <div className="mt-2 text-lg font-semibold tabular-nums text-emerald-300">
              +{formatScore(option.totalGain)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {option.timedRuns} timed / {option.depletedRuns} depleted
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
              Route Time
            </div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              {formatDuration(option.totalDurationMs)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {option.remainingScore > 0
                ? `${formatScore(option.remainingScore)} score still missing`
                : "Reaches target"}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {option.runs.map((run) => {
            const dungeonMeta = getMythicPlusDungeonMeta(run.mapChallengeModeID, run.mapName);
            return (
              <div
                key={`${run.dungeonKey}:${run.level}:${run.runState}:${Math.round(run.projectedScore * 10)}`}
                className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="rounded-md border border-border/70 bg-background px-2 py-1 text-xs font-semibold tracking-[0.14em] text-muted-foreground">
                      {dungeonMeta?.shortName ?? run.mapName.slice(0, 3).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{run.mapName}</div>
                      <div className="text-xs text-muted-foreground">
                        Current {formatScore(run.currentScore)} to {formatScore(run.projectedScore)}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">+{run.level}</Badge>
                    <Badge
                      variant="outline"
                      className={
                        run.runState === "timed"
                          ? "border-emerald-400/35 text-emerald-200"
                          : "border-amber-400/35 text-amber-200"
                      }
                    >
                      {run.runState === "timed" ? "Timed" : "Depleted"}
                    </Badge>
                    <Badge variant="outline" className="tabular-nums text-emerald-300">
                      +{formatScore(run.gain)}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{formatRunWindow(run)}</span>
                  <span>Timer {formatDuration(run.timerMs)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function MythicPlannerPanel({
  characterId,
  characterName,
  currentScore,
  dungeons,
}: MythicPlannerPanelProps) {
  const plannerDungeons = useMemo(() => getPlannerDungeons(dungeons), [dungeons]);
  const [storedSettings, setStoredSettings] = useState<StoredPlannerSettings>(() =>
    readStoredSettings(characterId, currentScore),
  );

  useEffect(() => {
    setStoredSettings(readStoredSettings(characterId, currentScore));
  }, [characterId, currentScore]);

  useEffect(() => {
    writeStoredSettings(characterId, storedSettings);
  }, [characterId, storedSettings]);

  const deferredSettings = useDeferredValue<StoredPlannerSettings>(storedSettings);
  const plannerSettings = useMemo<MythicPlannerSettings>(
    () => ({
      targetScore: deferredSettings.targetScore,
      avoidedDungeonKeys: deferredSettings.avoidedDungeonKeys,
      maxLevel: deferredSettings.maxLevel,
    }),
    [deferredSettings],
  );
  const plannerResult = useMemo(
    () => buildMythicPlannerResult(currentScore, plannerDungeons, plannerSettings),
    [currentScore, plannerDungeons, plannerSettings],
  );

  const targetValue =
    storedSettings.targetScore === null ? "" : String(Math.round(storedSettings.targetScore));

  return (
    <>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Calculator size={18} className="text-muted-foreground" />
          <h3 className="text-lg font-semibold text-foreground">Mythic Planner</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Plan a target score push for {characterName} using the current season dungeon pool already
          tracked on this page.
        </p>
      </div>

      <div className="mt-6 space-y-6">
        <Card className="border-border/70">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="text-base">Planner Inputs</CardTitle>
            <CardDescription>
              Target score, max key, and excluded dungeons persist per character in local storage.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
                  Current Score
                </div>
                <div className="mt-2 text-lg font-semibold tabular-nums">
                  {formatScore(currentScore ?? 0)}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="planner-target-score">
                  <span className="inline-flex items-center gap-2">
                    <Target size={14} className="text-muted-foreground" />
                    Target Rating
                  </span>
                </Label>
                <Input
                  id="planner-target-score"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={targetValue}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setStoredSettings((current) => ({
                      ...current,
                      targetScore:
                        event.target.value.trim() === "" || !Number.isFinite(nextValue)
                          ? null
                          : nextValue,
                    }));
                  }}
                  placeholder="Target score"
                  className="h-9"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="planner-max-level">
                  <span className="inline-flex items-center gap-2">
                    <Swords size={14} className="text-muted-foreground" />
                    Max Key Level
                  </span>
                </Label>
                <Input
                  id="planner-max-level"
                  type="number"
                  inputMode="numeric"
                  min={2}
                  max={30}
                  step={1}
                  value={String(storedSettings.maxLevel)}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setStoredSettings((current) => ({
                      ...current,
                      maxLevel:
                        Number.isFinite(nextValue) && event.target.value.trim() !== ""
                          ? Math.min(30, Math.max(2, nextValue))
                          : current.maxLevel,
                    }));
                  }}
                  className="h-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                <span className="inline-flex items-center gap-2">
                  <Flag size={14} className="text-muted-foreground" />
                  Avoid Dungeons
                </span>
              </Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={storedSettings.avoidedDungeonKeys.length === 0 ? "default" : "outline"}
                  onClick={() =>
                    setStoredSettings((current) => ({ ...current, avoidedDungeonKeys: [] }))
                  }
                >
                  Clear exclusions
                </Button>
                {plannerDungeons.map((dungeon) => {
                  const dungeonMeta = getMythicPlusDungeonMeta(
                    dungeon.mapChallengeModeID,
                    dungeon.mapName,
                  );
                  const dungeonKey = getMythicPlannerDungeonKey(dungeon);
                  const isSelected = storedSettings.avoidedDungeonKeys.includes(dungeonKey);
                  return (
                    <Button
                      key={dungeonKey}
                      type="button"
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      onClick={() =>
                        setStoredSettings((current) => ({
                          ...current,
                          avoidedDungeonKeys: toggleDungeonSelection(
                            current.avoidedDungeonKeys,
                            dungeonKey,
                          ),
                        }))
                      }
                    >
                      {dungeonMeta?.shortName ?? dungeon.mapName}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Select as many dungeons as you want to exclude from the generated routes.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="text-base">Plan Summary</CardTitle>
            <CardDescription>
              These routes use current seasonal bests as the baseline and estimate score deltas from
              there.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 pt-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
                Target
              </div>
              <div className="mt-2 text-lg font-semibold tabular-nums">
                {plannerResult.targetScore === null ? "--" : formatScore(plannerResult.targetScore)}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
                Gap
              </div>
              <div className="mt-2 text-lg font-semibold tabular-nums">
                {plannerResult.targetScore === null ? "--" : formatScore(plannerResult.scoreGap)}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/60 px-3 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
                Route Status
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm font-medium">
                <Clock3 size={14} className="text-muted-foreground" />
                {plannerResult.targetScore === null
                  ? "Set a target"
                  : plannerResult.reachable
                    ? "Reachable"
                    : "Best effort only"}
              </div>
            </div>
          </CardContent>
        </Card>

        {plannerResult.targetScore === null ? (
          <Card className="border-dashed border-border/70">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Set a target rating to generate Mythic+ route options.
            </CardContent>
          </Card>
        ) : plannerResult.targetScore <= plannerResult.currentScore ? (
          <Card className="border-emerald-500/30 bg-emerald-500/10">
            <CardContent className="pt-6 text-sm text-emerald-100">
              {characterName} is already at or above the selected target.
            </CardContent>
          </Card>
        ) : plannerResult.options.length === 0 ? (
          <Card className="border-dashed border-border/70">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No route options are available with the current constraints.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {plannerResult.options.map((option) => (
              <OptionCard
                key={option.id}
                option={option}
                targetScore={plannerResult.targetScore}
              />
            ))}
          </div>
        )}

        <Card className="border-border/70">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="text-base">Planner Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-4 text-sm text-muted-foreground">
            {plannerResult.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
