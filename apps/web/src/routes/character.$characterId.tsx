import { createFileRoute } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import type { Id } from "@wow-dashboard/backend/convex/_generated/dataModel";
import { Badge } from "@wow-dashboard/ui/components/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@wow-dashboard/ui/components/tabs";
import { useQuery } from "convex/react";
import { Clock, Coins, Flame, Gem, History, Maximize2, Sword, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/character/$characterId")({
  component: RouteComponent,
});

// ---- Constants ----

const CLASS_COLORS: Record<string, string> = {
  warrior: "text-amber-500",
  paladin: "text-pink-400",
  hunter: "text-green-500",
  rogue: "text-yellow-400",
  priest: "text-gray-100",
  "death knight": "text-red-500",
  shaman: "text-blue-400",
  mage: "text-cyan-400",
  warlock: "text-purple-400",
  monk: "text-emerald-400",
  druid: "text-orange-400",
  "demon hunter": "text-violet-500",
  evoker: "text-teal-400",
};

const ROLE_LABELS: Record<string, string> = {
  tank: "Tank",
  healer: "Healer",
  dps: "DPS",
};

// ---- Formatters ----

function classColor(cls: string) {
  return CLASS_COLORS[cls.toLowerCase()] ?? "text-foreground";
}

function formatPlaytime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

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

/** Parse gold value stored as GGGGG.SSCC (e.g. 366492.2707) */
function parseGoldValue(value: number) {
  const totalCopper = Math.round(value * 10000);
  const gold = Math.floor(totalCopper / 10000);
  const silver = Math.floor((totalCopper % 10000) / 100);
  const copper = totalCopper % 100;
  return { gold, silver, copper };
}

/** Just the gold integer for chart Y-axis */
function goldUnits(value: number) {
  return Math.floor(value);
}

// ---- Components ----

/** Renders "366,492g 27s 7c" with WoW currency colors */
function GoldDisplay({ value }: { value: number }) {
  const { gold, silver, copper } = parseGoldValue(value);
  return (
    <span className="tabular-nums font-medium">
      {gold > 0 && <span className="text-yellow-400">{gold.toLocaleString()}g </span>}
      {silver > 0 && <span className="text-slate-400">{silver}s </span>}
      {(copper > 0 || (gold === 0 && silver === 0)) && (
        <span className="text-orange-500">{copper}c</span>
      )}
    </span>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function StatGrid({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-muted/30 rounded-md p-2 text-center">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-semibold text-sm mt-0.5">{value}</div>
    </div>
  );
}

// ---- Fullscreen ----

function FullscreenOverlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-background/60 backdrop-blur-xl flex flex-col"
      onClick={onClose}
    >
      <div
        className="flex-1 flex flex-col p-6 max-w-6xl mx-auto w-full min-h-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
            aria-label="Close fullscreen"
          >
            <X size={16} className="transition-transform duration-200 hover:rotate-90" />
          </button>
        </div>
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function FullscreenButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
      aria-label="View fullscreen"
    >
      <Maximize2 size={13} className="transition-transform duration-200 hover:scale-110" />
    </button>
  );
}

// ---- Types ----

type Snapshot = {
  takenAt: number;
  level: number;
  spec: string;
  role: "tank" | "healer" | "dps";
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  mythicPlusScore: number;
  currencies: {
    adventurerDawncrest: number;
    veteranDawncrest: number;
    championDawncrest: number;
    heroDawncrest: number;
    mythDawncrest: number;
    radiantSparkDust: number;
  };
  stats: {
    stamina: number;
    strength: number;
    agility: number;
    intellect: number;
    critPercent: number;
    hastePercent: number;
    masteryPercent: number;
    versatilityPercent: number;
  };
};

// ---- Snapshot grouping ----

/** Reduce dense snapshot arrays for chart readability.
 *  Cascades daily → weekly → monthly until ≤30 points remain.
 *  Always uses the coarsest granularity that keeps the result ≤30 pts,
 *  starting from daily so short bursts of snapshots are never over-collapsed.
 *  Keeps the *last* snapshot in each period so values are always real readings. */
function groupSnapshotsAuto(snapshots: Snapshot[]): Snapshot[] {
  if (snapshots.length <= 30) return snapshots;

  // Helper: group by an arbitrary key function, keeping last per period
  function groupBy(snaps: Snapshot[], key: (s: Snapshot) => string): Snapshot[] {
    const map = new Map<string, Snapshot>();
    for (const s of snaps) map.set(key(s), s);
    return [...map.values()];
  }

  const toDay = (s: Snapshot) => {
    const d = new Date(s.takenAt * 1000);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };

  const toWeek = (s: Snapshot) => {
    const d = new Date(s.takenAt * 1000);
    const day = d.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setDate(d.getDate() + diff);
    return `${mon.getFullYear()}-${mon.getMonth()}-${mon.getDate()}`;
  };

  const toMonth = (s: Snapshot) => {
    const d = new Date(s.takenAt * 1000);
    return `${d.getFullYear()}-${d.getMonth()}`;
  };

  const daily = groupBy(snapshots, toDay);
  if (daily.length <= 30) return daily;

  const weekly = groupBy(snapshots, toWeek);
  if (weekly.length <= 30) return weekly;

  return groupBy(snapshots, toMonth);
}

// ---- Chart configs ----

const ilvlConfig: ChartConfig = {
  itemLevel: { label: "Item Level", color: "var(--chart-1)" },
};
const mplusConfig: ChartConfig = {
  mythicPlusScore: { label: "M+ Score", color: "var(--chart-2)" },
};
const goldConfig: ChartConfig = {
  gold: { label: "Gold", color: "oklch(0.85 0.15 85)" },
};
const playtimeConfig: ChartConfig = {
  playtimeHours: { label: "Playtime", color: "var(--chart-5)" },
};
const secondaryStatsConfig: ChartConfig = {
  critPercent: { label: "Crit", color: "var(--chart-1)" },
  hastePercent: { label: "Haste", color: "var(--chart-2)" },
  masteryPercent: { label: "Mastery", color: "var(--chart-3)" },
  versatilityPercent: { label: "Versatility", color: "var(--chart-4)" },
};
const currenciesConfig: ChartConfig = {
  adventurerDawncrest: { label: "Adventurer", color: "var(--chart-1)" },
  veteranDawncrest: { label: "Veteran", color: "var(--chart-2)" },
  championDawncrest: { label: "Champion", color: "var(--chart-3)" },
  heroDawncrest: { label: "Hero", color: "var(--chart-4)" },
  mythDawncrest: { label: "Myth", color: "var(--chart-5)" },
  radiantSparkDust: { label: "Spark Dust", color: "oklch(0.75 0.18 310)" },
};

// ---- Reusable line chart ----

function SnapshotLineChart({
  data,
  lines,
  config,
  valueFormatter,
  tooltipFormatter,
  className,
  showLegend,
  yPadMaxFactor,
}: {
  data: Record<string, number | string>[];
  lines: { key: string; color: string }[];
  config: ChartConfig;
  /** Used for Y-axis tick labels and default tooltip */
  valueFormatter?: (v: number) => string;
  /** Override tooltip value rendering (ReactNode) */
  tooltipFormatter?: (v: number) => React.ReactNode;
  /** Override container height class (default: "h-[200px]") */
  className?: string;
  /** Show a legend below the chart */
  showLegend?: boolean;
  /** When set, y-axis padding is maxVal * this factor instead of range-based (e.g. 0.01 = ±1% of max) */
  yPadMaxFactor?: number;
}) {
  if (data.length < 2) {
    return (
      <p className="text-muted-foreground text-sm py-6 text-center">Not enough data points yet.</p>
    );
  }

  const isMultiLine = lines.length > 1;

  // Build the right tooltip formatter depending on line count and formatter type.
  // When formatter is provided and there are multiple lines, we must manually
  // render the colored indicator + label ourselves because ChartTooltipContent's
  // `formatter` prop replaces the entire row (dot + label + value).
  const tooltipContent = (() => {
    if (tooltipFormatter) {
      // Single-line with custom ReactNode value (e.g. GoldDisplay)
      return <ChartTooltipContent formatter={(val) => tooltipFormatter(val as number)} />;
    }
    if (valueFormatter && isMultiLine) {
      // Multi-line with formatted values — show dot + label + formatted value
      return (
        <ChartTooltipContent
          formatter={(val, name, item) => (
            <>
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color }}
              />
              <span className="flex-1 text-muted-foreground">
                {config[name as string]?.label ?? name}
              </span>
              <span className="ml-auto font-mono font-medium tabular-nums">
                {valueFormatter(val as number)}
              </span>
            </>
          )}
        />
      );
    }
    if (valueFormatter) {
      // Single-line with formatted value
      return (
        <ChartTooltipContent
          formatter={(val) => (
            <span className="font-mono font-medium">{valueFormatter(val as number)}</span>
          )}
        />
      );
    }
    // No formatter — default rendering already shows indicator + label + value
    return <ChartTooltipContent />;
  })();

  // Show at most ~10 ticks on X axis
  const xAxisInterval = data.length > 10 ? Math.ceil(data.length / 10) - 1 : 0;

  // Compute Y-axis domain from actual data so the chart isn't squashed to 0-based range
  const allValues = data
    .flatMap((d) =>
      lines.map((l) => {
        const v = d[l.key];
        return typeof v === "number" ? v : NaN;
      }),
    )
    .filter((v) => !isNaN(v));
  const minVal = allValues.length ? Math.min(...allValues) : 0;
  const maxVal = allValues.length ? Math.max(...allValues) : 0;
  const range = maxVal - minVal;
  const pad =
    yPadMaxFactor != null
      ? Math.abs(maxVal) * yPadMaxFactor || 1
      : range > 0
        ? range * 0.1
        : Math.abs(maxVal) * 0.05 || 1;
  const yDomain: [number, number] = [Math.floor(minVal - pad), Math.ceil(maxVal + pad)];

  return (
    <ChartContainer config={config} className={`w-full ${className ?? "h-[200px]"}`}>
      <LineChart
        data={data}
        margin={{ top: 8, right: 8, left: 4, bottom: 8 }}
        style={{ overflow: "visible" }}
      >
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tick={{ fontSize: 10 }}
          interval={xAxisInterval}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tick={{ fontSize: 10 }}
          tickFormatter={valueFormatter}
          width={52}
          domain={yDomain}
        />
        <ChartTooltip
          content={tooltipContent}
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          isAnimationActive={false}
          wrapperStyle={{ pointerEvents: "none" }}
        />
        {showLegend && <ChartLegend content={<ChartLegendContent />} />}
        {lines.map(({ key, color }) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3, fill: color, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

// ---- Inline chart cards ----

function IlvlChartCard({ snapshots }: { snapshots: Snapshot[] }) {
  const [fullscreen, setFullscreen] = useState(false);
  const data = snapshots.map((s) => ({ date: formatDateShort(s.takenAt), itemLevel: s.itemLevel }));
  const lines = [{ key: "itemLevel", color: "var(--chart-1)" }];
  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Sword size={14} className="text-muted-foreground" />
            Item Level
          </CardTitle>
          <FullscreenButton onClick={() => setFullscreen(true)} />
        </div>
      </CardHeader>
      <CardContent>
        <SnapshotLineChart
          data={data}
          lines={lines}
          config={ilvlConfig}
          valueFormatter={(v) => v.toFixed(1)}
        />
      </CardContent>
      {fullscreen && (
        <FullscreenOverlay title="Item Level" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            data={data}
            lines={lines}
            config={ilvlConfig}
            valueFormatter={(v) => v.toFixed(1)}
            className="h-full"
            showLegend
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

function MplusChartCard({ snapshots }: { snapshots: Snapshot[] }) {
  const [fullscreen, setFullscreen] = useState(false);
  const data = snapshots.map((s) => ({
    date: formatDateShort(s.takenAt),
    mythicPlusScore: s.mythicPlusScore,
  }));
  const lines = [{ key: "mythicPlusScore", color: "var(--chart-2)" }];
  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Flame size={14} className="text-muted-foreground" />
            M+ Score
          </CardTitle>
          <FullscreenButton onClick={() => setFullscreen(true)} />
        </div>
      </CardHeader>
      <CardContent>
        <SnapshotLineChart
          data={data}
          lines={lines}
          config={mplusConfig}
          valueFormatter={(v) => v.toLocaleString()}
        />
      </CardContent>
      {fullscreen && (
        <FullscreenOverlay title="M+ Score" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            data={data}
            lines={lines}
            config={mplusConfig}
            valueFormatter={(v) => v.toLocaleString()}
            className="h-full"
            showLegend
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

function GoldChartCard({ snapshots }: { snapshots: Snapshot[] }) {
  const [fullscreen, setFullscreen] = useState(false);
  const data = snapshots.map((s) => ({ date: formatDateShort(s.takenAt), gold: s.gold }));
  const lines = [{ key: "gold", color: "oklch(0.85 0.15 85)" }];
  return (
    <Card className="sm:col-span-2">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Coins size={14} className="text-muted-foreground" />
            Gold
          </CardTitle>
          <FullscreenButton onClick={() => setFullscreen(true)} />
        </div>
      </CardHeader>
      <CardContent>
        <SnapshotLineChart
          data={data}
          lines={lines}
          config={goldConfig}
          valueFormatter={(v) => `${goldUnits(v).toLocaleString()}g`}
          tooltipFormatter={(v) => <GoldDisplay value={v} />}
          yPadMaxFactor={0.01}
        />
      </CardContent>
      {fullscreen && (
        <FullscreenOverlay title="Gold" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            data={data}
            lines={lines}
            config={goldConfig}
            valueFormatter={(v) => `${goldUnits(v).toLocaleString()}g`}
            tooltipFormatter={(v) => <GoldDisplay value={v} />}
            yPadMaxFactor={0.01}
            className="h-full"
            showLegend
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

// ---- Combat Stats card ----

function CombatStatsCard({ snapshots }: { snapshots: Snapshot[] }) {
  const [mode, setMode] = useState<"current" | "chart">("current");
  const [fullscreen, setFullscreen] = useState(false);
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return null;

  const primaryStat =
    latest.stats.strength > 0
      ? { label: "Strength", value: latest.stats.strength }
      : latest.stats.agility > 0
        ? { label: "Agility", value: latest.stats.agility }
        : latest.stats.intellect > 0
          ? { label: "Intellect", value: latest.stats.intellect }
          : null;

  const chartData = snapshots.map((s) => ({
    date: formatDateShort(s.takenAt),
    critPercent: s.stats.critPercent,
    hastePercent: s.stats.hastePercent,
    masteryPercent: s.stats.masteryPercent,
    versatilityPercent: s.stats.versatilityPercent,
  }));

  const chartLines = [
    { key: "critPercent", color: "var(--chart-1)" },
    { key: "hastePercent", color: "var(--chart-2)" },
    { key: "masteryPercent", color: "var(--chart-3)" },
    { key: "versatilityPercent", color: "var(--chart-4)" },
  ];

  return (
    <Card>
      <Tabs
        value={mode}
        onValueChange={(v) => setMode((v ?? "current") as "current" | "chart")}
        className="gap-0"
      >
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Zap size={14} className="text-muted-foreground" />
              Combat Stats
            </CardTitle>
            <div className="flex items-center gap-1.5">
              {mode === "chart" && <FullscreenButton onClick={() => setFullscreen(true)} />}
              <TabsList>
                <TabsTrigger value="current">Current</TabsTrigger>
                <TabsTrigger value="chart">Chart</TabsTrigger>
              </TabsList>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          <TabsContent value="current">
            <div className="space-y-1.5">
              <StatRow label="Stamina" value={latest.stats.stamina.toLocaleString()} />
              {primaryStat && (
                <StatRow label={primaryStat.label} value={primaryStat.value.toLocaleString()} />
              )}
              <div className="border-t border-border/50 my-2" />
              <StatRow label="Crit" value={`${latest.stats.critPercent.toFixed(2)}%`} />
              <StatRow label="Haste" value={`${latest.stats.hastePercent.toFixed(2)}%`} />
              <StatRow label="Mastery" value={`${latest.stats.masteryPercent.toFixed(2)}%`} />
              <StatRow
                label="Versatility"
                value={`${latest.stats.versatilityPercent.toFixed(2)}%`}
              />
            </div>
          </TabsContent>
          <TabsContent value="chart">
            <SnapshotLineChart
              data={chartData}
              lines={chartLines}
              config={secondaryStatsConfig}
              valueFormatter={(v) => `${v.toFixed(1)}%`}
            />
          </TabsContent>
        </CardContent>
      </Tabs>
      {fullscreen && (
        <FullscreenOverlay title="Combat Stats" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            data={chartData}
            lines={chartLines}
            config={secondaryStatsConfig}
            valueFormatter={(v) => `${v.toFixed(1)}%`}
            className="h-full"
            showLegend
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

// ---- Currencies card ----

function CurrenciesCard({ snapshots }: { snapshots: Snapshot[] }) {
  const [mode, setMode] = useState<"current" | "chart">("current");
  const [fullscreen, setFullscreen] = useState(false);
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return null;

  const chartData = snapshots.map((s) => ({
    date: formatDateShort(s.takenAt),
    adventurerDawncrest: s.currencies.adventurerDawncrest,
    veteranDawncrest: s.currencies.veteranDawncrest,
    championDawncrest: s.currencies.championDawncrest,
    heroDawncrest: s.currencies.heroDawncrest,
    mythDawncrest: s.currencies.mythDawncrest,
    radiantSparkDust: s.currencies.radiantSparkDust,
  }));

  const chartLines = [
    { key: "adventurerDawncrest", color: "var(--chart-1)" },
    { key: "veteranDawncrest", color: "var(--chart-2)" },
    { key: "championDawncrest", color: "var(--chart-3)" },
    { key: "heroDawncrest", color: "var(--chart-4)" },
    { key: "mythDawncrest", color: "var(--chart-5)" },
    { key: "radiantSparkDust", color: "oklch(0.75 0.18 310)" },
  ];

  return (
    <Card>
      <Tabs
        value={mode}
        onValueChange={(v) => setMode((v ?? "current") as "current" | "chart")}
        className="gap-0"
      >
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Gem size={14} className="text-muted-foreground" />
              Currencies
            </CardTitle>
            <div className="flex items-center gap-1.5">
              {mode === "chart" && <FullscreenButton onClick={() => setFullscreen(true)} />}
              <TabsList>
                <TabsTrigger value="current">Current</TabsTrigger>
                <TabsTrigger value="chart">Chart</TabsTrigger>
              </TabsList>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          <TabsContent value="current">
            <div className="space-y-1.5">
              <StatRow
                label="Adventurer Crest"
                value={latest.currencies.adventurerDawncrest.toLocaleString()}
              />
              <StatRow
                label="Veteran Crest"
                value={latest.currencies.veteranDawncrest.toLocaleString()}
              />
              <StatRow
                label="Champion Crest"
                value={latest.currencies.championDawncrest.toLocaleString()}
              />
              <StatRow
                label="Hero Crest"
                value={latest.currencies.heroDawncrest.toLocaleString()}
              />
              <StatRow
                label="Myth Crest"
                value={latest.currencies.mythDawncrest.toLocaleString()}
              />
              <div className="border-t border-border/50 my-2" />
              <StatRow
                label="Radiant Spark Dust"
                value={latest.currencies.radiantSparkDust.toLocaleString()}
              />
            </div>
          </TabsContent>
          <TabsContent value="chart">
            <SnapshotLineChart data={chartData} lines={chartLines} config={currenciesConfig} />
          </TabsContent>
        </CardContent>
      </Tabs>
      {fullscreen && (
        <FullscreenOverlay title="Currencies" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            data={chartData}
            lines={chartLines}
            config={currenciesConfig}
            className="h-full"
            showLegend
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

// ---- Playtime card ----

function PlaytimeCard({ snapshots }: { snapshots: Snapshot[] }) {
  const [mode, setMode] = useState<"current" | "chart">("current");
  const [fullscreen, setFullscreen] = useState(false);
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return null;

  const chartData = snapshots.map((s) => ({
    date: formatDateShort(s.takenAt),
    playtimeHours: Math.round(s.playtimeSeconds / 3600),
  }));

  const chartLines = [{ key: "playtimeHours", color: "var(--chart-5)" }];

  function formatHours(totalHours: number) {
    const d = Math.floor(totalHours / 24);
    const h = totalHours % 24;
    return d > 0 ? `${d}d ${h}h` : `${h}h`;
  }

  return (
    <Card>
      <Tabs
        value={mode}
        onValueChange={(v) => setMode((v ?? "current") as "current" | "chart")}
        className="gap-0"
      >
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Clock size={14} className="text-muted-foreground" />
              Time Played
            </CardTitle>
            <div className="flex items-center gap-1.5">
              {mode === "chart" && <FullscreenButton onClick={() => setFullscreen(true)} />}
              <TabsList>
                <TabsTrigger value="current">Current</TabsTrigger>
                <TabsTrigger value="chart">Chart</TabsTrigger>
              </TabsList>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          <TabsContent value="current">
            <div className="space-y-1.5">
              <StatRow label="Total" value={formatPlaytime(latest.playtimeSeconds)} />
              <StatRow
                label="Hours"
                value={`${Math.floor(latest.playtimeSeconds / 3600).toLocaleString()}h`}
              />
              <StatRow
                label="Days"
                value={`${Math.floor(latest.playtimeSeconds / 86400).toLocaleString()}d`}
              />
            </div>
          </TabsContent>
          <TabsContent value="chart">
            <SnapshotLineChart
              data={chartData}
              lines={chartLines}
              config={playtimeConfig}
              valueFormatter={(v) => formatHours(v)}
            />
          </TabsContent>
        </CardContent>
      </Tabs>
      {fullscreen && (
        <FullscreenOverlay title="Time Played" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            data={chartData}
            lines={chartLines}
            config={playtimeConfig}
            valueFormatter={(v) => formatHours(v)}
            className="h-full"
            showLegend
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

// ---- Role / Spec switcher ----

function RoleSpecFilter({
  snapshots,
  selectedRole,
  selectedSpec,
  onRoleChange,
  onSpecChange,
}: {
  snapshots: Snapshot[];
  selectedRole: string | null;
  selectedSpec: string | null;
  onRoleChange: (r: string | null) => void;
  onSpecChange: (s: string | null) => void;
}) {
  // Build role → specs map
  const roleMap = new Map<string, Set<string>>();
  for (const s of snapshots) {
    if (!roleMap.has(s.role)) roleMap.set(s.role, new Set());
    roleMap.get(s.role)!.add(s.spec);
  }

  const roles = [...roleMap.keys()];
  const totalUniqueSpecs = roles.reduce((n, r) => n + (roleMap.get(r)?.size ?? 0), 0);

  // Nothing to filter if only one role with one spec
  if (roles.length <= 1 && totalUniqueSpecs <= 1) return null;

  // Specs visible in the current role context
  const specsInContext: { spec: string; role: string }[] = selectedRole
    ? [...(roleMap.get(selectedRole) ?? [])].map((spec) => ({ spec, role: selectedRole }))
    : roles.flatMap((role) => [...(roleMap.get(role) ?? [])].map((spec) => ({ spec, role })));

  const showSpecRow =
    specsInContext.length > 1 || (selectedRole !== null && specsInContext.length === 1);

  return (
    <div className="space-y-2">
      {/* Row 1 — Roles */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-muted-foreground text-xs mr-1">Role</span>
        <Button
          size="sm"
          variant={selectedRole === null ? "default" : "outline"}
          onClick={() => {
            onRoleChange(null);
            onSpecChange(null);
          }}
        >
          All
        </Button>
        {roles.map((role) => (
          <Button
            key={role}
            size="sm"
            variant={selectedRole === role ? "default" : "outline"}
            onClick={() => {
              onRoleChange(role);
              onSpecChange(null);
            }}
          >
            {ROLE_LABELS[role] ?? role}
            {(roleMap.get(role)?.size ?? 0) > 1 && (
              <span className="ml-1 opacity-60">×{roleMap.get(role)!.size}</span>
            )}
          </Button>
        ))}
      </div>

      {/* Row 2 — Specs (always shown when there's something to pick) */}
      {showSpecRow && (
        <div className="flex flex-wrap gap-1.5 items-center pl-1 border-l-2 border-border/30 ml-1">
          <span className="text-muted-foreground text-xs mr-1">Spec</span>
          {selectedRole && (
            <Button
              size="sm"
              variant={selectedSpec === null ? "default" : "outline"}
              onClick={() => onSpecChange(null)}
            >
              All
            </Button>
          )}
          {specsInContext.map(({ spec, role }) => (
            <Button
              key={`${role}:${spec}`}
              size="sm"
              variant={selectedSpec === spec ? "default" : "outline"}
              onClick={() => {
                if (selectedRole === null) onRoleChange(role);
                onSpecChange(spec);
              }}
            >
              {spec}
              {/* Show role tag only when viewing all roles */}
              {selectedRole === null && (
                <span className="ml-1 opacity-50 font-normal">({ROLE_LABELS[role] ?? role})</span>
              )}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main component ----

function RouteComponent() {
  const { characterId } = Route.useParams();
  const data = useQuery(api.characters.getCharacterSnapshots, {
    characterId: characterId as Id<"characters">,
  });

  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedSpec, setSelectedSpec] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8 space-y-4">
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
        <div className="h-56 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <p className="text-muted-foreground text-sm">Character not found.</p>
      </div>
    );
  }

  const { character, snapshots } = data;

  // Filter snapshots by role → spec
  const filtered = snapshots.filter((s) => {
    if (selectedRole && s.role !== selectedRole) return false;
    if (selectedSpec && s.spec !== selectedSpec) return false;
    return true;
  });

  const latest = filtered[filtered.length - 1] ?? null;
  const chartSnapshots = groupSnapshotsAuto(filtered);

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8 space-y-4">
      {/* Character Header */}
      <Card>
        <CardHeader className="border-b pb-3">
          <div className="flex items-baseline justify-between">
            <CardTitle className={`text-2xl font-bold ${classColor(character.class)}`}>
              {character.name}
            </CardTitle>
            <Badge
              variant="outline"
              className={
                character.faction === "alliance"
                  ? "border-blue-500/40 text-blue-400 uppercase tracking-wider"
                  : "border-red-500/40 text-red-400 uppercase tracking-wider"
              }
            >
              {character.faction}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {character.race} {character.class} — {character.realm}-{character.region.toUpperCase()}
          </p>
        </CardHeader>

        {latest && (
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <StatGrid label="Level" value={latest.level} />
              <StatGrid label="Item Level" value={latest.itemLevel.toFixed(1)} />
              <StatGrid label="M+ Score" value={latest.mythicPlusScore.toLocaleString()} />
              <StatGrid label="Gold" value={<GoldDisplay value={latest.gold} />} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1">
              <StatRow label="Spec" value={`${latest.spec} (${latest.role})`} />
              <StatRow label="Playtime" value={formatPlaytime(latest.playtimeSeconds)} />
              <StatRow label="Snapshot" value={formatDate(latest.takenAt)} />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Role / Spec filter */}
      {snapshots.length > 0 && (
        <RoleSpecFilter
          snapshots={snapshots}
          selectedRole={selectedRole}
          selectedSpec={selectedSpec}
          onRoleChange={setSelectedRole}
          onSpecChange={setSelectedSpec}
        />
      )}

      {/* Main charts */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <IlvlChartCard snapshots={chartSnapshots} />
          <MplusChartCard snapshots={chartSnapshots} />
          <GoldChartCard snapshots={chartSnapshots} />
        </div>
      )}

      {/* Stats & Currencies with chart toggle */}
      {latest && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CombatStatsCard snapshots={chartSnapshots} />
          <CurrenciesCard snapshots={chartSnapshots} />
          <PlaytimeCard snapshots={chartSnapshots} />
        </div>
      )}

      {/* Snapshot History */}
      {filtered.length > 1 && (
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <History size={14} className="text-muted-foreground" />
              Snapshot History ({filtered.length})
              {(selectedRole ?? selectedSpec) && (
                <span className="text-muted-foreground font-normal ml-1">— filtered</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left text-muted-foreground font-medium py-2 pr-4">Date</th>
                  <th className="text-right text-muted-foreground font-medium py-2 px-2">iLvl</th>
                  <th className="text-right text-muted-foreground font-medium py-2 px-2">M+</th>
                  <th className="text-right text-muted-foreground font-medium py-2 px-2">Gold</th>
                  <th className="text-left text-muted-foreground font-medium py-2 pl-2">
                    Spec / Role
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...filtered].reverse().map((s, i) => (
                  <tr
                    key={i}
                    className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    <td className="py-2 pr-4 text-muted-foreground">{formatDate(s.takenAt)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{s.itemLevel.toFixed(1)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {s.mythicPlusScore.toLocaleString()}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <GoldDisplay value={s.gold} />
                    </td>
                    <td className="py-2 pl-2 text-muted-foreground">
                      {s.spec} <span className="opacity-60">({s.role})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
