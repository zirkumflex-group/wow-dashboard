import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getMythicPlusDungeonMeta } from "../lib/mythic-plus-static";
import { getClassTextColor } from "../lib/class-colors";
import { usePinnedCharacters } from "../lib/pinned-characters";
import { formatPlaytime, PlaytimeBreakdown } from "../components/playtime-breakdown";
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
import { Checkbox } from "@wow-dashboard/ui/components/checkbox";
import { Input } from "@wow-dashboard/ui/components/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@wow-dashboard/ui/components/sheet";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
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
  Star,
  Sword,
  X,
  Zap,
} from "lucide-react";
import {
  Suspense,
  lazy,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  getTradeSlotExportLabels,
  getTradeSlotEditorCount,
  TRADE_SLOT_EDITOR_OPTIONS,
  normalizeTradeSlotKeys,
  toggleTradeSlotGroup,
  type TradeSlotKey,
} from "../lib/trade-slots";
import { apiClient, apiQueryKeys, apiQueryOptions } from "@/lib/api-client";

const DEFAULT_TIME_FRAME = "all" as const;
const CHARACTER_PAGE_STALE_TIME_MS = 5 * 60 * 1000;

function getCharacterPageQueryOptions(characterId: string, timeFrame: TimeFrame) {
  return {
    ...apiQueryOptions.characterPage(characterId, {
      timeFrame,
      includeStats: false,
    }),
    staleTime: CHARACTER_PAGE_STALE_TIME_MS,
  };
}

const LazyMythicPlusSection = lazy(() =>
  import("../components/character-page-mythic-plus-section").then((module) => ({
    default: module.MythicPlusSection,
  })),
);

function getCharacterStatsTimelineQueryOptions(characterId: string, timeFrame: TimeFrame) {
  return {
    ...apiQueryOptions.characterDetailTimeline(characterId, {
      timeFrame,
      metric: "stats",
    }),
    staleTime: CHARACTER_PAGE_STALE_TIME_MS,
  };
}

function getCharacterMythicPlusAllRunsQueryOptions(characterId: string) {
  return {
    ...apiQueryOptions.characterMythicPlus(characterId, { includeAllRuns: true }),
    staleTime: CHARACTER_PAGE_STALE_TIME_MS,
  };
}

export const Route = createFileRoute("/character/$characterId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      getCharacterPageQueryOptions(params.characterId, DEFAULT_TIME_FRAME),
    ),
  component: RouteComponent,
});

// ── Constants ────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = { tank: "Tank", healer: "Healer", dps: "DPS" };
const CARD_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// ── Time frame ───────────────────────────────────────────────────────────────

type TimeFrame = "7d" | "30d" | "90d" | "all";

const TIME_FRAME_OPTIONS: { value: TimeFrame; label: string }[] = [
  { value: "all", label: "All" },
  { value: "90d", label: "90D" },
  { value: "30d", label: "30D" },
  { value: "7d", label: "7D" },
];

function TimeFramePicker({
  value,
  onChange,
}: {
  value: TimeFrame;
  onChange: (v: TimeFrame) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">Zoom</span>
      <div className="flex rounded-md border overflow-hidden">
        {TIME_FRAME_OPTIONS.map((opt) => {
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`px-3 py-1 text-xs transition-colors ${
                value === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
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
    { mode: "overview" as const, Icon: LayoutGrid, title: "Overview — radar sidebar + chart grid" },
    { mode: "focus" as const, Icon: Columns, title: "Focus — single metric deep-dive" },
    {
      mode: "timeline" as const,
      Icon: LayoutList,
      title: "Timeline — stacked charts + full history",
    },
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
  return getClassTextColor(cls);
}

function formatDate(takenAtSeconds: number) {
  return new Date(takenAtSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type ChartTooltipPayloadItem =
  | {
      payload?: {
        date?: unknown;
      };
    }
  | null
  | undefined;

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

function getTickBucketKey(timestamp: number, frame: TimeFrame) {
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  if (frame === "all") {
    return `${year}-${month}`;
  }

  return `${year}-${month}-${day}`;
}

function dedupeTicksByBucket(ticks: number[], frame: TimeFrame, preserveEndpoints = false) {
  if (preserveEndpoints && ticks.length <= 2) {
    return ticks;
  }

  const seenBuckets = new Set<string>();
  const firstIndex = 0;
  const lastIndex = ticks.length - 1;

  if (preserveEndpoints) {
    const firstBucket = getTickBucketKey(ticks[firstIndex]!, frame);
    const lastBucket = getTickBucketKey(ticks[lastIndex]!, frame);
    if (firstBucket) seenBuckets.add(firstBucket);
    if (lastBucket) seenBuckets.add(lastBucket);
  }

  return ticks.filter((timestamp, index) => {
    if (preserveEndpoints && (index === firstIndex || index === lastIndex)) {
      return true;
    }

    const bucketKey = getTickBucketKey(timestamp, frame);
    if (bucketKey === null || seenBuckets.has(bucketKey)) {
      return false;
    }

    seenBuckets.add(bucketKey);
    return true;
  });
}

function capXAxisTicks(ticks: number[], maxCount: number) {
  if (ticks.length <= maxCount) {
    return ticks;
  }

  const selectedTicks = new Set<number>([ticks[0]!, ticks[ticks.length - 1]!]);
  const step = (ticks.length - 1) / (maxCount - 1);
  for (let index = 1; index < maxCount - 1; index += 1) {
    selectedTicks.add(ticks[Math.round(step * index)]!);
  }

  return Array.from(selectedTicks).sort((a, b) => a - b);
}

function getXAxisDomain(data: Record<string, number | undefined>[]): [number, number] | undefined {
  const timestamps = data
    .map((datum) => normalizeTimestampSeconds(datum.date))
    .filter((timestamp): timestamp is number => timestamp !== null);
  const uniqueTimestamps = Array.from(new Set(timestamps)).sort((a, b) => a - b);
  if (uniqueTimestamps.length < 2) {
    return undefined;
  }

  const minTimestamp = uniqueTimestamps[0]!;
  const maxTimestamp = uniqueTimestamps[uniqueTimestamps.length - 1]!;
  const span = maxTimestamp - minTimestamp;
  if (span <= 0) {
    return undefined;
  }

  const padding = Math.max(Math.round(span * 0.025), 1);
  return [minTimestamp - padding, maxTimestamp + padding];
}

function getXAxisTicks(data: Record<string, number | undefined>[], frame: TimeFrame) {
  const timestamps = data
    .map((datum) => normalizeTimestampSeconds(datum.date))
    .filter((timestamp): timestamp is number => timestamp !== null);
  const uniqueTimestamps = Array.from(new Set(timestamps)).sort((a, b) => a - b);
  if (uniqueTimestamps.length <= 2) {
    return uniqueTimestamps;
  }

  const importantTicks = uniqueTimestamps.filter((timestamp, index) => {
    if (index === 0 || index === uniqueTimestamps.length - 1) {
      return true;
    }

    const date = new Date(timestamp * 1000);
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    if (frame === "7d") {
      return true;
    }
    if (frame === "30d") {
      return date.getDay() === 1;
    }
    if (frame === "90d") {
      return date.getDate() === 1 || date.getDate() === 15;
    }
    return date.getDate() === 1;
  });
  const dedupedImportantTicks = dedupeTicksByBucket(importantTicks, frame, true);

  const maxTickCount = frame === "all" ? 8 : frame === "90d" ? 9 : frame === "30d" ? 7 : 8;
  if (dedupedImportantTicks.length >= 3) {
    return capXAxisTicks(dedupedImportantTicks, maxTickCount);
  }

  return capXAxisTicks(dedupeTicksByBucket(uniqueTimestamps, frame, true), maxTickCount);
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

function formatCardDateTime(ts?: number | null) {
  if (!ts) return "--";
  return CARD_DATE_TIME_FORMATTER.format(new Date(ts * 1000));
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

type CombatStatSummary = {
  label: string;
  percent: number;
  rating?: number;
};

type CombatRadarDatum = {
  stat: string;
  value: number;
  percentValue: number;
  ratingValue?: number;
};

const CORE_COMBAT_STATS = [
  {
    label: "Crit",
    getPercent: (stats: Snapshot["stats"]) => stats.critPercent,
    getRating: (stats: Snapshot["stats"]) => stats.critRating,
  },
  {
    label: "Haste",
    getPercent: (stats: Snapshot["stats"]) => stats.hastePercent,
    getRating: (stats: Snapshot["stats"]) => stats.hasteRating,
  },
  {
    label: "Mastery",
    getPercent: (stats: Snapshot["stats"]) => stats.masteryPercent,
    getRating: (stats: Snapshot["stats"]) => stats.masteryRating,
  },
  {
    label: "Versatility",
    getPercent: (stats: Snapshot["stats"]) => stats.versatilityPercent,
    getRating: (stats: Snapshot["stats"]) => stats.versatilityRating,
  },
] as const;

const TERTIARY_COMBAT_STATS = [
  {
    label: "Speed",
    getPercent: (stats: Snapshot["stats"]) => stats.speedPercent ?? 0,
    getRating: (stats: Snapshot["stats"]) => stats.speedRating,
  },
  {
    label: "Leech",
    getPercent: (stats: Snapshot["stats"]) => stats.leechPercent ?? 0,
    getRating: (stats: Snapshot["stats"]) => stats.leechRating,
  },
  {
    label: "Avoidance",
    getPercent: (stats: Snapshot["stats"]) => stats.avoidancePercent ?? 0,
    getRating: (stats: Snapshot["stats"]) => stats.avoidanceRating,
  },
] as const;

function formatCombatStatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatCombatStatRating(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value).toLocaleString()
    : null;
}

function renderCombatStatValue(stat: CombatStatSummary) {
  const rating = formatCombatStatRating(stat.rating);
  const percent = formatCombatStatPercent(stat.percent);

  if (!rating) {
    return percent;
  }

  return (
    <span className="tabular-nums">
      {rating}
      <span className="text-muted-foreground"> ({percent})</span>
    </span>
  );
}

function getCoreCombatStats(snapshot: Snapshot): CombatStatSummary[] {
  return CORE_COMBAT_STATS.map((stat) => ({
    label: stat.label,
    percent: stat.getPercent(snapshot.stats),
    rating: stat.getRating(snapshot.stats),
  }));
}

function getPrimaryStat(snapshot: Snapshot) {
  const primaryStats = [
    { label: "Strength", value: snapshot.stats.strength },
    { label: "Agility", value: snapshot.stats.agility },
    { label: "Intellect", value: snapshot.stats.intellect },
  ];

  const primaryStat = primaryStats.reduce((highest, current) =>
    current.value > highest.value ? current : highest,
  );

  return primaryStat.value > 0 ? primaryStat : null;
}

function getTertiaryStats(snapshot: Snapshot) {
  return TERTIARY_COMBAT_STATS.map((stat) => ({
    label: stat.label,
    percent: stat.getPercent(snapshot.stats),
    rating: stat.getRating(snapshot.stats),
  })).filter((stat) => stat.percent > 0 || (stat.rating ?? 0) > 0);
}

function CombatRadarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: CombatRadarDatum }>;
}) {
  const datum = payload?.[0]?.payload;

  if (!active || !datum) {
    return null;
  }

  const rating = formatCombatStatRating(datum.ratingValue);

  return (
    <div className="grid min-w-36 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{datum.stat}</div>
      {rating ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Rating</span>
            <span className="font-mono font-medium text-foreground tabular-nums">{rating}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Percent</span>
            <span className="font-mono font-medium text-foreground tabular-nums">
              {formatCombatStatPercent(datum.percentValue)}
            </span>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Percent</span>
          <span className="font-mono font-medium text-foreground tabular-nums">
            {formatCombatStatPercent(datum.percentValue)}
          </span>
        </div>
      )}
    </div>
  );
}

function StatGrid({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-md bg-muted/30 text-center ${compact ? "p-1.5" : "p-2"}`}>
      <div
        className={
          compact
            ? "text-[11px] leading-tight text-muted-foreground"
            : "text-muted-foreground text-xs"
        }
      >
        {label}
      </div>
      <div
        className={
          compact ? "mt-0.5 text-sm font-semibold leading-none" : "mt-0.5 text-sm font-semibold"
        }
      >
        {value}
      </div>
    </div>
  );
}

function TopMetricCard({
  label,
  meta,
  value,
}: {
  label: string;
  meta?: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/75">
          {label}
        </div>
        {meta && (
          <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
            {meta}
          </div>
        )}
      </div>
      <div className="mt-3 min-w-0 text-xl font-semibold leading-none text-foreground">{value}</div>
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

// ── Types ─────────────────────────────────────────────────────────────────────

type Snapshot = {
  takenAt: number;
  level: number;
  spec: string;
  role: string;
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  playtimeThisLevelSeconds?: number;
  mythicPlusScore: number;
  ownedKeystone?: {
    level: number;
    mapChallengeModeID?: number;
    mapName?: string;
  };
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
    critRating?: number;
    critPercent: number;
    hasteRating?: number;
    hastePercent: number;
    masteryRating?: number;
    masteryPercent: number;
    versatilityRating?: number;
    versatilityPercent: number;
    speedRating?: number;
    speedPercent?: number;
    leechRating?: number;
    leechPercent?: number;
    avoidanceRating?: number;
    avoidancePercent?: number;
  };
};

type CoreChartSnapshot = {
  takenAt: number;
  itemLevel: number;
  gold: number;
  playtimeSeconds: number;
  mythicPlusScore: number;
  currencies: Snapshot["currencies"];
};

type StatsChartSnapshot = {
  takenAt: number;
  stats: Snapshot["stats"];
};

type CurrencyChartSnapshot = Pick<CoreChartSnapshot, "takenAt" | "currencies">;

type LayoutProps = {
  latest: Snapshot;
  coreSnapshots: CoreChartSnapshot[];
  statsSnapshots?: StatsChartSnapshot[] | null;
  currencySnapshots?: CurrencyChartSnapshot[] | null;
  mythicPlus?: MythicPlusData | null;
  mythicPlusIsLoadingAllRuns?: boolean;
  requestAllMythicPlusRuns?: () => void;
  characterId: string;
  characterName: string;
  characterRealm: string;
  characterRegion: string;
  currentMythicPlusScore: number | null;
  timeFrame: TimeFrame;
  setTimeFrame: (f: TimeFrame) => void;
};

type MythicPlusRunMember = {
  name: string;
  realm?: string;
  classTag?: string;
  role?: "tank" | "healer" | "dps";
};

type MythicPlusRun = {
  _id?: string;
  rowKey?: string;
  fingerprint: string;
  attemptId?: string;
  canonicalKey?: string;
  observedAt: number;
  playedAt?: number;
  sortTimestamp?: number;
  seasonID?: number;
  mapChallengeModeID?: number;
  mapName?: string;
  level?: number;
  status?: "active" | "completed" | "abandoned";
  completed?: boolean;
  completedInTime?: boolean;
  durationMs?: number;
  runScore?: number;
  startDate?: number;
  completedAt?: number;
  endedAt?: number;
  abandonedAt?: number;
  abandonReason?:
    | "challenge_mode_reset"
    | "left_instance"
    | "leaver_timer"
    | "history_incomplete"
    | "stale_recovery"
    | "unknown";
  thisWeek?: boolean;
  members?: MythicPlusRunMember[];
  upgradeCount?: number | null;
  scoreIncrease?: number | null;
};

type MythicPlusBucketSummary = {
  totalRuns: number;
  totalAttempts?: number;
  completedRuns: number;
  abandonedRuns?: number;
  activeRuns?: number;
  timedRuns: number;
  timed2To9: number;
  timed10To11: number;
  timed12To13: number;
  timed14Plus: number;
  bestLevel: number | null;
  bestTimedLevel: number | null;
  bestTimedUpgradeCount: number | null;
  bestTimedScore: number | null;
  bestTimedDurationMs: number | null;
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
  bestTimedUpgradeCount: number | null;
  bestTimedScore: number | null;
  bestTimedDurationMs: number | null;
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
  totalRunCount: number;
  isPreview: boolean;
};

// ── Snapshot grouping ─────────────────────────────────────────────────────────

// ── Chart palette ─────────────────────────────────────────────────────────────

const C = {
  blue: "oklch(0.74 0.14 245)",
  red: "oklch(0.71 0.16 25)",
  gold: "oklch(0.82 0.14 82)",
  purple: "oklch(0.72 0.14 295)",
  teal: "oklch(0.74 0.13 190)",
  green: "oklch(0.75 0.13 155)",
  pink: "oklch(0.74 0.14 330)",
} as const;

const ilvlConfig: ChartConfig = { itemLevel: { label: "Item Level", color: C.blue } };
const mplusConfig: ChartConfig = { mythicPlusScore: { label: "M+ Score", color: C.red } };
const goldConfig: ChartConfig = { gold: { label: "Gold", color: C.gold } };
const playtimeConfig: ChartConfig = { playtimeHours: { label: "Playtime", color: C.purple } };
const radarConfig: ChartConfig = { value: { label: "Value", color: C.blue } };
const secondaryStatsConfig: ChartConfig = {
  critPercent: { label: "Crit", color: C.red },
  hastePercent: { label: "Haste", color: C.green },
  masteryPercent: { label: "Mastery", color: C.blue },
  versatilityPercent: { label: "Versatility", color: C.purple },
};
const currenciesConfig: ChartConfig = {
  adventurerDawncrest: { label: "Adventurer", color: C.blue },
  veteranDawncrest: { label: "Veteran", color: C.teal },
  championDawncrest: { label: "Champion", color: C.green },
  heroDawncrest: { label: "Hero", color: C.gold },
  mythDawncrest: { label: "Myth", color: C.red },
};

// ── Reusable line chart ───────────────────────────────────────────────────────

type YScaleOptions = {
  includeZero?: boolean;
  minDomain?: number;
  minSpan?: number;
  minPadding?: number;
  padRatio?: number;
  stepFloor?: number;
  tickCount?: number;
};

type SnapshotLineSeries = {
  key: string;
  color: string;
};

type LineEmphasisMode = "primary" | "equal";

type EndpointDotProps = {
  cx?: number;
  cy?: number;
  index?: number;
  value?: number | string;
};

const ITEM_LEVEL_AUTO_SCALE: YScaleOptions = {
  minDomain: 0,
  minSpan: 4,
  minPadding: 0.5,
  padRatio: 0.18,
  stepFloor: 0.5,
};
const MPLUS_AUTO_SCALE: YScaleOptions = {
  includeZero: true,
  minSpan: 150,
  minPadding: 40,
  padRatio: 0.16,
  stepFloor: 25,
};
const GOLD_SCALE: YScaleOptions = {
  minDomain: 0,
  minSpan: 20,
  minPadding: 2,
  padRatio: 0.2,
  stepFloor: 1,
};
const SECONDARY_STATS_SCALE: YScaleOptions = {
  minDomain: 0,
  minSpan: 6,
  minPadding: 0.4,
  padRatio: 0.14,
  stepFloor: 0.5,
};
const CURRENCIES_SCALE: YScaleOptions = {
  includeZero: true,
  minSpan: 40,
  minPadding: 5,
  padRatio: 0.14,
  stepFloor: 5,
};
const PLAYTIME_SCALE: YScaleOptions = {
  minDomain: 0,
  minSpan: 24,
  minPadding: 6,
  padRatio: 0.14,
  stepFloor: 6,
};

function getNiceStep(rawStep: number, stepFloor = 1) {
  const minimum = Math.max(stepFloor, Number.EPSILON);
  const safeStep = Math.max(rawStep, minimum);
  const magnitude = 10 ** Math.floor(Math.log10(safeStep));
  const normalized = safeStep / magnitude;

  if (normalized <= 1) return Math.max(stepFloor, magnitude);
  if (normalized <= 2) return Math.max(stepFloor, 2 * magnitude);
  if (normalized <= 2.5) return Math.max(stepFloor, 2.5 * magnitude);
  if (normalized <= 5) return Math.max(stepFloor, 5 * magnitude);
  return Math.max(stepFloor, 10 * magnitude);
}

function getAdaptiveYDomain(
  values: number[],
  pointCount: number,
  options: YScaleOptions = {},
): [number, number] {
  const safeValues = values.filter((value) => Number.isFinite(value));
  if (safeValues.length === 0) return [0, 1];

  const tickCount = Math.max(options.tickCount ?? 5, 2);
  let minValue = Math.min(...safeValues);
  let maxValue = Math.max(...safeValues);

  if (options.includeZero) {
    minValue = Math.min(minValue, 0);
    maxValue = Math.max(maxValue, 0);
  }

  const rawSpan = maxValue - minValue;
  const minSpan = options.minSpan ?? 1;
  const effectiveSpan =
    rawSpan > 0 ? Math.max(rawSpan, minSpan) : Math.max(minSpan, Math.abs(maxValue) * 0.04, 1);
  const padRatio = options.padRatio ?? (pointCount <= 3 ? 0.18 : 0.12);
  const minPadding = options.minPadding ?? Math.max(effectiveSpan * 0.08, 0.5);
  const padding = Math.max(effectiveSpan * padRatio, minPadding);
  const step = getNiceStep((effectiveSpan + padding * 2) / (tickCount - 1), options.stepFloor ?? 1);

  let domainMin = Math.floor((minValue - padding) / step) * step;
  let domainMax = Math.ceil((maxValue + padding) / step) * step;

  if (options.minDomain !== undefined && domainMin < options.minDomain) {
    domainMin = options.minDomain;
  }
  if (options.includeZero && minValue >= 0 && domainMin < 0) {
    domainMin = 0;
  }
  if (options.includeZero && maxValue <= 0 && domainMax > 0) {
    domainMax = 0;
  }

  if (domainMin === domainMax) {
    if (options.minDomain !== undefined && domainMin <= options.minDomain) {
      return [options.minDomain, domainMax + step];
    }

    return [domainMin - step, domainMax + step];
  }

  return [domainMin, domainMax];
}

function getYAxisWidth(
  domain: [number, number],
  valueFormatter?: (value: number) => string,
  minWidth = 52,
) {
  const labelCandidates = Array.from(
    new Set(
      [domain[0], domain[1], 0].filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value),
      ),
    ),
  );

  const maxLabelLength = labelCandidates.reduce((longest, value) => {
    const label = valueFormatter?.(value) ?? value.toLocaleString();
    return Math.max(longest, label.length);
  }, 0);

  return Math.min(96, Math.max(minWidth, Math.ceil(maxLabelLength * 7.5 + 12)));
}

function getPrimaryLineKey(
  lines: SnapshotLineSeries[],
  latestDatum?: Record<string, number | undefined>,
) {
  if (lines.length <= 1) return lines[0]?.key;

  return lines.reduce((primaryKey, line) => {
    const lineValue = latestDatum?.[line.key];
    const primaryValue = latestDatum?.[primaryKey];

    if (typeof lineValue !== "number") {
      return primaryKey;
    }

    if (typeof primaryValue !== "number" || lineValue > primaryValue) {
      return line.key;
    }

    return primaryKey;
  }, lines[0]?.key ?? "");
}

function SnapshotLineChart({
  data,
  lines,
  config,
  valueFormatter,
  className,
  showLegend,
  yDomainOverride,
  yScaleOptions,
  timeFrame,
  lineEmphasis = "primary",
  showLatestValue,
  yAxisWidth,
}: {
  data: Record<string, number | undefined>[];
  lines: SnapshotLineSeries[];
  config: ChartConfig;
  valueFormatter?: (v: number) => string;
  className?: string;
  showLegend?: boolean;
  yDomainOverride?: [number, number];
  yScaleOptions?: YScaleOptions;
  timeFrame?: TimeFrame;
  lineEmphasis?: LineEmphasisMode;
  showLatestValue?: boolean;
  yAxisWidth?: number;
}) {
  if (data.length < 2) {
    return (
      <p className="text-muted-foreground text-sm py-6 text-center">Not enough data points yet.</p>
    );
  }

  const xAxisTicks = getXAxisTicks(data, timeFrame ?? "all");
  const xAxisDomain = getXAxisDomain(data);
  const latestDatum = data[data.length - 1];
  const hasPrimaryEmphasis = lineEmphasis === "primary" && lines.length > 1;
  const primaryLineKey = hasPrimaryEmphasis ? getPrimaryLineKey(lines, latestDatum) : undefined;
  const shouldShowLatestValue = showLatestValue ?? lines.length === 1;

  const allValues = data
    .flatMap((d) => lines.map((l) => d[l.key]))
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  const yDomain: [number, number] =
    yDomainOverride ?? getAdaptiveYDomain(allValues, data.length, yScaleOptions);
  const resolvedYAxisWidth = yAxisWidth ?? getYAxisWidth(yDomain, valueFormatter);

  const renderEndpointMarker =
    ({
      color,
      variant,
      showLabel,
    }: {
      color: string;
      variant: "primary" | "secondary" | "equal";
      showLabel: boolean;
    }) =>
    ({ cx, cy, index, value }: EndpointDotProps) => {
      if (typeof cx !== "number" || typeof cy !== "number" || index !== data.length - 1) {
        return null;
      }

      const numericValue =
        typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
      const label =
        showLabel && Number.isFinite(numericValue)
          ? (valueFormatter?.(numericValue) ?? numericValue.toLocaleString())
          : null;
      const showLabelBelow = cy < 28;
      const markerOpacity = variant === "primary" ? 1 : variant === "equal" ? 0.9 : 0.65;
      const markerRadius = variant === "primary" ? 4 : variant === "equal" ? 3.5 : 3;
      const markerStrokeWidth = variant === "primary" ? 2 : 1.5;
      const markerGlow = variant === "primary" ? 4 : variant === "equal" ? 3 : 2;

      return (
        <g opacity={markerOpacity}>
          <circle
            cx={cx}
            cy={cy}
            r={markerRadius}
            fill={color}
            stroke="var(--card)"
            strokeWidth={markerStrokeWidth}
            style={{ filter: `drop-shadow(0 0 ${markerGlow}px ${color})` }}
          />
          {label ? (
            <text
              x={cx - 10}
              y={showLabelBelow ? cy + 12 : cy - 10}
              textAnchor="end"
              dominantBaseline={showLabelBelow ? "hanging" : "auto"}
              fill={color}
              fontSize={11}
              fontWeight={600}
              letterSpacing="0.01em"
              paintOrder="stroke"
              stroke="var(--card)"
              strokeWidth={3}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {label}
            </text>
          ) : null}
        </g>
      );
    };

  // Sparse data reads crisper as straight segments; dense data benefits from smoothing.
  const curveType: "linear" | "monotone" = data.length <= 20 ? "linear" : "monotone";

  return (
    <ChartContainer
      config={config}
      className={`w-full [&_text]:tabular-nums ${className ?? "h-[200px]"}`}
    >
      <LineChart data={data} margin={{ top: 16, right: 12, left: 4, bottom: 8 }}>
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeOpacity={0.45}
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="date"
          type="number"
          scale="time"
          domain={xAxisDomain}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{
            fontSize: 11,
            fill: "var(--muted-foreground)",
            fillOpacity: 0.75,
          }}
          ticks={xAxisTicks}
          interval={0}
          minTickGap={18}
          tickFormatter={(ts: number) => xAxisTickFormatter(ts, timeFrame ?? "all")}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tick={{
            fontSize: 11,
            fill: "var(--muted-foreground)",
            fillOpacity: 0.75,
          }}
          tickFormatter={valueFormatter}
          width={resolvedYAxisWidth}
          domain={yDomain}
          tickCount={yScaleOptions?.tickCount ?? 5}
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
              valueFormatter={valueFormatter}
              indicator="dot"
            />
          }
        />
        {showLegend && (
          <ChartLegend content={<ChartLegendContent className="text-muted-foreground/85" />} />
        )}
        {lines.map(({ key, color }) => {
          const isPrimaryLine = primaryLineKey === undefined || key === primaryLineKey;
          const lineVariant = hasPrimaryEmphasis
            ? isPrimaryLine
              ? "primary"
              : "secondary"
            : "equal";

          return (
            <Line
              key={key}
              type={curveType}
              dataKey={key}
              stroke={color}
              strokeWidth={lineVariant === "primary" ? 2 : lineVariant === "equal" ? 1.75 : 1.5}
              strokeOpacity={lineVariant === "primary" ? 1 : lineVariant === "equal" ? 0.9 : 0.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={renderEndpointMarker({
                color,
                variant: lineVariant,
                showLabel: shouldShowLatestValue && isPrimaryLine,
              })}
              activeDot={{
                r: lineVariant === "primary" ? 5 : 4,
                fill: color,
                stroke: "var(--card)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          );
        })}
      </LineChart>
    </ChartContainer>
  );
}

// ── Radar panel (always-visible, reused across layouts) ───────────────────────

function RadarPanel({ snapshot }: { snapshot: Snapshot }) {
  const combatStats = getCoreCombatStats(snapshot);
  const radarData = combatStats.map<CombatRadarDatum>((stat) => ({
    stat: stat.label,
    value: stat.percent,
    percentValue: stat.percent,
    ratingValue: stat.rating,
  }));
  const radarMax = Math.max(
    10,
    Math.ceil(Math.max(...radarData.map((stat) => stat.value)) / 5) * 5,
  );
  const tertiaryStats = getTertiaryStats(snapshot);
  const primaryStat = getPrimaryStat(snapshot);

  return (
    <div className="space-y-3">
      <ChartContainer config={radarConfig} className="h-[170px] w-full">
        <RadarChart data={radarData} margin={{ top: 14, right: 22, bottom: 14, left: 22 }}>
          <PolarGrid />
          <PolarRadiusAxis axisLine={false} tick={false} domain={[0, radarMax]} />
          <PolarAngleAxis dataKey="stat" tick={{ fontSize: 11 }} />
          <ChartTooltip cursor={false} content={<CombatRadarTooltip />} />
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
      <div className="space-y-1 text-sm">
        <StatRow label="Stamina" value={snapshot.stats.stamina.toLocaleString()} />
        {primaryStat && (
          <StatRow label={primaryStat.label} value={primaryStat.value.toLocaleString()} />
        )}
        <div className="border-t border-border/50 my-1" />
        {combatStats.map((stat) => (
          <StatRow key={stat.label} label={stat.label} value={renderCombatStatValue(stat)} />
        ))}
        {tertiaryStats.length > 0 && <div className="border-t border-border/50 my-1" />}
        {tertiaryStats.map((stat) => (
          <StatRow key={stat.label} label={stat.label} value={renderCombatStatValue(stat)} />
        ))}
      </div>
    </div>
  );
}

// Compact horizontal radar for Timeline layout
function RadarStrip({ snapshot }: { snapshot: Snapshot }) {
  const combatStats = getCoreCombatStats(snapshot);
  const radarData = combatStats.map<CombatRadarDatum>((stat) => ({
    stat: stat.label,
    value: stat.percent,
    percentValue: stat.percent,
    ratingValue: stat.rating,
  }));
  const radarMax = Math.max(
    10,
    Math.ceil(Math.max(...radarData.map((stat) => stat.value)) / 5) * 5,
  );
  const tertiaryStats = getTertiaryStats(snapshot);
  const primaryStat = getPrimaryStat(snapshot);
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center gap-6">
          <div className="shrink-0">
            <ChartContainer config={radarConfig} className="h-[150px] w-[150px]">
              <RadarChart data={radarData} margin={{ top: 12, right: 18, bottom: 12, left: 18 }}>
                <PolarGrid />
                <PolarRadiusAxis axisLine={false} tick={false} domain={[0, radarMax]} />
                <PolarAngleAxis dataKey="stat" tick={{ fontSize: 10 }} />
                <ChartTooltip cursor={false} content={<CombatRadarTooltip />} />
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
          <div className="flex-1 space-y-2">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
              {combatStats.map((stat) => (
                <StatRow key={stat.label} label={stat.label} value={renderCombatStatValue(stat)} />
              ))}
              <StatRow label="Stamina" value={snapshot.stats.stamina.toLocaleString()} />
              {primaryStat && (
                <StatRow label={primaryStat.label} value={primaryStat.value.toLocaleString()} />
              )}
            </div>
            {tertiaryStats.length > 0 && (
              <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 border-t border-border/50 pt-2 text-sm">
                {tertiaryStats.map((stat) => (
                  <StatRow
                    key={stat.label}
                    label={stat.label}
                    value={renderCombatStatValue(stat)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Chart cards used in Overview ──────────────────────────────────────────────

function IlvlChartCard({
  snapshots,
  timeFrame,
}: {
  snapshots: CoreChartSnapshot[];
  timeFrame: TimeFrame;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const data = snapshots.map((s) => ({ date: s.takenAt, itemLevel: s.itemLevel }));
  const lines = [{ key: "itemLevel", color: C.blue }];
  return (
    <Card>
      <CardHeader className="px-4 pb-0 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Sword size={14} className="text-muted-foreground" /> Item Level
          </CardTitle>
          <FullscreenButton onClick={() => setFullscreen(true)} />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2">
        <SnapshotLineChart
          data={data}
          lines={lines}
          config={ilvlConfig}
          valueFormatter={(v) => v.toFixed(1)}
          className="h-[150px]"
          yScaleOptions={ITEM_LEVEL_AUTO_SCALE}
          timeFrame={timeFrame}
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
            yScaleOptions={ITEM_LEVEL_AUTO_SCALE}
            timeFrame={timeFrame}
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}
function MplusChartCard({
  snapshots,
  timeFrame,
}: {
  snapshots: CoreChartSnapshot[];
  timeFrame: TimeFrame;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const data = snapshots.map((s) => ({ date: s.takenAt, mythicPlusScore: s.mythicPlusScore }));
  const lines = [{ key: "mythicPlusScore", color: C.red }];
  return (
    <Card>
      <CardHeader className="px-4 pb-0 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Flame size={14} className="text-muted-foreground" /> M+ Score
          </CardTitle>
          <FullscreenButton onClick={() => setFullscreen(true)} />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2">
        <SnapshotLineChart
          data={data}
          lines={lines}
          config={mplusConfig}
          valueFormatter={(v) => v.toLocaleString()}
          className="h-[150px]"
          yScaleOptions={MPLUS_AUTO_SCALE}
          timeFrame={timeFrame}
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
            yScaleOptions={MPLUS_AUTO_SCALE}
            timeFrame={timeFrame}
          />
        </FullscreenOverlay>
      )}
    </Card>
  );
}
function GoldChartCard({
  snapshots,
  timeFrame,
}: {
  snapshots: CoreChartSnapshot[];
  timeFrame: TimeFrame;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const data = snapshots.map((s) => ({ date: s.takenAt, gold: s.gold }));
  const lines = [{ key: "gold", color: C.gold }];
  return (
    <Card>
      <CardHeader className="px-4 pb-0 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Coins size={14} className="text-muted-foreground" /> Gold
          </CardTitle>
          <FullscreenButton onClick={() => setFullscreen(true)} />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2">
        <SnapshotLineChart
          data={data}
          lines={lines}
          config={goldConfig}
          valueFormatter={(v) => `${goldUnits(v).toLocaleString()}g`}
          className="h-[150px]"
          yScaleOptions={GOLD_SCALE}
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
            className="h-full"
            showLegend
            yScaleOptions={GOLD_SCALE}
            timeFrame={timeFrame}
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
  snapshots: StatsChartSnapshot[];
  timeFrame: TimeFrame;
  className?: string;
}) {
  const data = snapshots.map((s) => ({
    date: s.takenAt,
    critPercent: s.stats.critPercent,
    hastePercent: s.stats.hastePercent,
    masteryPercent: s.stats.masteryPercent,
    versatilityPercent: s.stats.versatilityPercent,
  }));
  const lines = [
    { key: "critPercent", color: C.red },
    { key: "hastePercent", color: C.green },
    { key: "masteryPercent", color: C.blue },
    { key: "versatilityPercent", color: C.purple },
  ];
  return (
    <Card className={className}>
      <CardHeader className="px-4 pb-0 pt-4">
        <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Zap size={14} className="text-muted-foreground" /> Secondary Stats
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2">
        <SnapshotLineChart
          data={data}
          lines={lines}
          config={secondaryStatsConfig}
          valueFormatter={(v) => `${v.toFixed(1)}%`}
          showLegend
          yScaleOptions={SECONDARY_STATS_SCALE}
          timeFrame={timeFrame}
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
  snapshots: CurrencyChartSnapshot[];
  timeFrame: TimeFrame;
  className?: string;
}) {
  const data = snapshots.map((s) => ({ date: s.takenAt, ...s.currencies }));
  const lines = [
    { key: "adventurerDawncrest", color: C.blue },
    { key: "veteranDawncrest", color: C.teal },
    { key: "championDawncrest", color: C.green },
    { key: "heroDawncrest", color: C.gold },
    { key: "mythDawncrest", color: C.red },
  ];
  return (
    <Card className={className}>
      <CardHeader className="px-4 pb-0 pt-4">
        <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Gem size={14} className="text-muted-foreground" /> Currencies
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2">
        <SnapshotLineChart
          data={data}
          lines={lines}
          config={currenciesConfig}
          className="h-[150px]"
          showLegend
          lineEmphasis="equal"
          yScaleOptions={CURRENCIES_SCALE}
          timeFrame={timeFrame}
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
  snapshots: CoreChartSnapshot[];
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
      <CardHeader className="px-4 pb-0 pt-4">
        <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Clock size={14} className="text-muted-foreground" /> Playtime
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-2">
        <SnapshotLineChart
          data={data}
          lines={lines}
          config={playtimeConfig}
          valueFormatter={(v) => formatHours(v)}
          yScaleOptions={PLAYTIME_SCALE}
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
      <CardHeader className="border-b px-4 pb-2 pt-4">
        <CardTitle className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Snapshot Totals
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 px-4 pb-4 pt-2">
        <StatRow label="Gold" value={<GoldDisplay value={snapshot.gold} />} />
        <StatRow
          label="Playtime"
          value={
            <PlaytimeBreakdown
              totalSeconds={snapshot.playtimeSeconds}
              thisLevelSeconds={snapshot.playtimeThisLevelSeconds}
              variant="compact"
              align="end"
            />
          }
        />
        <div className="border-t border-border/50 my-2" />
        <StatRow
          label="Adv. Crest"
          value={snapshot.currencies.adventurerDawncrest.toLocaleString()}
        />
        <StatRow label="Vet. Crest" value={snapshot.currencies.veteranDawncrest.toLocaleString()} />
        <StatRow
          label="Champ. Crest"
          value={snapshot.currencies.championDawncrest.toLocaleString()}
        />
        <StatRow label="Hero Crest" value={snapshot.currencies.heroDawncrest.toLocaleString()} />
        <StatRow label="Myth Crest" value={snapshot.currencies.mythDawncrest.toLocaleString()} />
      </CardContent>
    </Card>
  );
}

function OwnedKeystoneMetric({ keystone }: { keystone?: Snapshot["ownedKeystone"] }) {
  if (!keystone) {
    return <span className="text-base text-muted-foreground">None</span>;
  }

  const dungeonMeta = getMythicPlusDungeonMeta(keystone.mapChallengeModeID, keystone.mapName);
  const dungeonName = dungeonMeta?.name ?? keystone.mapName ?? "Unknown Dungeon";

  return (
    <div className="flex min-w-0 items-center gap-2 leading-tight" title={dungeonName}>
      <DungeonIcon mapChallengeModeID={keystone.mapChallengeModeID} mapName={keystone.mapName} />
      <div className="min-w-0">
        <div className="tabular-nums text-violet-300">{`+${keystone.level}`}</div>
        <div className="truncate text-xs font-medium text-muted-foreground">{dungeonName}</div>
      </div>
    </div>
  );
}

function DungeonIcon({
  mapChallengeModeID,
  mapName,
}: {
  mapChallengeModeID?: number | null;
  mapName?: string | null;
}) {
  const dungeonMeta = getMythicPlusDungeonMeta(mapChallengeModeID, mapName);
  const fallbackLabel = dungeonMeta?.shortName ?? mapName?.slice(0, 2).toUpperCase() ?? "M+";

  if (!dungeonMeta?.iconUrl) {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/30 text-[10px] font-semibold text-muted-foreground">
        {fallbackLabel}
      </span>
    );
  }

  return (
    <img
      src={dungeonMeta.iconUrl}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="h-6 w-6 shrink-0 rounded-md border border-border/60 object-cover"
    />
  );
}

// ── Snapshot history table ────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// Layout A — Overview
// Left sidebar: radar + current values (sticky)
// Right: time picker + chart grid
// ════════════════════════════════════════════════════════════════════════════

function OverviewLayout({
  latest,
  coreSnapshots,
  mythicPlus,
  mythicPlusIsLoadingAllRuns,
  requestAllMythicPlusRuns,
  characterRealm,
  characterRegion,
  timeFrame,
  setTimeFrame,
}: LayoutProps) {
  return (
    <div className="space-y-3">
      <div className="grid items-start gap-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Sidebar */}
        <div className="w-full space-y-3 lg:sticky lg:top-4">
          <Card>
            <CardHeader className="border-b px-4 pb-2 pt-4">
              <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <Zap size={14} className="text-muted-foreground" /> Combat Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-2">
              <RadarPanel snapshot={latest} />
            </CardContent>
          </Card>
          <CurrentSnapshotCard snapshot={latest} />
        </div>

        {/* Main charts */}
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <TimeFramePicker value={timeFrame} onChange={setTimeFrame} />
            <span className="text-muted-foreground text-xs">
              {coreSnapshots.length} point{coreSnapshots.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <IlvlChartCard snapshots={coreSnapshots} timeFrame={timeFrame} />
            <MplusChartCard snapshots={coreSnapshots} timeFrame={timeFrame} />
            <GoldChartCard snapshots={coreSnapshots} timeFrame={timeFrame} />
            <CurrenciesChartCard snapshots={coreSnapshots} timeFrame={timeFrame} />
          </div>

          <Suspense fallback={<MythicPlusSectionFallback />}>
            <LazyMythicPlusSection
              data={mythicPlus}
              isLoadingAllRuns={mythicPlusIsLoadingAllRuns ?? false}
              onRequestAllRuns={requestAllMythicPlusRuns ?? (() => undefined)}
              characterRealm={characterRealm}
              characterRegion={characterRegion}
            />
          </Suspense>
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
  { value: "ilvl", label: "Item Level", Icon: Sword },
  { value: "mplus", label: "M+ Score", Icon: Flame },
  { value: "gold", label: "Gold", Icon: Coins },
  { value: "stats", label: "Stats", Icon: Zap },
  { value: "currencies", label: "Currencies", Icon: Gem },
  { value: "playtime", label: "Playtime", Icon: Clock },
];

function FocusCurrentValue({ metric, snapshot }: { metric: FocusMetric; snapshot: Snapshot }) {
  switch (metric) {
    case "ilvl":
      return (
        <span className="text-4xl font-bold tabular-nums">{snapshot.itemLevel.toFixed(1)}</span>
      );
    case "mplus":
      return (
        <span className="text-4xl font-bold tabular-nums">
          {snapshot.mythicPlusScore.toLocaleString()}
        </span>
      );
    case "gold":
      return (
        <span className="text-2xl font-bold">
          <GoldDisplay value={snapshot.gold} />
        </span>
      );
    case "stats":
      return (
        <div className="flex flex-wrap gap-4 text-sm">
          {getCoreCombatStats(snapshot).map((stat) => (
            <span key={stat.label}>
              <span className="text-muted-foreground">{stat.label} </span>
              <strong className="tabular-nums">{renderCombatStatValue(stat)}</strong>
            </span>
          ))}
        </div>
      );
    case "currencies":
      return (
        <div className="flex flex-wrap gap-4 text-sm">
          {[
            { l: "Myth", v: snapshot.currencies.mythDawncrest },
            { l: "Hero", v: snapshot.currencies.heroDawncrest },
            { l: "Champion", v: snapshot.currencies.championDawncrest },
          ].map(({ l, v }) => (
            <span key={l}>
              <span className="text-muted-foreground">{l} </span>
              <strong className="tabular-nums">{v.toLocaleString()}</strong>
            </span>
          ))}
        </div>
      );
    case "playtime":
      return (
        <PlaytimeBreakdown
          totalSeconds={snapshot.playtimeSeconds}
          thisLevelSeconds={snapshot.playtimeThisLevelSeconds}
          variant="hero"
        />
      );
    default:
      return null;
  }
}

function FocusChart({
  metric,
  coreSnapshots,
  statsSnapshots,
  currencySnapshots,
  timeFrame,
}: {
  metric: FocusMetric;
  coreSnapshots: CoreChartSnapshot[];
  statsSnapshots?: StatsChartSnapshot[] | null;
  currencySnapshots?: CurrencyChartSnapshot[] | null;
  timeFrame: TimeFrame;
}) {
  const h = "h-[420px]";
  if (metric === "ilvl") {
    return (
      <SnapshotLineChart
        data={coreSnapshots.map((s) => ({ date: s.takenAt, itemLevel: s.itemLevel }))}
        lines={[{ key: "itemLevel", color: C.blue }]}
        config={ilvlConfig}
        valueFormatter={(v) => v.toFixed(1)}
        className={h}
        yScaleOptions={ITEM_LEVEL_AUTO_SCALE}
        timeFrame={timeFrame}
      />
    );
  }
  if (metric === "mplus") {
    return (
      <SnapshotLineChart
        data={coreSnapshots.map((s) => ({ date: s.takenAt, mythicPlusScore: s.mythicPlusScore }))}
        lines={[{ key: "mythicPlusScore", color: C.red }]}
        config={mplusConfig}
        valueFormatter={(v) => v.toLocaleString()}
        className={h}
        yScaleOptions={MPLUS_AUTO_SCALE}
        timeFrame={timeFrame}
      />
    );
  }
  if (metric === "gold") {
    return (
      <SnapshotLineChart
        data={coreSnapshots.map((s) => ({ date: s.takenAt, gold: s.gold }))}
        lines={[{ key: "gold", color: C.gold }]}
        config={goldConfig}
        valueFormatter={(v) => `${goldUnits(v).toLocaleString()}g`}
        className={h}
        yScaleOptions={GOLD_SCALE}
        timeFrame={timeFrame}
      />
    );
  }
  if (metric === "stats") {
    if (!statsSnapshots) {
      return (
        <div className={`${h} flex items-center justify-center text-sm text-muted-foreground`}>
          Loading stat history...
        </div>
      );
    }
    return (
      <SnapshotLineChart
        data={statsSnapshots.map((s) => ({
          date: s.takenAt,
          critPercent: s.stats.critPercent,
          hastePercent: s.stats.hastePercent,
          masteryPercent: s.stats.masteryPercent,
          versatilityPercent: s.stats.versatilityPercent,
        }))}
        lines={[
          { key: "critPercent", color: C.red },
          { key: "hastePercent", color: C.green },
          { key: "masteryPercent", color: C.blue },
          { key: "versatilityPercent", color: C.purple },
        ]}
        config={secondaryStatsConfig}
        valueFormatter={(v) => `${v.toFixed(1)}%`}
        className={h}
        showLegend
        yScaleOptions={SECONDARY_STATS_SCALE}
        timeFrame={timeFrame}
      />
    );
  }
  if (metric === "currencies") {
    if (!currencySnapshots) {
      return (
        <div className={`${h} flex items-center justify-center text-sm text-muted-foreground`}>
          Loading currency history...
        </div>
      );
    }
    return (
      <SnapshotLineChart
        data={currencySnapshots.map((s) => ({ date: s.takenAt, ...s.currencies }))}
        lines={[
          { key: "adventurerDawncrest", color: C.blue },
          { key: "veteranDawncrest", color: C.teal },
          { key: "championDawncrest", color: C.green },
          { key: "heroDawncrest", color: C.gold },
          { key: "mythDawncrest", color: C.red },
        ]}
        config={currenciesConfig}
        className={h}
        showLegend
        lineEmphasis="equal"
        yScaleOptions={CURRENCIES_SCALE}
        timeFrame={timeFrame}
      />
    );
  }
  if (metric === "playtime") {
    return (
      <SnapshotLineChart
        data={coreSnapshots.map((s) => ({
          date: s.takenAt,
          playtimeHours: Math.round(s.playtimeSeconds / 3600),
        }))}
        lines={[{ key: "playtimeHours", color: C.purple }]}
        config={playtimeConfig}
        valueFormatter={(v) => formatHours(v)}
        className={h}
        yScaleOptions={PLAYTIME_SCALE}
        timeFrame={timeFrame}
      />
    );
  }
  return null;
}

function FocusLayout({
  latest,
  coreSnapshots,
  statsSnapshots,
  currencySnapshots,
  timeFrame,
  setTimeFrame,
  metric,
  setMetric,
}: LayoutProps & {
  metric: FocusMetric;
  setMetric: (metric: FocusMetric) => void;
}) {
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
            {coreSnapshots.length} point{coreSnapshots.length !== 1 ? "s" : ""}
          </span>
        </div>
        <Card>
          <CardContent className="pt-4">
            <FocusChart
              metric={metric}
              coreSnapshots={coreSnapshots}
              statsSnapshots={statsSnapshots}
              currencySnapshots={currencySnapshots}
              timeFrame={timeFrame}
            />
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
              <StatGrid label="Item Level" value={latest.itemLevel.toFixed(1)} />
              <StatGrid label="M+ Score" value={latest.mythicPlusScore.toLocaleString()} />
              <StatGrid label="Gold" value={<GoldDisplay value={latest.gold} />} />
              <StatGrid
                label="Playtime"
                value={
                  <PlaytimeBreakdown
                    totalSeconds={latest.playtimeSeconds}
                    thisLevelSeconds={latest.playtimeThisLevelSeconds}
                    variant="compact"
                    align="center"
                  />
                }
              />
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

function TimelineLayout({
  latest,
  coreSnapshots,
  statsSnapshots,
  currencySnapshots,
  timeFrame,
  setTimeFrame,
}: LayoutProps) {
  const chartH = "h-[260px]";

  return (
    <div className="space-y-4">
      {/* Time picker — prominent at top */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <TimeFramePicker value={timeFrame} onChange={setTimeFrame} />
        <span className="text-muted-foreground text-xs">
          {coreSnapshots.length} point{coreSnapshots.length !== 1 ? "s" : ""}
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
            data={coreSnapshots.map((s) => ({ date: s.takenAt, itemLevel: s.itemLevel }))}
            lines={[{ key: "itemLevel", color: C.blue }]}
            config={ilvlConfig}
            valueFormatter={(v) => v.toFixed(1)}
            className={chartH}
            yScaleOptions={ITEM_LEVEL_AUTO_SCALE}
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
            data={coreSnapshots.map((s) => ({
              date: s.takenAt,
              mythicPlusScore: s.mythicPlusScore,
            }))}
            lines={[{ key: "mythicPlusScore", color: C.red }]}
            config={mplusConfig}
            valueFormatter={(v) => v.toLocaleString()}
            className={chartH}
            yScaleOptions={MPLUS_AUTO_SCALE}
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
            data={coreSnapshots.map((s) => ({ date: s.takenAt, gold: s.gold }))}
            lines={[{ key: "gold", color: C.gold }]}
            config={goldConfig}
            valueFormatter={(v) => `${goldUnits(v).toLocaleString()}g`}
            className={chartH}
            yScaleOptions={GOLD_SCALE}
            timeFrame={timeFrame}
          />
        </CardContent>
      </Card>

      {statsSnapshots ? (
        <SecondaryStatsChartCard snapshots={statsSnapshots} timeFrame={timeFrame} />
      ) : (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Zap size={14} className="text-muted-foreground" /> Secondary Stats
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Loading stat history...
          </CardContent>
        </Card>
      )}
      {currencySnapshots ? (
        <CurrenciesChartCard snapshots={currencySnapshots} timeFrame={timeFrame} />
      ) : (
        <Card>
          <CardHeader className="px-4 pb-0 pt-4">
            <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Gem size={14} className="text-muted-foreground" /> Currencies
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-2 text-sm text-muted-foreground">
            Loading currency history...
          </CardContent>
        </Card>
      )}
      <PlaytimeChartCard snapshots={coreSnapshots} timeFrame={timeFrame} />
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
  {
    label: "Mythic Planner",
    color: "hover:text-cyan-400",
    url: (region: string, realm: string, name: string) =>
      `https://mythicplanner.com/share/${region}/${encodeURIComponent(realm.toLowerCase())}/${encodeURIComponent(name)}/3500?maxKeyLevel=18`,
  },
] as const;

function CharacterLinks({ region, realm, name }: { region: string; realm: string; name: string }) {
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

function MythicPlusSectionFallback() {
  return (
    <Card>
      <CardHeader className="border-b pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <History size={16} className="text-muted-foreground" />
          Mythic+ History
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 text-sm text-muted-foreground">
        Loading Mythic+ details...
      </CardContent>
    </Card>
  );
}

type CharacterPageContentProps = {
  latest: Snapshot;
  coreSnapshots: CoreChartSnapshot[];
  statsSnapshots: StatsChartSnapshot[] | null;
  currencySnapshots: CurrencyChartSnapshot[] | null;
  mythicPlusData: MythicPlusData | null | undefined;
  isLoadingAllMythicPlusRuns: boolean;
  onRequestAllMythicPlusRuns: () => void;
  characterId: string;
  characterName: string;
  characterRealm: string;
  characterRegion: string;
  currentMythicPlusScore: number | null;
  timeFrame: TimeFrame;
  onTimeFrameChange: (timeFrame: TimeFrame) => void;
  layoutMode: LayoutMode;
  focusMetric: FocusMetric;
  onFocusMetricChange: (metric: FocusMetric) => void;
};

const CharacterPageContent = memo(function CharacterPageContent({
  latest,
  coreSnapshots,
  statsSnapshots,
  currencySnapshots,
  mythicPlusData,
  isLoadingAllMythicPlusRuns,
  onRequestAllMythicPlusRuns,
  characterId,
  characterName,
  characterRealm,
  characterRegion,
  currentMythicPlusScore,
  timeFrame,
  onTimeFrameChange,
  layoutMode,
  focusMetric,
  onFocusMetricChange,
}: CharacterPageContentProps) {
  const layoutProps: LayoutProps = {
    latest,
    coreSnapshots,
    statsSnapshots,
    currencySnapshots,
    mythicPlus: mythicPlusData,
    mythicPlusIsLoadingAllRuns: isLoadingAllMythicPlusRuns,
    requestAllMythicPlusRuns: onRequestAllMythicPlusRuns,
    characterId,
    characterName,
    characterRealm,
    characterRegion,
    currentMythicPlusScore,
    timeFrame,
    setTimeFrame: onTimeFrameChange,
  };

  return (
    <>
      {layoutMode === "overview" && <OverviewLayout {...layoutProps} />}
      {layoutMode === "focus" && (
        <FocusLayout {...layoutProps} metric={focusMetric} setMetric={onFocusMetricChange} />
      )}
      {layoutMode === "timeline" && <TimelineLayout {...layoutProps} />}

      {layoutMode !== "overview" && (
        <Suspense fallback={<MythicPlusSectionFallback />}>
          <LazyMythicPlusSection
            data={mythicPlusData}
            isLoadingAllRuns={isLoadingAllMythicPlusRuns}
            onRequestAllRuns={onRequestAllMythicPlusRuns}
            characterRealm={characterRealm}
            characterRegion={characterRegion}
          />
        </Suspense>
      )}
    </>
  );
});

function CharacterPageState({
  title,
  description,
  isLoading = false,
}: {
  title: string;
  description: string;
  isLoading?: boolean;
}) {
  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <Card className="border-border/60 bg-background">
        <CardContent className="space-y-4 px-6 py-6">
          {isLoading ? (
            <>
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-full max-w-md" />
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-24 rounded-md" />
                ))}
              </div>
            </>
          ) : (
            <>
              <CardTitle className="text-xl font-semibold tracking-tight">{title}</CardTitle>
              <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RouteComponent() {
  const queryClient = useQueryClient();
  const { characterId } = Route.useParams();
  const [timeFrame, setTimeFrame] = useState<TimeFrame>(DEFAULT_TIME_FRAME);
  const { pinnedCharacterIdSet, togglePinnedCharacter } = usePinnedCharacters();
  const [discordUserIdInput, setDiscordUserIdInput] = useState("");
  const [nonTradeableSlotsDraft, setNonTradeableSlotsDraft] = useState<TradeSlotKey[]>([]);
  const [isSavingDiscordUserId, setIsSavingDiscordUserId] = useState(false);
  const [isUpdatingBooster, setIsUpdatingBooster] = useState(false);
  const [isSavingTradeSlots, setIsSavingTradeSlots] = useState(false);
  const [isDiscordSheetOpen, setIsDiscordSheetOpen] = useState(false);
  const [focusMetric, setFocusMetric] = useState<FocusMetric>("ilvl");
  const [shouldLoadFullMythicPlusRuns, setShouldLoadFullMythicPlusRuns] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    try {
      return (localStorage.getItem("wow-char-layout") as LayoutMode) ?? "overview";
    } catch {
      return "overview";
    }
  });
  const characterPageQuery = useQuery(getCharacterPageQueryOptions(characterId, timeFrame));
  const characterPage = characterPageQuery.data;
  const pageHeader = characterPage?.header;
  const mythicPlusAllRuns = useQuery({
    ...getCharacterMythicPlusAllRunsQueryOptions(characterId),
    enabled: shouldLoadFullMythicPlusRuns,
  }).data;
  const needsStatsTimeline =
    layoutMode === "timeline" || (layoutMode === "focus" && focusMetric === "stats");
  const needsCurrencyTimeline =
    layoutMode === "timeline" || (layoutMode === "focus" && focusMetric === "currencies");
  const statsTimeline = useQuery({
    ...getCharacterStatsTimelineQueryOptions(characterId, timeFrame),
    enabled: needsStatsTimeline,
  }).data;

  useEffect(() => {
    setDiscordUserIdInput(pageHeader?.owner?.discordUserId ?? "");
  }, [characterId, pageHeader?.owner?.discordUserId]);

  useEffect(() => {
    setShouldLoadFullMythicPlusRuns(false);
  }, [characterId]);

  useEffect(() => {
    setNonTradeableSlotsDraft(
      normalizeTradeSlotKeys((pageHeader?.character.nonTradeableSlots ?? []) as TradeSlotKey[]),
    );
  }, [characterId, pageHeader?.character.nonTradeableSlots]);

  useEffect(() => {
    const appTitle = "WoW Dashboard";
    if (characterPage === undefined) {
      document.title = `Character | ${appTitle}`;
      return;
    }
    if (characterPage === null) {
      document.title = `Character Not Found | ${appTitle}`;
      return;
    }

    document.title = `${characterPage.header.character.name} (${characterPage.header.character.realm}) | ${appTitle}`;
  }, [characterPage]);

  function handleLayoutChange(mode: LayoutMode) {
    if (mode !== "overview") {
      void import("../components/character-page-mythic-plus-section");
    }
    if (mode === "timeline" || (mode === "focus" && focusMetric === "stats")) {
      void queryClient.prefetchQuery(getCharacterStatsTimelineQueryOptions(characterId, timeFrame));
    }
    startTransition(() => {
      setLayoutMode(mode);
    });
    try {
      localStorage.setItem("wow-char-layout", mode);
    } catch {
      /* ignore */
    }
  }

  const handleTimeFrameChange = useCallback((nextFrame: TimeFrame) => {
    startTransition(() => {
      setTimeFrame(nextFrame);
    });
  }, []);

  const handleFocusMetricChange = useCallback(
    (metric: FocusMetric) => {
      if (layoutMode === "focus" && metric === "stats") {
        void queryClient.prefetchQuery(
          getCharacterStatsTimelineQueryOptions(characterId, timeFrame),
        );
      }
      startTransition(() => {
        setFocusMetric(metric);
      });
    },
    [characterId, layoutMode, queryClient, timeFrame],
  );

  const handleRequestAllMythicPlusRuns = useCallback(() => {
    void queryClient.prefetchQuery(getCharacterMythicPlusAllRunsQueryOptions(characterId));
    startTransition(() => {
      setShouldLoadFullMythicPlusRuns(true);
    });
  }, [characterId, queryClient]);

  const baseMythicPlusData = (characterPage?.mythicPlus ?? null) as MythicPlusData | null;
  const mythicPlusData = useMemo(() => {
    if (!baseMythicPlusData) {
      return baseMythicPlusData;
    }
    return {
      ...baseMythicPlusData,
      runs: mythicPlusAllRuns?.runs ?? baseMythicPlusData.runs,
      totalRunCount: mythicPlusAllRuns?.totalRunCount ?? baseMythicPlusData.totalRunCount,
      isPreview: mythicPlusAllRuns ? false : baseMythicPlusData.isPreview,
    };
  }, [baseMythicPlusData, mythicPlusAllRuns]);

  const invalidateCharacterPageQueries = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ["api", "characters", characterId, "page"],
    });
  }, [characterId, queryClient]);

  const invalidateBoosterExportQueries = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: apiQueryKeys.boosterCharactersForExport(),
    });
  }, [queryClient]);

  const invalidateOwnerQueries = useCallback(async () => {
    const ownerPlayerId = characterPage?.header.owner?.playerId;
    if (!ownerPlayerId) {
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: apiQueryKeys.playerCharacters(ownerPlayerId),
    });
  }, [characterPage?.header.owner?.playerId, queryClient]);

  const setCharacterBoosterStatus = useMutation({
    mutationFn: (isBooster: boolean) =>
      apiClient.updateCharacterBoosterStatus(characterId, {
        isBooster,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateCharacterPageQueries(),
        invalidateBoosterExportQueries(),
        queryClient.invalidateQueries({ queryKey: apiQueryKeys.myCharacters() }),
      ]);
    },
  });

  const setCharacterNonTradeableSlots = useMutation({
    mutationFn: (draftSlots: TradeSlotKey[]) =>
      apiClient.updateCharacterNonTradeableSlots(characterId, {
        nonTradeableSlots: draftSlots,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateCharacterPageQueries(),
        invalidateBoosterExportQueries(),
        invalidateOwnerQueries(),
      ]);
    },
  });

  const setPlayerDiscordUserId = useMutation({
    mutationFn: ({ playerId, discordUserId }: { playerId: string; discordUserId: string | null }) =>
      apiClient.updatePlayerDiscordUserId(playerId, { discordUserId }),
    onSuccess: async () => {
      await Promise.all([
        invalidateCharacterPageQueries(),
        invalidateBoosterExportQueries(),
        invalidateOwnerQueries(),
      ]);
    },
  });

  if (characterPageQuery.isError) {
    return (
      <CharacterPageState
        title="Character could not be loaded"
        description={
          characterPageQuery.error instanceof Error
            ? characterPageQuery.error.message
            : "The character request failed."
        }
      />
    );
  }

  if (characterPage === undefined) {
    return (
      <CharacterPageState
        title="Loading character"
        description="Fetching the latest character snapshot."
        isLoading
      />
    );
  }

  if (characterPage === null) {
    return (
      <CharacterPageState
        title="Character not found"
        description="This character is no longer available or has not been imported."
      />
    );
  }

  const { header, coreTimeline } = characterPage;
  const { character, latestSnapshot, firstSnapshotAt, snapshotCount } = header;
  const owner = header.owner;
  const isPinnedToQuickAccess = pinnedCharacterIdSet.has(characterId);
  const isBoosterCharacter = character.isBooster === true;
  const nonTradeableSlots = (character.nonTradeableSlots ?? []) as TradeSlotKey[];
  const isLoadingAllMythicPlusRuns =
    shouldLoadFullMythicPlusRuns && mythicPlusAllRuns === undefined;
  const normalizedDiscordUserIdInput = discordUserIdInput.trim();
  const hasDiscordUserIdChanges = normalizedDiscordUserIdInput !== (owner?.discordUserId ?? "");
  const hasTradeSlotChanges =
    JSON.stringify(nonTradeableSlotsDraft) !== JSON.stringify(nonTradeableSlots);

  const latest = (latestSnapshot as Snapshot | null) ?? null;
  const coreSnapshots = (coreTimeline?.snapshots ?? []) as CoreChartSnapshot[];
  const statsSnapshots =
    needsStatsTimeline && statsTimeline ? (statsTimeline.snapshots as StatsChartSnapshot[]) : null;
  const currencySnapshots = needsCurrencyTimeline
    ? (coreSnapshots as CurrencyChartSnapshot[])
    : null;
  const lastMythicPlusRunAt = mythicPlusData?.summary.overall.lastRunAt ?? null;
  const trackingCountLabel = snapshotCount === null ? "Tracked Points" : "Snapshots";
  const trackingCountValue =
    snapshotCount === null ? coreSnapshots.length.toLocaleString() : snapshotCount.toLocaleString();

  async function handleBoosterToggle() {
    if (isUpdatingBooster) {
      return;
    }

    setIsUpdatingBooster(true);
    try {
      await setCharacterBoosterStatus.mutateAsync(!isBoosterCharacter);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update booster flag.");
    } finally {
      setIsUpdatingBooster(false);
    }
  }

  async function handleDiscordUserIdSave() {
    if (!owner || isSavingDiscordUserId || !hasDiscordUserIdChanges) {
      return;
    }

    setIsSavingDiscordUserId(true);
    try {
      await setPlayerDiscordUserId.mutateAsync({
        playerId: owner.playerId,
        discordUserId: normalizedDiscordUserIdInput === "" ? null : normalizedDiscordUserIdInput,
      });
      setIsDiscordSheetOpen(false);
      toast.success(
        normalizedDiscordUserIdInput === "" ? "Discord ID cleared." : "Discord ID saved.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save Discord ID.");
    } finally {
      setIsSavingDiscordUserId(false);
    }
  }

  function toggleNonTradeableSlot(slotKeys: readonly TradeSlotKey[]) {
    setNonTradeableSlotsDraft((currentSlots) => toggleTradeSlotGroup(currentSlots, slotKeys));
  }

  async function handleTradeSlotSave() {
    if (isSavingTradeSlots || !hasTradeSlotChanges) {
      return;
    }

    setIsSavingTradeSlots(true);
    try {
      await setCharacterNonTradeableSlots.mutateAsync(nonTradeableSlotsDraft);
      toast.success(
        nonTradeableSlotsDraft.length === 0
          ? "All slots marked tradeable."
          : "Trade-lock slots saved.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save trade-lock slots.");
    } finally {
      setIsSavingTradeSlots(false);
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8 space-y-4">
      {/* Character header */}
      <Card className="overflow-hidden border-border/60 bg-background">
        <CardHeader className="border-b border-border/60 bg-background pb-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-4">
              {latest && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-border/60 bg-card uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {character.region.toUpperCase()}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-border/60 bg-card uppercase tracking-[0.18em] text-muted-foreground"
                  >
                    {ROLE_LABELS[latest.role] ?? latest.role}
                  </Badge>
                </div>
              )}
              <CardTitle
                className={`text-3xl font-bold tracking-tight sm:text-4xl ${classColor(character.class)}`}
              >
                {character.name}
              </CardTitle>
              <p className="hidden">
                {character.race} {character.class} — {character.realm}-
                {character.region.toUpperCase()}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                <span>
                  {character.race} {character.class}
                </span>
                <span className="h-1 w-1 rounded-full bg-border/80" />
                <span>
                  {character.realm}-{character.region.toUpperCase()}
                </span>
              </div>
              <div className="max-w-3xl">
                <CharacterLinks
                  region={character.region}
                  realm={character.realm}
                  name={character.name}
                />
              </div>
            </div>
            <div className="flex w-full max-w-md flex-col gap-3 self-start xl:items-end">
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => togglePinnedCharacter(characterId)}
                  className={
                    isPinnedToQuickAccess
                      ? "border-yellow-400/40 bg-yellow-400/10 text-yellow-300 hover:bg-yellow-400/15 hover:text-yellow-200"
                      : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                  }
                >
                  <Star
                    size={14}
                    className={isPinnedToQuickAccess ? "fill-current text-yellow-400" : ""}
                  />
                  {isPinnedToQuickAccess ? "Pinned" : "Pin"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleBoosterToggle}
                  disabled={isUpdatingBooster}
                  className={
                    isBoosterCharacter
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15 hover:text-emerald-200"
                      : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
                  }
                >
                  <Zap size={14} className={isBoosterCharacter ? "text-emerald-300" : ""} />
                  {isBoosterCharacter ? "Booster" : "Set Booster"}
                </Button>
                {owner && !owner.discordUserId && (
                  <Sheet open={isDiscordSheetOpen} onOpenChange={setIsDiscordSheetOpen}>
                    <SheetTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-orange-500/40 bg-orange-500/10 text-orange-200 hover:bg-orange-500/15 hover:text-orange-100"
                      >
                        Set Discord ID
                      </Button>
                    </SheetTrigger>
                    <SheetContent className="w-full sm:max-w-md">
                      <SheetHeader>
                        <SheetTitle>Owner Discord ID</SheetTitle>
                        <SheetDescription>
                          Shared across all characters for {owner.battleTag || character.name}.
                        </SheetDescription>
                      </SheetHeader>
                      <div className="mt-6 space-y-3">
                        <Input
                          value={discordUserIdInput}
                          onChange={(event) => setDiscordUserIdInput(event.target.value)}
                          placeholder="Discord user ID or <@mention>"
                          className="h-9"
                        />
                        <p className="text-xs text-muted-foreground">
                          Stored globally on the account owner and used by Copy Helper exports.
                        </p>
                        <Button
                          type="button"
                          onClick={handleDiscordUserIdSave}
                          disabled={!hasDiscordUserIdChanges || isSavingDiscordUserId}
                        >
                          {isSavingDiscordUserId ? "Saving..." : "Save Discord ID"}
                        </Button>
                      </div>
                    </SheetContent>
                  </Sheet>
                )}
                <Sheet>
                  <SheetTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-border/60 bg-card text-muted-foreground hover:text-foreground"
                    >
                      Trade Locks
                      {nonTradeableSlots.length > 0
                        ? ` ${getTradeSlotEditorCount(nonTradeableSlots)}`
                        : ""}
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="w-full sm:max-w-lg">
                    <SheetHeader>
                      <SheetTitle>Non-Tradeable Slots</SheetTitle>
                      <SheetDescription>
                        Mark the slots this character cannot trade. This is stored globally per
                        character and shown in Copy Helper.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="mt-6 space-y-5">
                      <div className="grid gap-3 sm:grid-cols-2">
                        {TRADE_SLOT_EDITOR_OPTIONS.map((slot) => (
                          <label
                            key={slot.key}
                            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-card/50 p-3"
                          >
                            <Checkbox
                              checked={slot.slotKeys.every((slotKey) =>
                                nonTradeableSlotsDraft.includes(slotKey),
                              )}
                              onCheckedChange={() => toggleNonTradeableSlot(slot.slotKeys)}
                            />
                            <div>
                              <p className="text-sm font-medium text-foreground">{slot.label}</p>
                              <p className="text-xs text-muted-foreground">
                                Drop in this slot stays bound.
                              </p>
                            </div>
                          </label>
                        ))}
                      </div>
                      {nonTradeableSlotsDraft.length === 0 ? (
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                          No locked slots. This character is marked as able to trade all tracked
                          slots.
                        </div>
                      ) : (
                        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3 text-sm text-orange-200">
                          Locked slots:{" "}
                          {getTradeSlotExportLabels(nonTradeableSlotsDraft).join(", ")}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setNonTradeableSlotsDraft([])}
                          disabled={nonTradeableSlotsDraft.length === 0}
                        >
                          Clear All
                        </Button>
                        <Button
                          type="button"
                          onClick={handleTradeSlotSave}
                          disabled={!hasTradeSlotChanges || isSavingTradeSlots}
                        >
                          {isSavingTradeSlots ? "Saving..." : "Save Slots"}
                        </Button>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
                <LayoutSwitcher value={layoutMode} onChange={handleLayoutChange} />
                <Badge
                  variant="outline"
                  className={
                    character.faction === "alliance"
                      ? "border-blue-500/40 bg-blue-500/10 text-blue-400 uppercase tracking-wider"
                      : "border-red-500/40 bg-red-500/10 text-red-400 uppercase tracking-wider"
                  }
                >
                  {character.faction}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>

        {latest && (
          <CardContent className="px-6 pb-5 pt-4">
            <div className="grid gap-3 xl:grid-cols-4">
              <TopMetricCard
                label="Item level"
                meta="Equipped"
                value={<span className="tabular-nums">{latest.itemLevel.toFixed(1)}</span>}
              />
              <TopMetricCard
                label="M+ score"
                meta="Current"
                value={
                  <span className="tabular-nums">{latest.mythicPlusScore.toLocaleString()}</span>
                }
              />
              <TopMetricCard
                label="Keystone"
                meta="Owned"
                value={<OwnedKeystoneMetric keystone={latest.ownedKeystone} />}
              />
              <TopMetricCard
                label="Playtime"
                meta="Total / this lvl"
                value={
                  <span className="tabular-nums text-[1.05rem] leading-none">
                    {formatPlaytime(latest.playtimeSeconds)}
                    <span className="px-2 text-muted-foreground/45">/</span>
                    <span className="text-foreground/90">
                      {latest.playtimeThisLevelSeconds === undefined
                        ? "--"
                        : formatPlaytime(latest.playtimeThisLevelSeconds)}
                    </span>
                  </span>
                }
              />
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border border-border/60 bg-card px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/75">
                  Character
                </div>
                <div className="mt-3 space-y-2">
                  <StatRow label="Race" value={character.race} />
                  <StatRow label="Class" value={character.class} />
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-card px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/75">
                  Server
                </div>
                <div className="mt-3 space-y-2">
                  <StatRow label="Server" value={character.realm} />
                  <StatRow label="Region" value={character.region.toUpperCase()} />
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-card px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/75">
                  Tracking
                </div>
                <div className="mt-3 space-y-2">
                  <StatRow label="Since" value={formatDate(firstSnapshotAt ?? latest.takenAt)} />
                  <StatRow label={trackingCountLabel} value={trackingCountValue} />
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-card px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/75">
                  Activity
                </div>
                <div className="mt-3 space-y-2">
                  <StatRow label="Last Snapshot" value={formatCardDateTime(latest.takenAt)} />
                  <StatRow
                    label="Last M+ Run"
                    value={
                      mythicPlusData === undefined
                        ? "Loading..."
                        : lastMythicPlusRunAt
                          ? formatCardDateTime(lastMythicPlusRunAt)
                          : "No runs"
                    }
                  />
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>
      {/* Active layout */}
      {latest && coreSnapshots.length > 0 ? (
        <CharacterPageContent
          latest={latest}
          coreSnapshots={coreSnapshots}
          statsSnapshots={statsSnapshots}
          currencySnapshots={currencySnapshots}
          mythicPlusData={mythicPlusData}
          isLoadingAllMythicPlusRuns={isLoadingAllMythicPlusRuns}
          onRequestAllMythicPlusRuns={handleRequestAllMythicPlusRuns}
          characterId={characterId}
          characterName={character.name}
          characterRealm={character.realm}
          characterRegion={character.region}
          currentMythicPlusScore={
            mythicPlusData?.summary.currentScore ?? latest?.mythicPlusScore ?? null
          }
          timeFrame={timeFrame}
          onTimeFrameChange={handleTimeFrameChange}
          layoutMode={layoutMode}
          focusMetric={focusMetric}
          onFocusMetricChange={handleFocusMetricChange}
        />
      ) : (
        <Card className="border-border/60 bg-background">
          <CardContent className="px-6 py-6">
            <CardTitle className="text-lg font-semibold tracking-tight">
              No snapshots available
            </CardTitle>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              This character exists, but there is no timeline data to chart yet.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
