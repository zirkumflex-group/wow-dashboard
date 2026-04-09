import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import type { Id } from "@wow-dashboard/backend/convex/_generated/dataModel";
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
import { useQuery } from "convex/react";
import { Scale } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { getClassTextColor } from "../lib/class-colors";

export const Route = createFileRoute("/compare")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: "/" });
  },
  component: RouteComponent,
});

// ---- Constants ----

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function classColor(cls: string) {
  return getClassTextColor(cls);
}

// ---- Stat options ----

type StatKey =
  | "itemLevel"
  | "mythicPlusScore"
  | "gold"
  | "critPercent"
  | "hastePercent"
  | "masteryPercent"
  | "versatilityPercent"
  | "playtimeHours";

const STAT_OPTIONS: { key: StatKey; label: string; format: (v: number) => string }[] = [
  { key: "itemLevel", label: "Item Level", format: (v) => v.toFixed(1) },
  { key: "mythicPlusScore", label: "M+ Score", format: (v) => v.toLocaleString() },
  { key: "gold", label: "Gold", format: (v) => `${Math.floor(v).toLocaleString()}g` },
  { key: "critPercent", label: "Crit %", format: (v) => `${v.toFixed(1)}%` },
  { key: "hastePercent", label: "Haste %", format: (v) => `${v.toFixed(1)}%` },
  { key: "masteryPercent", label: "Mastery %", format: (v) => `${v.toFixed(1)}%` },
  { key: "versatilityPercent", label: "Versatility %", format: (v) => `${v.toFixed(1)}%` },
  {
    key: "playtimeHours",
    label: "Playtime",
    format: (v) => {
      const d = Math.floor(v / 24);
      const h = Math.floor(v % 24);
      return d > 0 ? `${d}d ${h}h` : `${h}h`;
    },
  },
];

// ---- Time Frame ----

type TimeFrame = "12h" | "24h" | "1d" | "3d" | "1w" | "2w" | "1m" | "3m" | "all";

const TIME_FRAME_OPTIONS: { value: TimeFrame; label: string }[] = [
  { value: "12h", label: "12H" },
  { value: "24h", label: "24H" },
  { value: "1d", label: "1D" },
  { value: "3d", label: "3D" },
  { value: "1w", label: "1W" },
  { value: "2w", label: "2W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "all", label: "All" },
];

function filterByTimeFrame<T extends { takenAt: number }>(items: T[], frame: TimeFrame): T[] {
  if (frame === "all") return items;
  const nowSec = Date.now() / 1000;
  const hours: Partial<Record<TimeFrame, number>> = { "12h": 12, "24h": 24 };
  if (hours[frame] !== undefined) {
    const cutoff = nowSec - hours[frame]! * 3600;
    return items.filter((s) => s.takenAt >= cutoff);
  }
  const days = { "1d": 1, "3d": 3, "1w": 7, "2w": 14, "1m": 30, "3m": 90 }[
    frame as Exclude<TimeFrame, "12h" | "24h" | "all">
  ];
  const cutoff = nowSec - days * 86400;
  return items.filter((s) => s.takenAt >= cutoff);
}

// ---- Snapshot type ----

type Snapshot = {
  takenAt: number;
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  mythicPlusScore: number;
  spec: string;
  role: string;
  stats: {
    critPercent: number;
    hastePercent: number;
    masteryPercent: number;
    versatilityPercent: number;
  };
};

function getSnapshotStat(s: Snapshot, stat: StatKey): number {
  switch (stat) {
    case "itemLevel":
      return s.itemLevel;
    case "mythicPlusScore":
      return s.mythicPlusScore;
    case "gold":
      return s.gold;
    case "playtimeHours":
      return s.playtimeSeconds / 3600;
    case "critPercent":
      return s.stats.critPercent;
    case "hastePercent":
      return s.stats.hastePercent;
    case "masteryPercent":
      return s.stats.masteryPercent;
    case "versatilityPercent":
      return s.stats.versatilityPercent;
  }
}

// ---- Formatters ----

function formatDate(takenAtSeconds: number) {
  return new Date(takenAtSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateShort(takenAtSeconds: number) {
  return new Date(takenAtSeconds * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// ---- Merged data builder ----

/**
 * Builds a unified timeline dataset for recharts AreaChart.
 * Assigns each character's snapshots to day buckets (by ISO day string).
 * Each row: { date: timestamp, char_0: value, char_1: value, ... }
 */
function buildMergedData(
  characterSnapshots: { key: string; snapshots: Snapshot[] }[],
  stat: StatKey,
  timeFrame: TimeFrame,
): Record<string, number>[] {
  // Map: day ISO string -> { date: timestamp, char_key: value }
  const dayMap = new Map<string, Record<string, number>>();

  for (const { key, snapshots } of characterSnapshots) {
    const filtered = filterByTimeFrame(snapshots, timeFrame);
    // Group by day, keep last per day (snapshots are sorted asc)
    const byDay = new Map<string, Snapshot>();
    for (const s of filtered) {
      const d = new Date(s.takenAt * 1000);
      const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      byDay.set(dayKey, s);
    }

    for (const [dayKey, snap] of byDay) {
      if (!dayMap.has(dayKey)) {
        dayMap.set(dayKey, { date: snap.takenAt });
      }
      dayMap.get(dayKey)![key] = getSnapshotStat(snap, stat);
    }
  }

  return [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}

// ---- Compare Chart ----

function CompareChart({
  characterSnapshots,
  characterNames,
  stat,
  timeFrame,
}: {
  characterSnapshots: { key: string; snapshots: Snapshot[] }[];
  characterNames: Record<string, string>;
  stat: StatKey;
  timeFrame: TimeFrame;
}) {
  const statOpt = STAT_OPTIONS.find((s) => s.key === stat)!;
  const data = buildMergedData(characterSnapshots, stat, timeFrame);

  const config: ChartConfig = Object.fromEntries(
    characterSnapshots.map(({ key }, i) => [
      key,
      { label: characterNames[key] ?? key, color: CHART_COLORS[i % CHART_COLORS.length] },
    ]),
  );

  if (data.length < 1) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
        No data for the selected time range.
      </div>
    );
  }

  // Compute Y-axis domain
  const keys = characterSnapshots.map((c) => c.key);
  const allValues = data
    .flatMap((d) => keys.map((k) => d[k]))
    .filter((v) => typeof v === "number" && !isNaN(v));
  const minVal = allValues.length ? Math.min(...allValues) : 0;
  const maxVal = allValues.length ? Math.max(...allValues) : 0;
  const range = maxVal - minVal;
  const pad = range > 0 ? range * 0.1 : Math.abs(maxVal) * 0.05 || 1;
  const yDomain: [number, number] = [Math.floor(minVal - pad), Math.ceil(maxVal + pad)];

  const xAxisInterval = data.length > 10 ? Math.ceil(data.length / 10) - 1 : 0;
  // Always show dots when few points; hide only when there are many
  const hideDots = data.length > 15;

  return (
    <ChartContainer config={config} className="w-full h-[300px]">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
        <defs>
          {characterSnapshots.map(({ key }, i) => (
            <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                stopOpacity={0.3}
              />
              <stop
                offset="95%"
                stopColor={CHART_COLORS[i % CHART_COLORS.length]}
                stopOpacity={0.02}
              />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        <XAxis
          dataKey="date"
          type="category"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tick={{ fontSize: 10 }}
          interval={xAxisInterval}
          tickFormatter={(ts: number) => formatDateShort(ts)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tick={{ fontSize: 10 }}
          width={52}
          domain={yDomain}
          tickFormatter={statOpt.format}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => {
                return new Date((value as number) * 1000).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                });
              }}
              indicator="dot"
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {characterSnapshots.map(({ key }, i) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={2}
            fill={`url(#fill-${key})`}
            dot={
              hideDots
                ? false
                : {
                    r: data.length === 1 ? 5 : 3,
                    strokeWidth: 0,
                    fill: CHART_COLORS[i % CHART_COLORS.length],
                  }
            }
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}

// ---- Main component ----

function RouteComponent() {
  const scoreboard = useQuery(api.characters.getScoreboard);

  // Fixed slots for up to 4 character queries
  const [selectedChars, setSelectedChars] = useState<string[]>([]);
  const [specFilters, setSpecFilters] = useState<Record<string, string | null>>({});
  const [selectedStat, setSelectedStat] = useState<StatKey>("itemLevel");
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("1w");

  const charId0 = selectedChars[0] ?? null;
  const charId1 = selectedChars[1] ?? null;
  const charId2 = selectedChars[2] ?? null;
  const charId3 = selectedChars[3] ?? null;

  const snap0 = useQuery(
    api.characters.getCharacterSnapshots,
    charId0 ? { characterId: charId0 as Id<"characters"> } : "skip",
  );
  const snap1 = useQuery(
    api.characters.getCharacterSnapshots,
    charId1 ? { characterId: charId1 as Id<"characters"> } : "skip",
  );
  const snap2 = useQuery(
    api.characters.getCharacterSnapshots,
    charId2 ? { characterId: charId2 as Id<"characters"> } : "skip",
  );
  const snap3 = useQuery(
    api.characters.getCharacterSnapshots,
    charId3 ? { characterId: charId3 as Id<"characters"> } : "skip",
  );

  const snapshotResults = [snap0, snap1, snap2, snap3];

  function toggleChar(id: string) {
    if (selectedChars.includes(id)) {
      setSelectedChars((prev) => prev.filter((c) => c !== id));
      setSpecFilters((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else if (selectedChars.length < 4) {
      setSelectedChars((prev) => [...prev, id]);
    }
  }

  function setSpecFilter(charId: string, spec: string | null) {
    setSpecFilters((prev) => ({ ...prev, [charId]: spec }));
  }

  // Available specs per selected character (from snapshot history)
  const charAvailableSpecs: Record<
    string,
    Array<{ spec: string; role: string }>
  > = Object.fromEntries(
    selectedChars.map((id, i) => {
      const result = snapshotResults[i];
      if (!result) return [id, []];
      const seen = new Map<string, string>();
      for (const s of result.snapshots as Snapshot[]) {
        if (s.spec && s.spec !== "Unknown" && s.role !== "Unknown" && !seen.has(s.spec))
          seen.set(s.spec, s.role);
      }
      return [id, Array.from(seen.entries()).map(([spec, role]) => ({ spec, role }))];
    }),
  );

  // Build characterSnapshots for chart (with optional spec filter per character)
  const characterSnapshots: { key: string; snapshots: Snapshot[] }[] = selectedChars
    .map((id, i) => {
      const result = snapshotResults[i];
      if (!result) return null;
      const specFilter = specFilters[id] ?? null;
      const snapshots = (result.snapshots as Snapshot[]).filter(
        (s) =>
          s.spec !== "Unknown" && s.role !== "Unknown" && (!specFilter || s.spec === specFilter),
      );
      return { key: `char_${i}`, snapshots };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Map char_0, char_1... to names (include spec if filtered)
  const characterNames: Record<string, string> = Object.fromEntries(
    selectedChars.map((id, i) => {
      const entry = scoreboard?.find((c) => c.characterId === id);
      const name = entry?.name ?? id;
      const specFilter = specFilters[id];
      return [`char_${i}`, specFilter ? `${name} (${specFilter})` : name];
    }),
  );

  const isLoading = selectedChars.some((id, i) => snapshotResults[i] === undefined);
  const hasEnoughData = characterSnapshots.length >= 2;

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Scale className="h-7 w-7 text-muted-foreground" />
          Compare
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Select up to 4 characters and a stat to compare over time
        </p>
      </div>

      {/* Character selector */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-sm font-medium">
            Characters{" "}
            <span className="text-muted-foreground font-normal">
              ({selectedChars.length}/4 selected)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {scoreboard === undefined ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-8 w-28 rounded-md bg-muted animate-pulse" />
              ))}
            </div>
          ) : scoreboard.length === 0 ? (
            <p className="text-muted-foreground text-sm">No characters found.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {scoreboard.map((entry) => {
                const isSelected = selectedChars.includes(entry.characterId);
                const isDisabled = !isSelected && selectedChars.length >= 4;
                return (
                  <button
                    key={entry.characterId}
                    onClick={() => !isDisabled && toggleChar(entry.characterId)}
                    disabled={isDisabled}
                    className={[
                      "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
                      isSelected
                        ? "border-primary bg-primary/10"
                        : isDisabled
                          ? "border-border/40 opacity-40 cursor-not-allowed"
                          : "border-border hover:border-primary/50 hover:bg-muted/50 cursor-pointer",
                    ].join(" ")}
                  >
                    <span className={classColor(entry.class)}>{entry.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {entry.spec} {entry.class}
                    </span>
                    <span className="text-muted-foreground/60 text-xs capitalize">
                      · {entry.role}
                    </span>
                    {isSelected && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ×{selectedChars.indexOf(entry.characterId) + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Spec / role filter for selected characters */}
          {selectedChars.length > 0 &&
            selectedChars.some((id) => (charAvailableSpecs[id]?.length ?? 0) > 1) && (
              <div className="mt-4 pt-4 border-t space-y-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">
                  Spec filter
                </p>
                {selectedChars.map((id) => {
                  const entry = scoreboard?.find((c) => c.characterId === id);
                  const specs = charAvailableSpecs[id] ?? [];
                  if (specs.length <= 1) return null;
                  const currentFilter = specFilters[id] ?? null;
                  return (
                    <div key={id} className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-sm font-medium min-w-[80px] ${classColor(entry?.class ?? "")}`}
                      >
                        {entry?.name}
                      </span>
                      <button
                        onClick={() => setSpecFilter(id, null)}
                        className={[
                          "text-xs px-2 py-0.5 rounded border transition-colors",
                          currentFilter === null
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/50",
                        ].join(" ")}
                      >
                        All
                      </button>
                      {specs.map(({ spec, role }) => (
                        <button
                          key={spec}
                          onClick={() => setSpecFilter(id, spec)}
                          className={[
                            "text-xs px-2 py-0.5 rounded border transition-colors flex items-center gap-1",
                            currentFilter === spec
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border text-muted-foreground hover:border-primary/50",
                          ].join(" ")}
                        >
                          {spec}
                          <span className="opacity-60 capitalize">({role})</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
        </CardContent>
      </Card>

      {/* Stat + Time frame selector */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Card className="flex-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Stat
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5 pt-0">
            {STAT_OPTIONS.map((opt) => (
              <Button
                key={opt.key}
                size="sm"
                variant={selectedStat === opt.key ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setSelectedStat(opt.key)}
              >
                {opt.label}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Time Range
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5 pt-0">
            {TIME_FRAME_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={timeFrame === opt.value ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setTimeFrame(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-sm font-medium">
            {STAT_OPTIONS.find((s) => s.key === selectedStat)?.label ?? selectedStat}
            {selectedChars.length > 0 && (
              <span className="text-muted-foreground font-normal ml-2">
                —{" "}
                {selectedChars
                  .map((id) => scoreboard?.find((c) => c.characterId === id)?.name ?? id)
                  .join(", ")}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {selectedChars.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[300px] text-center">
              <Scale className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">Select at least 2 characters above</p>
            </div>
          ) : selectedChars.length === 1 ? (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
              Select one more character to compare
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-[300px]">
              <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          ) : !hasEnoughData ? (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground text-sm">
              Could not load snapshot data.
            </div>
          ) : (
            <CompareChart
              characterSnapshots={characterSnapshots}
              characterNames={characterNames}
              stat={selectedStat}
              timeFrame={timeFrame}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
