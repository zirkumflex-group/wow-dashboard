import { createFileRoute } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import type { Id } from "@wow-dashboard/backend/convex/_generated/dataModel";
import { Badge } from "@wow-dashboard/ui/components/badge";
import { Button } from "@wow-dashboard/ui/components/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
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
import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts";

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

function TimeFramePicker({
  value,
  onChange,
}: {
  value: TimeFrame;
  onChange: (v: TimeFrame) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground text-xs mr-1">Range</span>
      {TIME_FRAME_OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          size="sm"
          variant={value === opt.value ? "default" : "outline"}
          className="h-7 px-2.5 text-xs"
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}

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

function xAxisTickFormatter(ts: number, frame: TimeFrame): string {
  const d = new Date(ts * 1000);
  if (frame === "12h" || frame === "24h") {
    return d.toLocaleTimeString(undefined, { hour: "numeric", hour12: true });
  }
  if (frame === "1d" || frame === "3d") {
    return (
      d.toLocaleDateString(undefined, { weekday: "short" }) +
      " " +
      d.toLocaleTimeString(undefined, { hour: "numeric", hour12: true })
    );
  }
  if (frame === "1w" || frame === "2w") {
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  return formatDateShort(ts);
}

function xTooltipLabelFormatter(ts: number, frame: TimeFrame): string {
  const d = new Date(ts * 1000);
  if (frame === "12h" || frame === "24h") {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  if (frame === "1d" || frame === "3d") {
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      hour12: true,
    });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Parse gold value stored as GGGGG.SSCC */
function parseGoldValue(value: number) {
  const totalCopper = Math.round(value * 10000);
  const gold = Math.floor(totalCopper / 10000);
  const silver = Math.floor((totalCopper % 10000) / 100);
  const copper = totalCopper % 100;
  return { gold, silver, copper };
}

function goldUnits(value: number) {
  return Math.floor(value);
}

// ---- Components ----

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
  role: string;
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
 *  Keeps the *last* snapshot in each period so values are always real readings. */
function groupSnapshotsAuto(snapshots: Snapshot[]): Snapshot[] {
  if (snapshots.length <= 30) return snapshots;

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
    const day = d.getDay();
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
  if (daily.length <= 30) return daily.length >= 2 ? daily : snapshots.slice(-30);

  const weekly = groupBy(snapshots, toWeek);
  if (weekly.length <= 30) return weekly.length >= 2 ? weekly : snapshots.slice(-30);

  const monthly = groupBy(snapshots, toMonth);
  return monthly.length >= 2 ? monthly : snapshots.slice(-30);
}

// ---- Chart configs ----

// Explicit oklch palette spread evenly across the hue wheel so every series
// is visually distinct regardless of active theme.
const C = {
  blue:   "oklch(0.72 0.20 245)",  // 245° – blue
  red:    "oklch(0.72 0.22 20)",   //  20° – red-orange
  gold:   "oklch(0.84 0.18 80)",   //  80° – amber/gold
  purple: "oklch(0.73 0.20 295)",  // 295° – violet
  teal:   "oklch(0.75 0.18 190)",  // 190° – teal/cyan
  green:  "oklch(0.76 0.18 155)",  // 155° – green
  pink:   "oklch(0.75 0.18 330)",  // 330° – pink/rose
} as const;

const ilvlConfig: ChartConfig = {
  itemLevel: { label: "Item Level", color: C.blue },
};
const mplusConfig: ChartConfig = {
  mythicPlusScore: { label: "M+ Score", color: C.red },
};
const goldConfig: ChartConfig = {
  gold: { label: "Gold", color: C.gold },
};
const playtimeConfig: ChartConfig = {
  playtimeHours: { label: "Playtime", color: C.purple },
};
const secondaryStatsConfig: ChartConfig = {
  critPercent:        { label: "Crit",        color: C.red    },
  hastePercent:       { label: "Haste",       color: C.green  },
  masteryPercent:     { label: "Mastery",     color: C.blue   },
  versatilityPercent: { label: "Versatility", color: C.purple },
};
const currenciesConfig: ChartConfig = {
  adventurerDawncrest: { label: "Adventurer", color: C.blue   },
  veteranDawncrest:    { label: "Veteran",    color: C.teal   },
  championDawncrest:   { label: "Champion",   color: C.green  },
  heroDawncrest:       { label: "Hero",       color: C.gold   },
  mythDawncrest:       { label: "Myth",       color: C.red    },
  radiantSparkDust:    { label: "Spark Dust", color: C.pink   },
};

// ---- Reusable line chart ----

function SnapshotLineChart({
  data,
  lines,
  config,
  valueFormatter,
  className,
  showLegend,
  yPadMaxFactor,
  yDomainOverride,
  xLabel,
  yLabel,
  timeFrame,
}: {
  /** data points — `date` must be a Unix timestamp (seconds) */
  data: Record<string, number>[];
  lines: { key: string; color: string }[];
  config: ChartConfig;
  valueFormatter?: (v: number) => string;
  className?: string;
  showLegend?: boolean;
  yPadMaxFactor?: number;
  yDomainOverride?: [number, number];
  xLabel?: string;
  yLabel?: string;
  timeFrame?: TimeFrame;
}) {
  if (data.length < 2) {
    return (
      <p className="text-muted-foreground text-sm py-6 text-center">Not enough data points yet.</p>
    );
  }

  // Hide dots when there are too many points (>15) to avoid clutter
  const hideDots = data.length > 15;

  // Show at most ~10 ticks on X axis
  const xAxisInterval = data.length > 10 ? Math.ceil(data.length / 10) - 1 : 0;

  // Compute Y-axis domain from actual data so the chart isn't squashed
  const allValues = data
    .flatMap((d) => lines.map((l) => d[l.key]))
    .filter((v) => typeof v === "number" && !isNaN(v));
  const minVal = allValues.length ? Math.min(...allValues) : 0;
  const maxVal = allValues.length ? Math.max(...allValues) : 0;
  const range = maxVal - minVal;
  const pad =
    yPadMaxFactor != null
      ? Math.abs(maxVal) * yPadMaxFactor || 1
      : range > 0
        ? range * 0.1
        : Math.abs(maxVal) * 0.05 || 1;
  const yDomain: [number, number] = yDomainOverride ?? [Math.floor(minVal - pad), Math.ceil(maxVal + pad)];

  return (
    <ChartContainer config={config} className={`w-full ${className ?? "h-[200px]"}`}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: yLabel ? 8 : 4, bottom: xLabel ? 24 : 8 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tick={{ fontSize: 10 }}
          interval={xAxisInterval}
          tickFormatter={(ts: number) => xAxisTickFormatter(ts, timeFrame ?? "all")}
          label={xLabel ? { value: xLabel, position: "insideBottom", offset: -12, fontSize: 10, fill: "var(--muted-foreground)" } : undefined}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tick={{ fontSize: 10 }}
          tickFormatter={valueFormatter}
          width={yLabel ? 64 : 52}
          domain={yDomain}
          allowDataOverflow={!!yDomainOverride}
          label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", offset: 12, fontSize: 10, fill: "var(--muted-foreground)" } : undefined}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => xTooltipLabelFormatter(value as number, timeFrame ?? "all")}
              indicator="dot"
            />
          }
        />
        {showLegend && <ChartLegend content={<ChartLegendContent />} />}
        {lines.map(({ key, color }) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={color}
            strokeWidth={2}
            dot={hideDots ? false : { r: 3, fill: color, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

// ---- Inline chart cards ----

function IlvlChartCard({ snapshots, timeFrame }: { snapshots: Snapshot[]; timeFrame: TimeFrame }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const data = snapshots.map((s) => ({ date: s.takenAt, itemLevel: s.itemLevel }));
  const lines = [{ key: "itemLevel", color: C.blue }];
  const yDomain: [number, number] = zoomed ? [200, 300] : [0, 300];
  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Sword size={14} className="text-muted-foreground" />
            Item Level
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border text-xs overflow-hidden">
              <button
                className={`px-2 py-0.5 transition-colors ${!zoomed ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setZoomed(false)}
              >
                0–300
              </button>
              <button
                className={`px-2 py-0.5 transition-colors ${zoomed ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setZoomed(true)}
              >
                200–300
              </button>
            </div>
            <FullscreenButton onClick={() => setFullscreen(true)} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <SnapshotLineChart
          key={yDomain.join(",")}
          data={data}
          lines={lines}
          config={ilvlConfig}
          valueFormatter={(v) => v.toFixed(1)}
          yDomainOverride={yDomain}
          xLabel="Date"
          yLabel="Item Level"
          timeFrame={timeFrame}
        />
      </CardContent>
      {fullscreen && (
        <FullscreenOverlay title="Item Level" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            key={yDomain.join(",")}
            data={data}
            lines={lines}
            config={ilvlConfig}
            valueFormatter={(v) => v.toFixed(1)}
            className="h-full"
            showLegend
            yDomainOverride={yDomain}
            xLabel="Date"
            yLabel="Item Level"
            timeFrame={timeFrame}
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

function MplusChartCard({ snapshots, timeFrame }: { snapshots: Snapshot[]; timeFrame: TimeFrame }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const data = snapshots.map((s) => ({ date: s.takenAt, mythicPlusScore: s.mythicPlusScore }));
  const lines = [{ key: "mythicPlusScore", color: C.red }];
  const yDomain: [number, number] = zoomed ? [2000, 4500] : [0, 4500];
  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Flame size={14} className="text-muted-foreground" />
            M+ Score
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border text-xs overflow-hidden">
              <button
                className={`px-2 py-0.5 transition-colors ${!zoomed ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setZoomed(false)}
              >
                0–4500
              </button>
              <button
                className={`px-2 py-0.5 transition-colors ${zoomed ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setZoomed(true)}
              >
                2000–4500
              </button>
            </div>
            <FullscreenButton onClick={() => setFullscreen(true)} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <SnapshotLineChart
          key={yDomain.join(",")}
          data={data}
          lines={lines}
          config={mplusConfig}
          valueFormatter={(v) => v.toLocaleString()}
          yDomainOverride={yDomain}
          xLabel="Date"
          yLabel="M+ Score"
          timeFrame={timeFrame}
        />
      </CardContent>
      {fullscreen && (
        <FullscreenOverlay title="M+ Score" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            key={yDomain.join(",")}
            data={data}
            lines={lines}
            config={mplusConfig}
            valueFormatter={(v) => v.toLocaleString()}
            className="h-full"
            showLegend
            yDomainOverride={yDomain}
            xLabel="Date"
            yLabel="M+ Score"
            timeFrame={timeFrame}
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

function GoldChartCard({ snapshots, timeFrame }: { snapshots: Snapshot[]; timeFrame: TimeFrame }) {
  const [fullscreen, setFullscreen] = useState(false);
  const data = snapshots.map((s) => ({ date: s.takenAt, gold: s.gold }));
  const lines = [{ key: "gold", color: C.gold }];
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
          yDomainOverride={[0, 1000000]}
          xLabel="Date"
          yLabel="Gold"
          timeFrame={timeFrame}
        />
      </CardContent>
      {fullscreen && (
        <FullscreenOverlay title="Gold" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            data={data}
            lines={lines}
            config={goldConfig}
            valueFormatter={(v) => `${goldUnits(v).toLocaleString()}g`}
            yDomainOverride={[0, 1000000]}
            className="h-full"
            showLegend
            xLabel="Date"
            yLabel="Gold"
            timeFrame={timeFrame}
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

// ---- Combat Stats card ----

const radarConfig: ChartConfig = {
  value: { label: "Value", color: C.blue },
};

function CombatStatsCard({ snapshots, timeFrame }: { snapshots: Snapshot[]; timeFrame: TimeFrame }) {
  const [mode, setMode] = useState<"current" | "chart" | "radar">("current");
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
    date: s.takenAt,
    critPercent: s.stats.critPercent,
    hastePercent: s.stats.hastePercent,
    masteryPercent: s.stats.masteryPercent,
    versatilityPercent: s.stats.versatilityPercent,
  }));

  const radarData = [
    { stat: "Crit", value: latest.stats.critPercent },
    { stat: "Haste", value: latest.stats.hastePercent },
    { stat: "Mastery", value: latest.stats.masteryPercent },
    { stat: "Versatility", value: latest.stats.versatilityPercent },
  ];

  const chartLines = [
    { key: "critPercent",        color: C.red    },
    { key: "hastePercent",       color: C.green  },
    { key: "masteryPercent",     color: C.blue   },
    { key: "versatilityPercent", color: C.purple },
  ];

  return (
    <Card>
      <Tabs
        value={mode}
        onValueChange={(v) => setMode((v ?? "current") as typeof mode)}
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
                <TabsTrigger value="radar">Radar</TabsTrigger>
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
              showLegend
              timeFrame={timeFrame}
            />
          </TabsContent>
          <TabsContent value="radar">
            <ChartContainer config={radarConfig} className="w-full h-[200px]">
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="stat" tick={{ fontSize: 11 }} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                <Radar
                  dataKey="value"
                  fill={C.blue}
                  fillOpacity={0.25}
                  stroke={C.blue}
                  strokeWidth={2}
                  dot={{ r: 3, fill: C.blue, strokeWidth: 0 }}
                />
              </RadarChart>
            </ChartContainer>
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
            timeFrame={timeFrame}
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

// ---- Currencies card ----

function CurrenciesCard({ snapshots, timeFrame }: { snapshots: Snapshot[]; timeFrame: TimeFrame }) {
  const [mode, setMode] = useState<"current" | "chart">("current");
  const [fullscreen, setFullscreen] = useState(false);
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return null;

  const chartData = snapshots.map((s) => ({
    date: s.takenAt,
    adventurerDawncrest: s.currencies.adventurerDawncrest,
    veteranDawncrest: s.currencies.veteranDawncrest,
    championDawncrest: s.currencies.championDawncrest,
    heroDawncrest: s.currencies.heroDawncrest,
    mythDawncrest: s.currencies.mythDawncrest,
    radiantSparkDust: s.currencies.radiantSparkDust,
  }));

  const chartLines = [
    { key: "adventurerDawncrest", color: C.blue   },
    { key: "veteranDawncrest",    color: C.teal   },
    { key: "championDawncrest",   color: C.green  },
    { key: "heroDawncrest",       color: C.gold   },
    { key: "mythDawncrest",       color: C.red    },
    { key: "radiantSparkDust",    color: C.pink   },
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
            <SnapshotLineChart
              data={chartData}
              lines={chartLines}
              config={currenciesConfig}
              showLegend
              timeFrame={timeFrame}
            />
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
            timeFrame={timeFrame}
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

// ---- Playtime card ----

function formatHours(totalHours: number) {
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function PlaytimeCard({ snapshots, timeFrame }: { snapshots: Snapshot[]; timeFrame: TimeFrame }) {
  const [mode, setMode] = useState<"current" | "chart">("current");
  const [fullscreen, setFullscreen] = useState(false);
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return null;

  const chartData = snapshots.map((s) => ({
    date: s.takenAt,
    playtimeHours: Math.round(s.playtimeSeconds / 3600),
  }));

  const chartLines = [{ key: "playtimeHours", color: C.purple }];

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
              yDomainOverride={[0, 4800]}
              timeFrame={timeFrame}
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
            yDomainOverride={[0, 4800]}
            className="h-full"
            showLegend
            timeFrame={timeFrame}
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
  const roleMap = new Map<string, Set<string>>();
  for (const s of snapshots) {
    if (!roleMap.has(s.role)) roleMap.set(s.role, new Set());
    roleMap.get(s.role)!.add(s.spec);
  }

  const roles = [...roleMap.keys()];
  const totalUniqueSpecs = roles.reduce((n, r) => n + (roleMap.get(r)?.size ?? 0), 0);

  if (roles.length <= 1 && totalUniqueSpecs <= 1) return null;

  const specsInContext: { spec: string; role: string }[] = selectedRole
    ? [...(roleMap.get(selectedRole) ?? [])].map((spec) => ({ spec, role: selectedRole }))
    : roles.flatMap((role) => [...(roleMap.get(role) ?? [])].map((spec) => ({ spec, role })));

  const showSpecRow =
    specsInContext.length > 1 || (selectedRole !== null && specsInContext.length === 1);

  return (
    <div className="space-y-2">
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
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("1w");
  const [visibleSnapshots, setVisibleSnapshots] = useState(5);

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

  // Separate valid snapshots from unknown/invalid ones
  const validSnapshots = snapshots.filter((s) => s.spec !== "Unknown" && s.role !== "Unknown");
  const unknownSnapshots = snapshots.filter((s) => s.spec === "Unknown" || s.role === "Unknown");

  // Filter by role/spec
  const filtered = validSnapshots.filter((s) => {
    if (selectedRole && s.role !== selectedRole) return false;
    if (selectedSpec && s.spec !== selectedSpec) return false;
    return true;
  });

  const latest = filtered[filtered.length - 1] ?? null;

  // Apply time frame filter then grouping for charts
  const timeFrameFiltered = filterByTimeFrame(filtered, timeFrame);
  const chartSnapshots = groupSnapshotsAuto(timeFrameFiltered);

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
      {validSnapshots.length > 0 && (
        <RoleSpecFilter
          snapshots={validSnapshots}
          selectedRole={selectedRole}
          selectedSpec={selectedSpec}
          onRoleChange={setSelectedRole}
          onSpecChange={setSelectedSpec}
        />
      )}

      {/* Time frame + chart count info */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TimeFramePicker value={timeFrame} onChange={setTimeFrame} />
          <span className="text-muted-foreground text-xs">
            {chartSnapshots.length} data point{chartSnapshots.length !== 1 ? "s" : ""}
            {timeFrameFiltered.length !== chartSnapshots.length &&
              ` (grouped from ${timeFrameFiltered.length})`}
          </span>
        </div>
      )}

      {/* Main charts */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <IlvlChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
          <MplusChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
          <GoldChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
        </div>
      )}

      {/* Stats & Currencies with chart toggle */}
      {latest && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CombatStatsCard snapshots={chartSnapshots} timeFrame={timeFrame} />
          <CurrenciesCard snapshots={chartSnapshots} timeFrame={timeFrame} />
          <PlaytimeCard snapshots={chartSnapshots} timeFrame={timeFrame} />
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
          <CardContent className="pt-0 overflow-x-auto max-h-[360px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
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
                {[...filtered].reverse().slice(0, visibleSnapshots).map((s, i) => (
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
          {visibleSnapshots < filtered.length && (
            <CardFooter className="border-t pt-3 pb-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => setVisibleSnapshots((v) => v + 5)}
              >
                Load more ({filtered.length - visibleSnapshots} remaining)
              </Button>
            </CardFooter>
          )}
        </Card>
      )}

      {/* Unknown / Invalid Snapshots */}
      {unknownSnapshots.length > 0 && (
        <Card className="border-dashed border-yellow-500/30">
          <CardHeader className="border-b border-yellow-500/20 pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5 text-yellow-500/80">
              <History size={14} />
              Unknown / Invalid Snapshots ({unknownSnapshots.length})
            </CardTitle>
            <p className="text-muted-foreground text-xs mt-1">
              These snapshots have an unknown spec or role and are excluded from charts and filters.
            </p>
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
                {[...unknownSnapshots].reverse().map((s, i) => (
                  <tr
                    key={i}
                    className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors opacity-70"
                  >
                    <td className="py-2 pr-4 text-muted-foreground">{formatDate(s.takenAt)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{s.itemLevel.toFixed(1)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {s.mythicPlusScore.toLocaleString()}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <GoldDisplay value={s.gold} />
                    </td>
                    <td className="py-2 pl-2 text-yellow-500/70">
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
