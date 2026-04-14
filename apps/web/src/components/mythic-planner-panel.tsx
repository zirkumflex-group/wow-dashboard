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
import {
  CURRENT_SEASON_DUNGEONS,
  getMythicPlusDungeonMeta,
  getRaiderIoDungeonScoreColor,
  getRaiderIoScoreColor,
} from "../lib/mythic-plus-static";
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

const OPTION_STYLES: Record<
  MythicPlannerPlanOption["id"],
  {
    cardClassName: string;
    statusClassName: string;
    projectedAccentClassName: string;
  }
> = {
  fastest: {
    cardClassName: "border-orange-400/25 bg-card/85 shadow-sm",
    statusClassName: "border-orange-400/35 text-orange-200",
    projectedAccentClassName: "border-orange-400/20 bg-orange-500/5",
  },
  easiest: {
    cardClassName: "border-emerald-400/25 bg-card/85 shadow-sm",
    statusClassName: "border-emerald-400/35 text-emerald-200",
    projectedAccentClassName: "border-emerald-400/20 bg-emerald-500/5",
  },
};

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

function getRouteStatusLabel(reachable: boolean) {
  return reachable ? "Reachable" : "Unreachable";
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRunDelta(run: MythicPlannerRunSuggestion) {
  if (run.runState === "timed") {
    const earlyMs = Math.max(0, run.timerMs - run.requiredDurationMs);
    if (earlyMs === 0) {
      return "On timer";
    }
    return `${formatDuration(earlyMs)} early`;
  }

  const overtimeMs = Math.max(0, run.requiredDurationMs - run.timerMs);
  if (overtimeMs === 0) {
    return "On timer";
  }
  return `${formatDuration(overtimeMs)} over`;
}

function getRouteStatusDetail(option: MythicPlannerPlanOption) {
  return option.reachable ? "Hits target" : `Short ${formatScore(option.remainingScore)}`;
}

function ScoreText({
  score,
  className,
  scale = "overall",
}: {
  score: number;
  className?: string;
  scale?: "overall" | "dungeon";
}) {
  const color =
    scale === "dungeon" ? getRaiderIoDungeonScoreColor(score) : getRaiderIoScoreColor(score);

  return <span className={className} style={{ color }}>{formatScore(score)}</span>;
}

function DungeonPlanIcon({
  mapChallengeModeID,
  mapName,
}: {
  mapChallengeModeID: number | null;
  mapName: string;
}) {
  const dungeonMeta = getMythicPlusDungeonMeta(mapChallengeModeID, mapName);
  const fallbackLabel = dungeonMeta?.shortName ?? mapName.slice(0, 2).toUpperCase();

  if (!dungeonMeta?.iconUrl) {
    return (
      <span className="grid h-10 w-10 place-content-center rounded-lg border border-border/70 bg-background text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {fallbackLabel}
      </span>
    );
  }

  return (
    <img
      src={dungeonMeta.iconUrl}
      alt={mapName}
      loading="lazy"
      decoding="async"
      className="h-10 w-10 rounded-lg border border-border/70 object-cover"
    />
  );
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
  featured = false,
}: {
  option: MythicPlannerPlanOption;
  targetScore: number | null;
  featured?: boolean;
}) {
  const optionStyle = OPTION_STYLES[option.id];
  const routeStatusLabel = getRouteStatusLabel(option.reachable);
  const sortedRuns = useMemo(
    () =>
      [...option.runs].sort(
        (a, b) =>
          b.gain - a.gain ||
          b.level - a.level ||
          Number(a.runState === "depleted") - Number(b.runState === "depleted") ||
          a.requiredDurationMs - b.requiredDurationMs,
      ),
    [option.runs],
  );

  return (
    <Card className={`overflow-hidden ${optionStyle.cardClassName}`}>
      <CardHeader className="border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{option.label}</CardTitle>
            <CardDescription className="text-xs">{option.description}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={optionStyle.statusClassName}>
              {routeStatusLabel}
            </Badge>
            <Badge variant="outline">Runs {option.runs.length}</Badge>
            <Badge variant="outline">Highest +{option.highestLevel}</Badge>
            {option.depletedRuns > 0 && (
              <Badge variant="outline" className="border-amber-400/35 text-amber-200">
                {option.depletedRuns} depleted
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-4">
        <div className={`grid gap-3 ${featured ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-4"}`}>
          <div className={`rounded-xl border px-3.5 py-3 ${optionStyle.projectedAccentClassName}`}>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
              Projected Score
            </div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              <ScoreText score={option.projectedScore} />
            </div>
            {targetScore !== null && (
              <div className="mt-1 text-xs text-muted-foreground">
                Target <ScoreText score={targetScore} />
              </div>
            )}
          </div>
          <div className="rounded-xl border border-border/60 bg-card/60 px-3.5 py-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
              Total Gain
            </div>
            <div className="mt-2 text-lg font-semibold tabular-nums text-emerald-300">
              +{formatScore(option.totalGain)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {option.timedRuns} timed, {option.depletedRuns} depleted
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/60 px-3.5 py-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
              Route Time
            </div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              {formatDuration(option.totalDurationMs)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {option.remainingScore > 0 ? `Short ${formatScore(option.remainingScore)}` : "On target"}
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/60 px-3.5 py-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80">
              Status
            </div>
            <div className="mt-2 text-sm font-semibold">{routeStatusLabel}</div>
            <div className="mt-1 text-xs text-muted-foreground">{getRouteStatusDetail(option)}</div>
          </div>
        </div>

        <div className="space-y-2">
          {sortedRuns.map((run) => {
            return (
              <div
                key={`${run.dungeonKey}:${run.level}:${run.runState}:${Math.round(run.projectedScore * 10)}`}
                className="rounded-xl border border-border/60 bg-background/55 px-3.5 py-3"
              >
                <div className="flex min-w-0 items-start gap-3.5">
                  <DungeonPlanIcon
                    mapChallengeModeID={run.mapChallengeModeID}
                    mapName={run.mapName}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className="truncate text-sm font-medium text-foreground">{run.mapName}</div>
                      <span className="rounded-md border border-emerald-400/25 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-300">
                        +{formatScore(run.gain)}
                      </span>
                      <Badge variant="outline" className="h-6 px-2 text-[11px]">
                        +{run.level}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`h-6 px-2 text-[11px] ${
                          run.runState === "timed"
                            ? "border-emerald-400/35 text-emerald-200"
                            : "border-amber-400/35 text-amber-200"
                        }`}
                        >
                          {run.runState === "timed" ? "Timed" : "Depleted"}
                        </Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
                      <span className="font-medium text-foreground/85">
                        <ScoreText score={run.currentScore} scale="dungeon" className="font-medium" />{" "}
                        -&gt;{" "}
                        <ScoreText
                          score={run.projectedScore}
                          scale="dungeon"
                          className="font-semibold"
                        />
                      </span>
                      <span>Goal {formatDuration(run.requiredDurationMs)}</span>
                      <span
                        className={
                          run.runState === "timed"
                            ? "text-emerald-200/90"
                            : "text-amber-200/90"
                        }
                      >
                        {formatRunDelta(run)}
                      </span>
                      <span>Timer {formatDuration(run.timerMs)}</span>
                    </div>
                  </div>
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
  const [maxLevelInput, setMaxLevelInput] = useState<string>(() =>
    String(readStoredSettings(characterId, currentScore).maxLevel),
  );

  useEffect(() => {
    const nextStoredSettings = readStoredSettings(characterId, currentScore);
    setStoredSettings(nextStoredSettings);
    setMaxLevelInput(String(nextStoredSettings.maxLevel));
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
  const featuredOptions = useMemo(
    () => plannerResult.options,
    [plannerResult.options],
  );
  const routeStatusLabel =
    plannerResult.targetScore === null
      ? "Set a target"
      : plannerResult.reachable
        ? "Reachable"
        : "Unreachable";

  const targetValue =
    storedSettings.targetScore === null ? "" : String(Math.round(storedSettings.targetScore));

  function commitMaxLevelInput(rawValue: string) {
    if (rawValue.trim() === "" || !Number.isFinite(Number(rawValue))) {
      setMaxLevelInput(String(storedSettings.maxLevel));
      return;
    }

    const normalizedValue = Math.min(30, Math.max(2, Math.floor(Number(rawValue))));
    setStoredSettings((current) => ({
      ...current,
      maxLevel: normalizedValue,
    }));
    setMaxLevelInput(String(normalizedValue));
  }

  return (
    <>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Calculator size={18} className="text-muted-foreground" />
          <h3 className="text-lg font-semibold text-foreground">Mythic Planner</h3>
        </div>
        <p className="text-sm text-muted-foreground">Target score routes for {characterName}.</p>
      </div>

      <div className="mt-6 space-y-6">
        <Card className="border-border/70">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="text-base">Planner Inputs</CardTitle>
            <CardDescription>Saved per character.</CardDescription>
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
                  value={maxLevelInput}
                  onChange={(event) => setMaxLevelInput(event.target.value)}
                  onBlur={(event) => commitMaxLevelInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitMaxLevelInput((event.target as HTMLInputElement).value);
                    }
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
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="border-b border-border/60 pb-3">
            <CardTitle className="text-base">Plan Summary</CardTitle>
            <CardDescription>Based on current bests.</CardDescription>
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
                <span
                  className={
                    plannerResult.targetScore === null
                      ? "text-foreground"
                      : plannerResult.reachable
                        ? "text-emerald-300"
                        : "text-orange-200"
                  }
                >
                  {routeStatusLabel}
                </span>
              </div>
              {plannerResult.targetScore !== null && !plannerResult.reachable && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Current exclusions or max key level make the target unreachable.
                </div>
              )}
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
            <div className="grid gap-4 xl:grid-cols-2">
              {featuredOptions.map((option) => (
                <OptionCard
                  key={option.id}
                  option={option}
                  targetScore={plannerResult.targetScore}
                  featured
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

