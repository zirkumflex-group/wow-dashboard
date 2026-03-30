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
import { useQuery } from "convex/react";
import {
  Clock,
  Coins,
  Columns,
  ExternalLink,
  Flame,
  Gem,
  History,
  LayoutGrid,
  LayoutList,
  Maximize2,
  Sword,
  X,
  Zap,
} from "lucide-react";
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

// ── Constants ────────────────────────────────────────────────────────────────

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

const ROLE_LABELS: Record<string, string> = { tank: "Tank", healer: "Healer", dps: "DPS" };

// ── Time frame ───────────────────────────────────────────────────────────────

type TimeFrame = "7d" | "30d" | "90d" | "all";

const TIME_FRAME_OPTIONS: { value: TimeFrame; label: string }[] = [
  { value: "7d",  label: "7D"  },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

function filterByTimeFrame<T extends { takenAt: number }>(items: T[], frame: TimeFrame): T[] {
  if (frame === "all") return items;
  const days = ({ "7d": 7, "30d": 30, "90d": 90 } as Record<TimeFrame, number>)[frame];
  const cutoff = Date.now() / 1000 - days * 86400;
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
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">Range</span>
      <div className="flex rounded-md border overflow-hidden">
        {TIME_FRAME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1 text-xs transition-colors ${
              value === opt.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Layout mode ───────────────────────────────────────────────────────────────

type LayoutMode = "overview" | "focus" | "timeline";

function LayoutSwitcher({
  value,
  onChange,
}: {
  value: LayoutMode;
  onChange: (m: LayoutMode) => void;
}) {
  const opts = [
    { mode: "overview" as const, Icon: LayoutGrid,  title: "Overview — radar sidebar + chart grid" },
    { mode: "focus"    as const, Icon: Columns,     title: "Focus — single metric deep-dive"       },
    { mode: "timeline" as const, Icon: LayoutList,  title: "Timeline — stacked charts + full history" },
  ] as const;
  return (
    <div className="flex items-center gap-0.5 rounded-md border p-0.5">
      {opts.map(({ mode, Icon, title }) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          title={title}
          aria-label={title}
          className={`p-1.5 rounded transition-colors ${
            value === mode
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────

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

type ChartTooltipPayloadItem = {
  payload?: {
    date?: unknown;
  };
} | null | undefined;

function normalizeTimestampSeconds(value: unknown): number | null {
  if (value instanceof Date) {
    const timestampMs = value.getTime();
    return Number.isFinite(timestampMs) && timestampMs > 0 ? Math.floor(timestampMs / 1000) : null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value >= 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const numericValue = Number(trimmed);
    return Number.isFinite(numericValue) ? normalizeTimestampSeconds(numericValue) : null;
  }

  return null;
}

function xAxisTickFormatter(ts: unknown, frame: TimeFrame): string {
  const parsedTs = normalizeTimestampSeconds(ts);
  if (parsedTs === null) return "—";

  const d = new Date(parsedTs * 1000);
  if (Number.isNaN(d.getTime())) return "—";

  if (frame === "7d") {
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function xTooltipLabelFormatter(
  value: unknown,
  frame: TimeFrame,
  payload?: ReadonlyArray<ChartTooltipPayloadItem>,
): string {
  const parsedTs =
    normalizeTimestampSeconds(value) ?? normalizeTimestampSeconds(payload?.[0]?.payload?.date);
  if (parsedTs === null) return "Unknown date";

  const d = new Date(parsedTs * 1000);
  if (Number.isNaN(d.getTime())) return "Unknown date";

  if (frame === "7d") {
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

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

function formatHours(totalHours: number) {
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function formatRunDate(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatRunDuration(durationMs?: number | null) {
  if (!durationMs || durationMs <= 0) return "—";
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatKeyLevel(level?: number | null) {
  if (level === undefined || level === null) return "—";
  return `+${level}`;
}

function formatAverageValue(value?: number | null, digits = 1) {
  if (value === undefined || value === null) return "—";
  return value.toFixed(digits);
}

function formatSeasonLabel(seasonID: number | null) {
  if (seasonID === null) return null;
  if (seasonID === 17) return "Midnight Season 1";
  return `Season ${seasonID}`;
}

function getRunLabel(run: MythicPlusRun) {
  if (run.mapName && run.mapName.trim() !== "") return run.mapName;
  if (run.mapChallengeModeID !== undefined) return `Dungeon ${run.mapChallengeModeID}`;
  return "Unknown Dungeon";
}

function isCompletedMythicPlusRun(run: MythicPlusRun) {
  return run.completed === true || run.durationMs !== undefined || run.runScore !== undefined || run.completedAt !== undefined;
}

function isTimedMythicPlusRun(run: MythicPlusRun) {
  if (run.completedInTime !== undefined) return run.completedInTime;
  return run.completed === true;
}

// ── Shared display components ─────────────────────────────────────────────────

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

function MythicPlusResultBadge({ run }: { run: MythicPlusRun }) {
  if (isTimedMythicPlusRun(run)) {
    return <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Timed</Badge>;
  }
  if (isCompletedMythicPlusRun(run)) {
    return <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30">Completed</Badge>;
  }
  return <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30">Failed</Badge>;
}

function MythicPlusSection({ data }: { data: MythicPlusData | null | undefined }) {
  if (data === undefined) {
    return <div className="h-72 animate-pulse rounded-lg bg-muted" />;
  }

  if (!data || data.runs.length === 0) {
    return (
      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <History size={16} className="text-muted-foreground" />
            Mythic+ History
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            No Mythic+ run history uploaded for this character yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { summary, runs } = data;
  const currentSeason = summary.currentSeason;
  const recentRuns = runs.slice(0, 12);

  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <Card>
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <History size={16} className="text-muted-foreground" />
              Mythic+ Summary
            </CardTitle>
            {formatSeasonLabel(summary.latestSeasonID) && (
              <Badge variant="outline">{formatSeasonLabel(summary.latestSeasonID)}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {currentSeason && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Flame size={14} className="text-muted-foreground" />
                <h3 className="text-sm font-semibold">Current Season</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatGrid label="Runs" value={currentSeason.totalRuns.toLocaleString()} />
                <StatGrid label="Timed" value={currentSeason.timedRuns.toLocaleString()} />
                <StatGrid label="Best Timed" value={formatKeyLevel(currentSeason.bestTimedLevel)} />
                <StatGrid label="Current Score" value={formatAverageValue(summary.currentScore, 0)} />
                <StatGrid label="5+ Timed" value={currentSeason.timed5To9.toLocaleString()} />
                <StatGrid label="10+ Timed" value={currentSeason.timed10To11.toLocaleString()} />
                <StatGrid label="12+ Timed" value={currentSeason.timed12To13.toLocaleString()} />
                <StatGrid label="14+ Timed" value={currentSeason.timed14Plus.toLocaleString()} />
              </div>
            </div>
          )}

          {summary.currentSeasonDungeons.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Sword size={14} className="text-muted-foreground" />
                <h3 className="text-sm font-semibold">Dungeon Bests</h3>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Dungeon</th>
                      <th className="px-3 py-2 text-right font-medium">Timed</th>
                      <th className="px-3 py-2 text-right font-medium">Best Timed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.currentSeasonDungeons.map((dungeon) => (
                      <tr key={`${dungeon.mapChallengeModeID ?? "map"}-${dungeon.mapName}`} className="border-t">
                        <td className="px-3 py-2">{dungeon.mapName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{dungeon.timedRuns}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatKeyLevel(dungeon.bestTimedLevel)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock size={16} className="text-muted-foreground" />
            Recent Runs
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Dungeon</th>
                  <th className="px-3 py-2 text-right font-medium">Key</th>
                  <th className="px-3 py-2 text-left font-medium">Result</th>
                  <th className="px-3 py-2 text-right font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.fingerprint} className="border-t">
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatRunDate(run.completedAt ?? run.observedAt)}
                    </td>
                    <td className="px-3 py-2">{getRunLabel(run)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatKeyLevel(run.level)}</td>
                    <td className="px-3 py-2">
                      <MythicPlusResultBadge run={run} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatAverageValue(run.runScore, 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatRunDuration(run.durationMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Fullscreen ────────────────────────────────────────────────────────────────

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
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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

// ── Types ─────────────────────────────────────────────────────────────────────

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

type LayoutProps = {
  latest: Snapshot;
  chartSnapshots: Snapshot[];
  filteredSnapshots: Snapshot[];
  timeFrame: TimeFrame;
  setTimeFrame: (f: TimeFrame) => void;
};

type MythicPlusRun = {
  fingerprint: string;
  observedAt: number;
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

type MythicPlusBucketSummary = {
  totalRuns: number;
  completedRuns: number;
  timedRuns: number;
  timed5To9: number;
  timed10To11: number;
  timed12To13: number;
  timed14Plus: number;
  bestLevel: number | null;
  bestTimedLevel: number | null;
  bestScore: number | null;
  averageLevel: number | null;
  averageScore: number | null;
  lastRunAt: number | null;
};

type MythicPlusDungeonSummary = {
  mapChallengeModeID: number | null;
  mapName: string;
  totalRuns: number;
  timedRuns: number;
  bestLevel: number | null;
  bestTimedLevel: number | null;
  bestScore: number | null;
  lastRunAt: number | null;
};

type MythicPlusSummary = {
  latestSeasonID: number | null;
  currentScore: number | null;
  overall: MythicPlusBucketSummary;
  currentSeason: MythicPlusBucketSummary | null;
  currentSeasonDungeons: MythicPlusDungeonSummary[];
};

type MythicPlusData = {
  runs: MythicPlusRun[];
  summary: MythicPlusSummary;
};

// ── Snapshot grouping ─────────────────────────────────────────────────────────

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
    const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
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

// ── Chart palette ─────────────────────────────────────────────────────────────

const C = {
  blue:   "oklch(0.72 0.20 245)",
  red:    "oklch(0.72 0.22 20)",
  gold:   "oklch(0.84 0.18 80)",
  purple: "oklch(0.73 0.20 295)",
  teal:   "oklch(0.75 0.18 190)",
  green:  "oklch(0.76 0.18 155)",
  pink:   "oklch(0.75 0.18 330)",
} as const;

const ilvlConfig: ChartConfig          = { itemLevel:           { label: "Item Level", color: C.blue   } };
const mplusConfig: ChartConfig         = { mythicPlusScore:     { label: "M+ Score",   color: C.red    } };
const goldConfig: ChartConfig          = { gold:                { label: "Gold",        color: C.gold   } };
const playtimeConfig: ChartConfig      = { playtimeHours:       { label: "Playtime",   color: C.purple } };
const radarConfig: ChartConfig         = { value:               { label: "Value",      color: C.blue   } };
const secondaryStatsConfig: ChartConfig = {
  critPercent:        { label: "Crit",        color: C.red    },
  hastePercent:       { label: "Haste",       color: C.green  },
  masteryPercent:     { label: "Mastery",     color: C.blue   },
  versatilityPercent: { label: "Versatility", color: C.purple },
};
const currenciesConfig: ChartConfig = {
  adventurerDawncrest: { label: "Adventurer", color: C.blue  },
  veteranDawncrest:    { label: "Veteran",    color: C.teal  },
  championDawncrest:   { label: "Champion",   color: C.green },
  heroDawncrest:       { label: "Hero",       color: C.gold  },
  mythDawncrest:       { label: "Myth",       color: C.red   },
};

// ── Reusable line chart ───────────────────────────────────────────────────────

function SnapshotLineChart({
  data,
  lines,
  config,
  valueFormatter,
  className,
  showLegend,
  yDomainOverride,
  yPadMaxFactor,
  timeFrame,
}: {
  data: Record<string, number>[];
  lines: { key: string; color: string }[];
  config: ChartConfig;
  valueFormatter?: (v: number) => string;
  className?: string;
  showLegend?: boolean;
  yDomainOverride?: [number, number];
  yPadMaxFactor?: number;
  timeFrame?: TimeFrame;
}) {
  if (data.length < 2) {
    return (
      <p className="text-muted-foreground text-sm py-6 text-center">Not enough data points yet.</p>
    );
  }

  const hideDots = data.length > 15;
  const xAxisInterval = data.length > 10 ? Math.ceil(data.length / 10) - 1 : 0;

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
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tick={{ fontSize: 10 }}
          interval={xAxisInterval}
          tickFormatter={(ts: number) => xAxisTickFormatter(ts, timeFrame ?? "all")}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tick={{ fontSize: 10 }}
          tickFormatter={valueFormatter}
          width={52}
          domain={yDomain}
          allowDataOverflow={!!yDomainOverride}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value, payload) =>
                xTooltipLabelFormatter(
                  value,
                  timeFrame ?? "all",
                  payload as ReadonlyArray<ChartTooltipPayloadItem>,
                )
              }
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

// ── Radar panel (always-visible, reused across layouts) ───────────────────────

function RadarPanel({ snapshot }: { snapshot: Snapshot }) {
  const radarData = [
    { stat: "Crit",        value: snapshot.stats.critPercent        },
    { stat: "Haste",       value: snapshot.stats.hastePercent       },
    { stat: "Mastery",     value: snapshot.stats.masteryPercent     },
    { stat: "Versatility", value: snapshot.stats.versatilityPercent },
  ];
  const primaryStat =
    snapshot.stats.strength > 0  ? { label: "Strength",  value: snapshot.stats.strength  } :
    snapshot.stats.agility > 0   ? { label: "Agility",   value: snapshot.stats.agility   } :
    snapshot.stats.intellect > 0 ? { label: "Intellect", value: snapshot.stats.intellect } :
    null;

  return (
    <div className="space-y-3">
      <ChartContainer config={radarConfig} className="w-full h-[180px]">
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
      <div className="space-y-1.5 text-sm">
        <StatRow label="Stamina" value={snapshot.stats.stamina.toLocaleString()} />
        {primaryStat && <StatRow label={primaryStat.label} value={primaryStat.value.toLocaleString()} />}
        <div className="border-t border-border/50 my-1" />
        <StatRow label="Crit"        value={`${snapshot.stats.critPercent.toFixed(2)}%`}        />
        <StatRow label="Haste"       value={`${snapshot.stats.hastePercent.toFixed(2)}%`}       />
        <StatRow label="Mastery"     value={`${snapshot.stats.masteryPercent.toFixed(2)}%`}     />
        <StatRow label="Versatility" value={`${snapshot.stats.versatilityPercent.toFixed(2)}%`} />
      </div>
    </div>
  );
}

// Compact horizontal radar for Timeline layout
function RadarStrip({ snapshot }: { snapshot: Snapshot }) {
  const radarData = [
    { stat: "Crit",        value: snapshot.stats.critPercent        },
    { stat: "Haste",       value: snapshot.stats.hastePercent       },
    { stat: "Mastery",     value: snapshot.stats.masteryPercent     },
    { stat: "Versatility", value: snapshot.stats.versatilityPercent },
  ];
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-6">
          <div className="shrink-0">
            <ChartContainer config={radarConfig} className="w-[130px] h-[130px]">
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="stat" tick={{ fontSize: 10 }} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                <Radar
                  dataKey="value"
                  fill={C.blue}
                  fillOpacity={0.25}
                  stroke={C.blue}
                  strokeWidth={2}
                  dot={{ r: 2, fill: C.blue, strokeWidth: 0 }}
                />
              </RadarChart>
            </ChartContainer>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 flex-1 text-sm">
            <StatRow label="Crit"        value={`${snapshot.stats.critPercent.toFixed(2)}%`}        />
            <StatRow label="Haste"       value={`${snapshot.stats.hastePercent.toFixed(2)}%`}       />
            <StatRow label="Mastery"     value={`${snapshot.stats.masteryPercent.toFixed(2)}%`}     />
            <StatRow label="Versatility" value={`${snapshot.stats.versatilityPercent.toFixed(2)}%`} />
            <StatRow label="Stamina"     value={snapshot.stats.stamina.toLocaleString()}             />
            {snapshot.stats.strength > 0  && <StatRow label="Strength"  value={snapshot.stats.strength.toLocaleString()}  />}
            {snapshot.stats.agility > 0   && <StatRow label="Agility"   value={snapshot.stats.agility.toLocaleString()}   />}
            {snapshot.stats.intellect > 0 && <StatRow label="Intellect" value={snapshot.stats.intellect.toLocaleString()} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Chart cards used in Overview ──────────────────────────────────────────────

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
            <Sword size={14} className="text-muted-foreground" /> Item Level
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border text-xs overflow-hidden">
              <button
                className={`px-2 py-0.5 transition-colors ${!zoomed ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setZoomed(false)}
              >0–300</button>
              <button
                className={`px-2 py-0.5 transition-colors ${zoomed ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setZoomed(true)}
              >200–300</button>
            </div>
            <FullscreenButton onClick={() => setFullscreen(true)} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <SnapshotLineChart
          key={yDomain.join(",")}
          data={data} lines={lines} config={ilvlConfig}
          valueFormatter={(v) => v.toFixed(1)}
          yDomainOverride={yDomain}
          timeFrame={timeFrame}
        />
      </CardContent>
      {fullscreen && (
        <FullscreenOverlay title="Item Level" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            key={yDomain.join(",")}
            data={data} lines={lines} config={ilvlConfig}
            valueFormatter={(v) => v.toFixed(1)}
            className="h-full" showLegend yDomainOverride={yDomain} timeFrame={timeFrame}
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
            <Flame size={14} className="text-muted-foreground" /> M+ Score
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border text-xs overflow-hidden">
              <button
                className={`px-2 py-0.5 transition-colors ${!zoomed ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setZoomed(false)}
              >0–4500</button>
              <button
                className={`px-2 py-0.5 transition-colors ${zoomed ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setZoomed(true)}
              >2k–4.5k</button>
            </div>
            <FullscreenButton onClick={() => setFullscreen(true)} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <SnapshotLineChart
          key={yDomain.join(",")}
          data={data} lines={lines} config={mplusConfig}
          valueFormatter={(v) => v.toLocaleString()}
          yDomainOverride={yDomain}
          timeFrame={timeFrame}
        />
      </CardContent>
      {fullscreen && (
        <FullscreenOverlay title="M+ Score" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            key={yDomain.join(",")}
            data={data} lines={lines} config={mplusConfig}
            valueFormatter={(v) => v.toLocaleString()}
            className="h-full" showLegend yDomainOverride={yDomain} timeFrame={timeFrame}
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
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Coins size={14} className="text-muted-foreground" /> Gold
          </CardTitle>
          <FullscreenButton onClick={() => setFullscreen(true)} />
        </div>
      </CardHeader>
      <CardContent>
        <SnapshotLineChart
          data={data} lines={lines} config={goldConfig}
          valueFormatter={(v) => `${goldUnits(v).toLocaleString()}g`}
          timeFrame={timeFrame}
        />
      </CardContent>
      {fullscreen && (
        <FullscreenOverlay title="Gold" onClose={() => setFullscreen(false)}>
          <SnapshotLineChart
            data={data} lines={lines} config={goldConfig}
            valueFormatter={(v) => `${goldUnits(v).toLocaleString()}g`}
            className="h-full" showLegend timeFrame={timeFrame}
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}

// ── Simple chart-only cards (no tabs, used in Overview sidebar area + Timeline) ──

function SecondaryStatsChartCard({
  snapshots,
  timeFrame,
  className,
}: {
  snapshots: Snapshot[];
  timeFrame: TimeFrame;
  className?: string;
}) {
  const data = snapshots.map((s) => ({
    date: s.takenAt,
    critPercent:        s.stats.critPercent,
    hastePercent:       s.stats.hastePercent,
    masteryPercent:     s.stats.masteryPercent,
    versatilityPercent: s.stats.versatilityPercent,
  }));
  const lines = [
    { key: "critPercent",        color: C.red    },
    { key: "hastePercent",       color: C.green  },
    { key: "masteryPercent",     color: C.blue   },
    { key: "versatilityPercent", color: C.purple },
  ];
  return (
    <Card className={className}>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <Zap size={14} className="text-muted-foreground" /> Secondary Stats
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SnapshotLineChart
          data={data} lines={lines} config={secondaryStatsConfig}
          valueFormatter={(v) => `${v.toFixed(1)}%`}
          showLegend timeFrame={timeFrame}
        />
      </CardContent>
    </Card>
  );
}

function CurrenciesChartCard({
  snapshots,
  timeFrame,
  className,
}: {
  snapshots: Snapshot[];
  timeFrame: TimeFrame;
  className?: string;
}) {
  const data = snapshots.map((s) => ({ date: s.takenAt, ...s.currencies }));
  const lines = [
    { key: "adventurerDawncrest", color: C.blue  },
    { key: "veteranDawncrest",    color: C.teal  },
    { key: "championDawncrest",   color: C.green },
    { key: "heroDawncrest",       color: C.gold  },
    { key: "mythDawncrest",       color: C.red   },
  ];
  return (
    <Card className={className}>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <Gem size={14} className="text-muted-foreground" /> Currencies
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SnapshotLineChart
          data={data} lines={lines} config={currenciesConfig}
          showLegend timeFrame={timeFrame}
        />
      </CardContent>
    </Card>
  );
}

function PlaytimeChartCard({
  snapshots,
  timeFrame,
  className,
}: {
  snapshots: Snapshot[];
  timeFrame: TimeFrame;
  className?: string;
}) {
  const data = snapshots.map((s) => ({
    date: s.takenAt,
    playtimeHours: Math.round(s.playtimeSeconds / 3600),
  }));
  const lines = [{ key: "playtimeHours", color: C.purple }];
  return (
    <Card className={className}>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <Clock size={14} className="text-muted-foreground" /> Playtime
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SnapshotLineChart
          data={data} lines={lines} config={playtimeConfig}
          valueFormatter={(v) => formatHours(v)}
          yDomainOverride={[0, 4800]}
          timeFrame={timeFrame}
        />
      </CardContent>
    </Card>
  );
}

// ── Sidebar: current snapshot values ─────────────────────────────────────────

function CurrentSnapshotCard({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Card>
      <CardHeader className="border-b pb-3">
        <CardTitle className="text-sm font-medium">Current Values</CardTitle>
      </CardHeader>
      <CardContent className="pt-3 space-y-1.5">
        <StatRow label="Gold"     value={<GoldDisplay value={snapshot.gold} />}              />
        <StatRow label="Playtime" value={formatPlaytime(snapshot.playtimeSeconds)}            />
        <div className="border-t border-border/50 my-2" />
        <StatRow label="Adv. Crest"   value={snapshot.currencies.adventurerDawncrest.toLocaleString()} />
        <StatRow label="Vet. Crest"   value={snapshot.currencies.veteranDawncrest.toLocaleString()}    />
        <StatRow label="Champ. Crest" value={snapshot.currencies.championDawncrest.toLocaleString()}   />
        <StatRow label="Hero Crest"   value={snapshot.currencies.heroDawncrest.toLocaleString()}       />
        <StatRow label="Myth Crest"   value={snapshot.currencies.mythDawncrest.toLocaleString()}       />
      </CardContent>
    </Card>
  );
}

// ── Snapshot history table ────────────────────────────────────────────────────

function SnapshotHistoryTable({
  snapshots,
  paginated = false,
}: {
  snapshots: Snapshot[];
  paginated?: boolean;
}) {
  const [visible, setVisible] = useState(paginated ? 5 : snapshots.length);

  return (
    <>
      <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-border/50">
              <th className="text-left text-muted-foreground font-medium py-2 pr-4">Date</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">iLvl</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">M+</th>
              <th className="text-right text-muted-foreground font-medium py-2 px-2">Gold</th>
              <th className="text-left text-muted-foreground font-medium py-2 pl-2">Spec / Role</th>
            </tr>
          </thead>
          <tbody>
            {[...snapshots].reverse().slice(0, visible).map((s, i) => (
              <tr
                key={i}
                className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors"
              >
                <td className="py-2 pr-4 text-muted-foreground">{formatDate(s.takenAt)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{s.itemLevel.toFixed(1)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{s.mythicPlusScore.toLocaleString()}</td>
                <td className="py-2 px-2 text-right"><GoldDisplay value={s.gold} /></td>
                <td className="py-2 pl-2 text-muted-foreground">
                  {s.spec} <span className="opacity-60">({s.role})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paginated && visible < snapshots.length && (
        <div className="border-t pt-3 pb-3 px-6">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => setVisible((v) => v + 5)}
          >
            Load more ({snapshots.length - visible} remaining)
          </Button>
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Layout A — Overview
// Left sidebar: radar + current values (sticky)
// Right: time picker + chart grid
// Bottom: collapsible history
// ════════════════════════════════════════════════════════════════════════════

function OverviewLayout({ latest, chartSnapshots, timeFrame, setTimeFrame }: LayoutProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-4 items-start">
        {/* Sidebar */}
        <div className="w-full md:w-72 shrink-0 md:sticky md:top-4 space-y-4">
          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                <Zap size={14} className="text-muted-foreground" /> Combat Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <RadarPanel snapshot={latest} />
            </CardContent>
          </Card>
          <CurrentSnapshotCard snapshot={latest} />
        </div>

        {/* Main charts */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <TimeFramePicker value={timeFrame} onChange={setTimeFrame} />
            <span className="text-muted-foreground text-xs">
              {chartSnapshots.length} point{chartSnapshots.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <IlvlChartCard    snapshots={chartSnapshots} timeFrame={timeFrame} />
            <MplusChartCard   snapshots={chartSnapshots} timeFrame={timeFrame} />
            <GoldChartCard    snapshots={chartSnapshots} timeFrame={timeFrame} />
            <CurrenciesChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Layout B — Focus
// Metric tab bar → single large chart
// Right sidebar: radar + key stats (sticky)
// ════════════════════════════════════════════════════════════════════════════

type FocusMetric = "ilvl" | "mplus" | "gold" | "stats" | "currencies" | "playtime";

const FOCUS_METRICS: { value: FocusMetric; label: string; Icon: React.ElementType }[] = [
  { value: "ilvl",        label: "Item Level",  Icon: Sword  },
  { value: "mplus",       label: "M+ Score",    Icon: Flame  },
  { value: "gold",        label: "Gold",         Icon: Coins  },
  { value: "stats",       label: "Stats",        Icon: Zap    },
  { value: "currencies",  label: "Currencies",   Icon: Gem    },
  { value: "playtime",    label: "Playtime",     Icon: Clock  },
];

function FocusCurrentValue({ metric, snapshot }: { metric: FocusMetric; snapshot: Snapshot }) {
  switch (metric) {
    case "ilvl":
      return <span className="text-4xl font-bold tabular-nums">{snapshot.itemLevel.toFixed(1)}</span>;
    case "mplus":
      return <span className="text-4xl font-bold tabular-nums">{snapshot.mythicPlusScore.toLocaleString()}</span>;
    case "gold":
      return <span className="text-2xl font-bold"><GoldDisplay value={snapshot.gold} /></span>;
    case "stats":
      return (
        <div className="flex flex-wrap gap-4 text-sm">
          {[
            { l: "Crit",        v: snapshot.stats.critPercent        },
            { l: "Haste",       v: snapshot.stats.hastePercent       },
            { l: "Mastery",     v: snapshot.stats.masteryPercent     },
            { l: "Versatility", v: snapshot.stats.versatilityPercent },
          ].map(({ l, v }) => (
            <span key={l}>
              <span className="text-muted-foreground">{l} </span>
              <strong className="tabular-nums">{v.toFixed(1)}%</strong>
            </span>
          ))}
        </div>
      );
    case "currencies":
      return (
        <div className="flex flex-wrap gap-4 text-sm">
          {[
            { l: "Myth",       v: snapshot.currencies.mythDawncrest        },
            { l: "Hero",       v: snapshot.currencies.heroDawncrest        },
            { l: "Champion",   v: snapshot.currencies.championDawncrest    },
          ].map(({ l, v }) => (
            <span key={l}>
              <span className="text-muted-foreground">{l} </span>
              <strong className="tabular-nums">{v.toLocaleString()}</strong>
            </span>
          ))}
        </div>
      );
    case "playtime":
      return <span className="text-4xl font-bold">{formatPlaytime(snapshot.playtimeSeconds)}</span>;
    default:
      return null;
  }
}

function FocusChart({
  metric,
  snapshots,
  timeFrame,
}: {
  metric: FocusMetric;
  snapshots: Snapshot[];
  timeFrame: TimeFrame;
}) {
  const h = "h-[420px]";
  if (metric === "ilvl") {
    return (
      <SnapshotLineChart
        data={snapshots.map((s) => ({ date: s.takenAt, itemLevel: s.itemLevel }))}
        lines={[{ key: "itemLevel", color: C.blue }]}
        config={ilvlConfig}
        valueFormatter={(v) => v.toFixed(1)}
        className={h}
        timeFrame={timeFrame}
      />
    );
  }
  if (metric === "mplus") {
    return (
      <SnapshotLineChart
        data={snapshots.map((s) => ({ date: s.takenAt, mythicPlusScore: s.mythicPlusScore }))}
        lines={[{ key: "mythicPlusScore", color: C.red }]}
        config={mplusConfig}
        valueFormatter={(v) => v.toLocaleString()}
        className={h}
        timeFrame={timeFrame}
      />
    );
  }
  if (metric === "gold") {
    return (
      <SnapshotLineChart
        data={snapshots.map((s) => ({ date: s.takenAt, gold: s.gold }))}
        lines={[{ key: "gold", color: C.gold }]}
        config={goldConfig}
        valueFormatter={(v) => `${goldUnits(v).toLocaleString()}g`}
        className={h}
        timeFrame={timeFrame}
      />
    );
  }
  if (metric === "stats") {
    return (
      <SnapshotLineChart
        data={snapshots.map((s) => ({
          date: s.takenAt,
          critPercent:        s.stats.critPercent,
          hastePercent:       s.stats.hastePercent,
          masteryPercent:     s.stats.masteryPercent,
          versatilityPercent: s.stats.versatilityPercent,
        }))}
        lines={[
          { key: "critPercent",        color: C.red    },
          { key: "hastePercent",       color: C.green  },
          { key: "masteryPercent",     color: C.blue   },
          { key: "versatilityPercent", color: C.purple },
        ]}
        config={secondaryStatsConfig}
        valueFormatter={(v) => `${v.toFixed(1)}%`}
        className={h}
        showLegend
        timeFrame={timeFrame}
      />
    );
  }
  if (metric === "currencies") {
    return (
      <SnapshotLineChart
        data={snapshots.map((s) => ({ date: s.takenAt, ...s.currencies }))}
        lines={[
          { key: "adventurerDawncrest", color: C.blue  },
          { key: "veteranDawncrest",    color: C.teal  },
          { key: "championDawncrest",   color: C.green },
          { key: "heroDawncrest",       color: C.gold  },
          { key: "mythDawncrest",       color: C.red   },
        ]}
        config={currenciesConfig}
        className={h}
        showLegend
        timeFrame={timeFrame}
      />
    );
  }
  if (metric === "playtime") {
    return (
      <SnapshotLineChart
        data={snapshots.map((s) => ({ date: s.takenAt, playtimeHours: Math.round(s.playtimeSeconds / 3600) }))}
        lines={[{ key: "playtimeHours", color: C.purple }]}
        config={playtimeConfig}
        valueFormatter={(v) => formatHours(v)}
        yDomainOverride={[0, 4800]}
        className={h}
        timeFrame={timeFrame}
      />
    );
  }
  return null;
}

function FocusLayout({ latest, chartSnapshots, timeFrame, setTimeFrame }: LayoutProps) {
  const [metric, setMetric] = useState<FocusMetric>("ilvl");

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      {/* Main chart area */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Metric selector */}
        <div className="flex flex-wrap gap-1.5">
          {FOCUS_METRICS.map(({ value, label, Icon }) => (
            <button
              key={value}
              onClick={() => setMetric(value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border transition-colors ${
                metric === value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground border-border hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Current value spotlight */}
        <div className="min-h-[2.5rem] flex items-center">
          <FocusCurrentValue metric={metric} snapshot={latest} />
        </div>

        {/* Time picker + chart */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TimeFramePicker value={timeFrame} onChange={setTimeFrame} />
          <span className="text-muted-foreground text-xs">
            {chartSnapshots.length} point{chartSnapshots.length !== 1 ? "s" : ""}
          </span>
        </div>
        <Card>
          <CardContent className="pt-4">
            <FocusChart metric={metric} snapshots={chartSnapshots} timeFrame={timeFrame} />
          </CardContent>
        </Card>
      </div>

      {/* Right sidebar */}
      <div className="w-full lg:w-64 shrink-0 lg:sticky lg:top-4 space-y-4">
        <Card>
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Zap size={14} className="text-muted-foreground" /> Combat Stats
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            <RadarPanel snapshot={latest} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-2">
              <StatGrid label="Item Level" value={latest.itemLevel.toFixed(1)}                   />
              <StatGrid label="M+ Score"   value={latest.mythicPlusScore.toLocaleString()}        />
              <StatGrid label="Gold"       value={<GoldDisplay value={latest.gold} />}            />
              <StatGrid label="Playtime"   value={formatPlaytime(latest.playtimeSeconds)}         />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Layout C — Timeline
// Compact radar strip at top
// All charts stacked full-width, taller
// Full scrollable history at bottom (no pagination)
// ════════════════════════════════════════════════════════════════════════════

function TimelineLayout({ latest, chartSnapshots, timeFrame, setTimeFrame }: LayoutProps) {
  const chartH = "h-[260px]";

  return (
    <div className="space-y-4">
      {/* Time picker — prominent at top */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <TimeFramePicker value={timeFrame} onChange={setTimeFrame} />
        <span className="text-muted-foreground text-xs">
          {chartSnapshots.length} point{chartSnapshots.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Radar strip */}
      <RadarStrip snapshot={latest} />

      {/* Stacked charts */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Sword size={14} className="text-muted-foreground" /> Item Level
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SnapshotLineChart
            data={chartSnapshots.map((s) => ({ date: s.takenAt, itemLevel: s.itemLevel }))}
            lines={[{ key: "itemLevel", color: C.blue }]}
            config={ilvlConfig}
            valueFormatter={(v) => v.toFixed(1)}
            className={chartH}
            timeFrame={timeFrame}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Flame size={14} className="text-muted-foreground" /> M+ Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SnapshotLineChart
            data={chartSnapshots.map((s) => ({ date: s.takenAt, mythicPlusScore: s.mythicPlusScore }))}
            lines={[{ key: "mythicPlusScore", color: C.red }]}
            config={mplusConfig}
            valueFormatter={(v) => v.toLocaleString()}
            className={chartH}
            timeFrame={timeFrame}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Coins size={14} className="text-muted-foreground" /> Gold
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SnapshotLineChart
            data={chartSnapshots.map((s) => ({ date: s.takenAt, gold: s.gold }))}
            lines={[{ key: "gold", color: C.gold }]}
            config={goldConfig}
            valueFormatter={(v) => `${goldUnits(v).toLocaleString()}g`}
            className={chartH}
            timeFrame={timeFrame}
          />
        </CardContent>
      </Card>

      <SecondaryStatsChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
      <CurrenciesChartCard     snapshots={chartSnapshots} timeFrame={timeFrame} />
      <PlaytimeChartCard       snapshots={chartSnapshots} timeFrame={timeFrame} />
    </div>
  );
}

// ── Role / Spec switcher ──────────────────────────────────────────────────────

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
          onClick={() => { onRoleChange(null); onSpecChange(null); }}
        >All</Button>
        {roles.map((role) => (
          <Button
            key={role}
            size="sm"
            variant={selectedRole === role ? "default" : "outline"}
            onClick={() => { onRoleChange(role); onSpecChange(null); }}
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
            <Button size="sm" variant={selectedSpec === null ? "default" : "outline"} onClick={() => onSpecChange(null)}>
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

// ── Main component ────────────────────────────────────────────────────────────

// ── External site links ───────────────────────────────────────────────────────

const EXTERNAL_LINKS = [
  {
    label: "Raider.IO",
    color: "hover:text-orange-400",
    url: (region: string, realm: string, name: string) =>
      `https://raider.io/characters/${region}/${realm}/${name}`,
  },
  {
    label: "Armory",
    color: "hover:text-blue-400",
    url: (region: string, realm: string, name: string) =>
      `https://worldofwarcraft.blizzard.com/en-${region}/character/${region}/${encodeURIComponent(realm.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}`,
  },
  {
    label: "WoWProgress",
    color: "hover:text-green-400",
    url: (region: string, realm: string, name: string) =>
      `https://www.wowprogress.com/character/${region}/${realm}/${name}`,
  },
  {
    label: "WarcraftLogs",
    color: "hover:text-purple-400",
    url: (region: string, realm: string, name: string) =>
      `https://www.warcraftlogs.com/character/${region}/${realm}/${name}`,
  },
] as const;

function CharacterLinks({
  region,
  realm,
  name,
}: {
  region: string;
  realm: string;
  name: string;
}) {
  return (
    <div className="flex items-center gap-3 mt-2 flex-wrap">
      {EXTERNAL_LINKS.map(({ label, color, url }) => (
        <a
          key={label}
          href={url(region.toLowerCase(), realm, name)}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-1 text-xs text-muted-foreground transition-colors ${color}`}
        >
          <ExternalLink size={11} />
          {label}
        </a>
      ))}
    </div>
  );
}

function RouteComponent() {
  const { characterId } = Route.useParams();
  const data = useQuery(api.characters.getCharacterSnapshots, {
    characterId: characterId as Id<"characters">,
  });
  const mythicPlus = useQuery(api.characters.getCharacterMythicPlus, {
    characterId: characterId as Id<"characters">,
  });

  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [selectedSpec, setSelectedSpec] = useState<string | null>(null);
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("30d");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    try {
      return (localStorage.getItem("wow-char-layout") as LayoutMode) ?? "overview";
    } catch {
      return "overview";
    }
  });

  function handleLayoutChange(mode: LayoutMode) {
    setLayoutMode(mode);
    try { localStorage.setItem("wow-char-layout", mode); } catch { /* ignore */ }
  }

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

  const filtered = snapshots.filter((s) => {
    if (selectedRole && s.role !== selectedRole) return false;
    if (selectedSpec && s.spec !== selectedSpec) return false;
    return true;
  });

  const latest = filtered[filtered.length - 1] ?? null;
  const timeFrameFiltered = filterByTimeFrame(filtered, timeFrame);
  const chartSnapshots = groupSnapshotsAuto(timeFrameFiltered);

  const layoutProps: LayoutProps = {
    latest: latest!,
    chartSnapshots,
    filteredSnapshots: filtered,
    timeFrame,
    setTimeFrame,
  };

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8 space-y-4">
      {/* Character header */}
      <Card>
        <CardHeader className="border-b pb-3">
          <div className="flex items-baseline justify-between">
            <CardTitle className={`text-2xl font-bold ${classColor(character.class)}`}>
              {character.name}
            </CardTitle>
            <div className="flex items-center gap-2">
              <LayoutSwitcher value={layoutMode} onChange={handleLayoutChange} />
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
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {character.race} {character.class} — {character.realm}-{character.region.toUpperCase()}
          </p>
          <CharacterLinks region={character.region} realm={character.realm} name={character.name} />
        </CardHeader>

        {latest && (
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <StatGrid label="Level"      value={latest.level}                                />
              <StatGrid label="Item Level" value={latest.itemLevel.toFixed(1)}                 />
              <StatGrid label="M+ Score"   value={latest.mythicPlusScore.toLocaleString()}     />
              <StatGrid label="Gold"       value={<GoldDisplay value={latest.gold} />}         />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1">
              <StatRow label="Spec"     value={`${latest.spec} (${latest.role})`}              />
              <StatRow label="Playtime" value={formatPlaytime(latest.playtimeSeconds)}         />
              <StatRow label="Snapshot" value={formatDate(latest.takenAt)}                    />
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

      {/* Active layout */}
      {latest && filtered.length > 0 && (
        <>
          {layoutMode === "overview"  && <OverviewLayout  {...layoutProps} />}
          {layoutMode === "focus"     && <FocusLayout     {...layoutProps} />}
          {layoutMode === "timeline"  && <TimelineLayout  {...layoutProps} />}
        </>
      )}

      <MythicPlusSection data={mythicPlus as MythicPlusData | null | undefined} />
      <SnapshotHistorySection snapshots={filtered} layoutMode={layoutMode} />
    </div>
  );
}

function SnapshotHistorySection({
  snapshots,
  layoutMode,
}: {
  snapshots: Snapshot[];
  layoutMode: LayoutMode;
}) {
  const [showHistory, setShowHistory] = useState(false);

  if (snapshots.length <= 1) return null;

  if (layoutMode === "timeline") {
    return (
      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <History size={14} className="text-muted-foreground" />
            Snapshot History ({snapshots.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <SnapshotHistoryTable snapshots={snapshots} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        className="border-b pb-3 cursor-pointer select-none"
        onClick={() => setShowHistory((v) => !v)}
      >
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <History size={14} className="text-muted-foreground" />
            Snapshot History ({snapshots.length})
          </span>
          <span className="text-muted-foreground text-xs font-normal">
            {showHistory ? "Hide" : "Show"}
          </span>
        </CardTitle>
      </CardHeader>
      {showHistory && (
        <CardContent className="pt-0">
          <SnapshotHistoryTable snapshots={snapshots} paginated />
        </CardContent>
      )}
    </Card>
  );
}
