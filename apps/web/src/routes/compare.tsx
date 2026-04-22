import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Button } from "@wow-dashboard/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@wow-dashboard/ui/components/chart";
import { Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { apiQueryOptions } from "@/lib/api-client";
import { getClassTextColor } from "../lib/class-colors";

export const Route = createFileRoute("/compare")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: "/" });
  },
  component: RouteComponent,
});

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

type StatKey = "mythicPlusScore" | "itemLevel" | "keystoneLevel" | "playtimeHours";

const STAT_OPTIONS: { key: StatKey; label: string; format: (value: number) => string }[] = [
  { key: "mythicPlusScore", label: "M+ Score", format: (value) => Math.round(value).toLocaleString() },
  { key: "itemLevel", label: "Item Level", format: (value) => value.toFixed(1) },
  { key: "keystoneLevel", label: "Keystone Level", format: (value) => `+${Math.round(value)}` },
  {
    key: "playtimeHours",
    label: "Playtime",
    format: (value) => {
      const totalHours = Math.round(value);
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
    },
  },
];

type TimeFrame = "7d" | "30d" | "90d" | "all";

const TIME_FRAME_OPTIONS: { value: TimeFrame; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

const TIME_FRAME_DAYS: Record<Exclude<TimeFrame, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

type Snapshot = {
  takenAt: number;
  itemLevel: number;
  mythicPlusScore: number;
  playtimeSeconds: number;
  ownedKeystone?: {
    level: number;
    mapChallengeModeID?: number;
    mapName?: string;
  };
};

type CharacterTimeline = {
  key: string;
  name: string;
  snapshots: Snapshot[];
};

function classColor(className: string) {
  return getClassTextColor(className);
}

function dayKeyFromSeconds(seconds: number) {
  const date = new Date(seconds * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayStartSeconds(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function formatDateShort(takenAtSeconds: number) {
  return new Date(takenAtSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getSnapshotStat(snapshot: Snapshot, stat: StatKey): number | null {
  switch (stat) {
    case "itemLevel":
      return snapshot.itemLevel;
    case "mythicPlusScore":
      return snapshot.mythicPlusScore;
    case "keystoneLevel":
      return snapshot.ownedKeystone?.level ?? null;
    case "playtimeHours":
      return snapshot.playtimeSeconds / 3600;
  }
}

type TimelineRow = { date: number } & Record<string, number | null>;

function buildTimelineData(
  characterTimelines: CharacterTimeline[],
  stat: StatKey,
  timeFrame: TimeFrame,
): TimelineRow[] {
  if (characterTimelines.length === 0) return [];

  const nowSeconds = Math.floor(Date.now() / 1000);
  const cutoffSeconds =
    timeFrame === "all" ? null : nowSeconds - TIME_FRAME_DAYS[timeFrame] * 86400;

  const dayKeys = new Set<string>();
  for (const timeline of characterTimelines) {
    for (const snapshot of timeline.snapshots) {
      if (cutoffSeconds !== null && snapshot.takenAt < cutoffSeconds) continue;
      dayKeys.add(dayKeyFromSeconds(snapshot.takenAt));
    }
  }

  if (cutoffSeconds !== null) {
    dayKeys.add(dayKeyFromSeconds(cutoffSeconds));
    dayKeys.add(dayKeyFromSeconds(nowSeconds));
  }

  const sortedDayKeys = [...dayKeys].sort();
  if (sortedDayKeys.length === 0) return [];

  const rows: TimelineRow[] = sortedDayKeys.map((dayKey) => ({ date: dayStartSeconds(dayKey) }));

  for (const timeline of characterTimelines) {
    const sortedSnapshots = [...timeline.snapshots].sort((a, b) => a.takenAt - b.takenAt);
    let snapshotIndex = 0;
    let latestValue: number | null = null;

    for (const row of rows) {
      const dayEndSeconds = row.date + 86399;
      while (
        snapshotIndex < sortedSnapshots.length &&
        sortedSnapshots[snapshotIndex]!.takenAt <= dayEndSeconds
      ) {
        latestValue = getSnapshotStat(sortedSnapshots[snapshotIndex]!, stat);
        snapshotIndex += 1;
      }
      row[timeline.key] = latestValue;
    }
  }

  return rows;
}

function CompareChart({
  characterTimelines,
  stat,
  timeFrame,
}: {
  characterTimelines: CharacterTimeline[];
  stat: StatKey;
  timeFrame: TimeFrame;
}) {
  const statOption = STAT_OPTIONS.find((option) => option.key === stat)!;
  const data = useMemo(
    () => buildTimelineData(characterTimelines, stat, timeFrame),
    [characterTimelines, stat, timeFrame],
  );

  const config: ChartConfig = Object.fromEntries(
    characterTimelines.map((timeline, index) => [
      timeline.key,
      { label: timeline.name, color: CHART_COLORS[index % CHART_COLORS.length] },
    ]),
  );

  if (data.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
        No data in selected range.
      </div>
    );
  }

  const keys = characterTimelines.map((timeline) => timeline.key);
  const numericValues = data
    .flatMap((row) => keys.map((key) => row[key]))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  const minValue = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : 1;
  const range = maxValue - minValue;
  const padding = range > 0 ? range * 0.1 : Math.max(1, Math.abs(maxValue) * 0.05);
  const yDomain: [number, number] = [Math.floor(minValue - padding), Math.ceil(maxValue + padding)];

  const xAxisInterval = data.length > 12 ? Math.ceil(data.length / 12) - 1 : 0;

  return (
    <ChartContainer config={config} className="h-[320px] w-full">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.14} />
        <XAxis
          dataKey="date"
          type="category"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tick={{ fontSize: 10 }}
          interval={xAxisInterval}
          tickFormatter={(timestamp: number) => formatDateShort(timestamp)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tick={{ fontSize: 10 }}
          width={56}
          domain={yDomain}
          tickFormatter={statOption.format}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) =>
                new Date((value as number) * 1000).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              }
              indicator="dot"
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {characterTimelines.map((timeline, index) => (
          <Line
            key={timeline.key}
            type="monotone"
            dataKey={timeline.key}
            stroke={CHART_COLORS[index % CHART_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

function RouteComponent() {
  const scoreboardQuery = useQuery(apiQueryOptions.scoreboardCharacters());
  const scoreboardEntries = scoreboardQuery.data ?? [];

  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [selectedStat, setSelectedStat] = useState<StatKey>("mythicPlusScore");
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("30d");

  const snapshotQueries = useQueries({
    queries: selectedCharacterIds.map((characterId) =>
      apiQueryOptions.characterSnapshotTimeline(characterId, { timeFrame }),
    ),
  });

  function toggleCharacter(characterId: string) {
    if (selectedCharacterIds.includes(characterId)) {
      setSelectedCharacterIds((current) => current.filter((id) => id !== characterId));
      return;
    }
    if (selectedCharacterIds.length >= 4) return;
    setSelectedCharacterIds((current) => [...current, characterId]);
  }

  const characterTimelines: CharacterTimeline[] = selectedCharacterIds
    .map((characterId, index) => {
      const result = snapshotQueries[index]?.data;
      if (!result) return null;

      const entry = scoreboardEntries.find((candidate) => candidate.characterId === characterId);
      return {
        key: `char_${index}`,
        name: entry?.name ?? characterId,
        snapshots: result.snapshots as Snapshot[],
      };
    })
    .filter((timeline): timeline is CharacterTimeline => timeline !== null);

  const selectedLabels = selectedCharacterIds
    .map((characterId) => scoreboardEntries.find((entry) => entry.characterId === characterId)?.name ?? characterId)
    .join(", ");

  useEffect(() => {
    const appTitle = "WoW Dashboard";
    if (selectedCharacterIds.length === 0) {
      document.title = `Compare | ${appTitle}`;
      return;
    }

    const selectedNames = selectedCharacterIds.map(
      (characterId) =>
        scoreboardEntries.find((entry) => entry.characterId === characterId)?.name ?? characterId,
    );
    const compactLabel = selectedNames.slice(0, 2).join(" vs ");
    const overflowLabel = selectedNames.length > 2 ? ` +${selectedNames.length - 2}` : "";
    document.title = `${compactLabel}${overflowLabel} | Compare | ${appTitle}`;
  }, [scoreboardEntries, selectedCharacterIds]);

  const isLoadingSnapshots = snapshotQueries.some((query) => query.data === undefined);
  const hasEnoughCharacters = characterTimelines.length >= 2;

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Scale className="h-7 w-7 text-muted-foreground" />
          Compare
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compare core progression metrics with stable timeline alignment.
        </p>
      </div>

      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-sm font-medium">
            Characters{" "}
            <span className="font-normal text-muted-foreground">
              ({selectedCharacterIds.length}/4 selected)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {scoreboardQuery.data === undefined ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-8 w-28 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : scoreboardEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No characters found.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {scoreboardEntries.map((entry) => {
                const isSelected = selectedCharacterIds.includes(entry.characterId);
                const isDisabled = !isSelected && selectedCharacterIds.length >= 4;
                return (
                  <button
                    key={entry.characterId}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => toggleCharacter(entry.characterId)}
                    className={[
                      "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
                      isSelected
                        ? "border-primary bg-primary/10"
                        : isDisabled
                          ? "cursor-not-allowed border-border/40 opacity-40"
                          : "cursor-pointer border-border hover:border-primary/40 hover:bg-muted/40",
                    ].join(" ")}
                  >
                    <span className={classColor(entry.class)}>{entry.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {entry.spec} {entry.class}
                    </span>
                    {isSelected && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        x{selectedCharacterIds.indexOf(entry.characterId) + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Metric
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5 pt-0">
            {STAT_OPTIONS.map((option) => (
              <Button
                key={option.key}
                size="sm"
                variant={selectedStat === option.key ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setSelectedStat(option.key)}
              >
                {option.label}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Time Range
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5 pt-0">
            {TIME_FRAME_OPTIONS.map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={timeFrame === option.value ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setTimeFrame(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-sm font-medium">
            {STAT_OPTIONS.find((option) => option.key === selectedStat)?.label ?? selectedStat}
            {selectedLabels && (
              <span className="ml-2 font-normal text-muted-foreground">- {selectedLabels}</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {selectedCharacterIds.length === 0 ? (
            <div className="flex h-[320px] flex-col items-center justify-center text-center">
              <Scale className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Select at least 2 characters above.</p>
            </div>
          ) : selectedCharacterIds.length === 1 ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
              Select one more character to compare.
            </div>
          ) : isLoadingSnapshots ? (
            <div className="flex h-[320px] items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : !hasEnoughCharacters ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
              Could not load snapshot data.
            </div>
          ) : (
            <CompareChart
              characterTimelines={characterTimelines}
              stat={selectedStat}
              timeFrame={timeFrame}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
