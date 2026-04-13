import { createFileRoute } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import type { Id } from "@wow-dashboard/backend/convex/_generated/dataModel";
import {
  getMythicPlusDungeonMeta,
  getMythicPlusDungeonTimerMs,
  getRaiderIoScoreColor,
} from "../lib/mythic-plus-static";
import { getClassTextColor } from "../lib/class-colors";
import { usePinnedCharacters } from "../lib/pinned-characters";
import { formatPlaytime, PlaytimeBreakdown } from "../components/playtime-breakdown";
import { MythicPlannerPanel } from "../components/mythic-planner-panel";
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
import { useMutation, useQuery } from "convex/react";
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
  Eye,
  EyeOff,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { toast } from "sonner";
import {
  getTradeSlotExportLabels,
  getTradeSlotEditorCount,
  TRADE_SLOT_EDITOR_OPTIONS,
  normalizeTradeSlotKeys,
  toggleTradeSlotGroup,
  type TradeSlotKey,
} from "../lib/trade-slots";

export const Route = createFileRoute("/character/$characterId")({
  component: RouteComponent,
});

// ── Constants ────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = { tank: "Tank", healer: "Healer", dps: "DPS" };
const INITIAL_RECENT_RUN_COUNT = 20;
const RECENT_RUN_LOAD_INCREMENT = 20;
const RUN_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const RUN_FULL_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const CARD_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// ── Time frame ───────────────────────────────────────────────────────────────

type TimeFrame = "7d" | "30d" | "90d" | "all";

const TIME_FRAME_OPTIONS: { value: TimeFrame; label: string }[] = [
  { value: "7d", label: "7D" },
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
  if (!durationMs || durationMs <= 0 || durationMs > MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS) {
    return "—";
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS = 4 * 60 * 60 * 1000;

function getRunDurationMs(run: MythicPlusRun): number | undefined {
  if (
    run.durationMs !== undefined &&
    run.durationMs > 0 &&
    run.durationMs <= MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS
  ) {
    return run.durationMs;
  }

  const runEndAt = run.endedAt ?? run.abandonedAt ?? run.completedAt;
  if (
    run.startDate !== undefined &&
    runEndAt !== undefined &&
    runEndAt >= run.startDate
  ) {
    const derivedDurationMs = (runEndAt - run.startDate) * 1000;
    if (
      Number.isFinite(derivedDurationMs) &&
      derivedDurationMs > 0 &&
      derivedDurationMs <= MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS
    ) {
      return derivedDurationMs;
    }
  }

  return undefined;
}

function formatRunTimeComparison(run: MythicPlusRun) {
  if (getMythicPlusRunStatus(run) === "active") {
    return "In progress";
  }

  const actualTime = formatRunDuration(getRunDurationMs(run));
  const timerMs = getMythicPlusDungeonTimerMs(run.mapChallengeModeID, run.mapName);
  if (timerMs === null || timerMs === undefined) {
    return actualTime;
  }

  const maxTime = formatRunDuration(timerMs);
  return `${actualTime} / ${maxTime}`;
}

function formatKeyLevel(level?: number | null) {
  if (level === undefined || level === null) return "—";
  return `+${level}`;
}

function formatTimedKeyLevel(level?: number | null, upgradeCount?: number | null) {
  if (level === undefined || level === null) return "-";
  const normalizedUpgradeCount = Math.max(1, Math.min(3, upgradeCount ?? 1));
  return `${"+".repeat(normalizedUpgradeCount)}${level}`;
}

function formatRunScore(value?: number | null) {
  if (value === undefined || value === null) return "-";
  const hasFraction = Math.abs(value % 1) > 0.001;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: hasFraction ? 1 : 0,
    maximumFractionDigits: 1,
  });
}

function formatRunScoreIncrease(value?: number | null) {
  if (value === undefined || value === null || value <= 0) return null;
  const hasFraction = Math.abs(value % 1) > 0.001;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: hasFraction ? 1 : 0,
    maximumFractionDigits: 1,
  });
}

function formatRunTime(ts?: number | null) {
  if (!ts) return "--";
  return RUN_TIME_FORMATTER.format(new Date(ts * 1000));
}

function formatRunDateTime(ts?: number | null) {
  if (!ts) return "--";
  return RUN_FULL_DATE_TIME_FORMATTER.format(new Date(ts * 1000));
}

function formatCardDateTime(ts?: number | null) {
  if (!ts) return "--";
  return CARD_DATE_TIME_FORMATTER.format(new Date(ts * 1000));
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

function getMythicPlusRunStatus(run: MythicPlusRun): MythicPlusRun["status"] | undefined {
  if (run.status === "active" || run.status === "completed" || run.status === "abandoned") {
    return run.status;
  }

  if (
    run.completed === true ||
    getRunDurationMs(run) !== undefined ||
    run.runScore !== undefined ||
    run.completedAt !== undefined
  ) {
    return "completed";
  }

  if (
    run.abandonedAt !== undefined ||
    run.abandonReason !== undefined ||
    (run.endedAt !== undefined &&
      run.durationMs === undefined &&
      run.runScore === undefined &&
      run.completedAt === undefined)
  ) {
    return "abandoned";
  }

  return undefined;
}

function isCompletedMythicPlusRun(run: MythicPlusRun) {
  return getMythicPlusRunStatus(run) === "completed";
}

function getMythicPlusRunTimedState(run: MythicPlusRun): boolean | null {
  if (getMythicPlusRunStatus(run) !== "completed") {
    return null;
  }
  if (run.upgradeCount !== undefined && run.upgradeCount !== null) {
    return run.upgradeCount > 0;
  }
  if (run.completedInTime !== undefined) {
    return run.completedInTime;
  }

  return null;
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
      <div className="mt-3 min-w-0 text-xl font-semibold leading-none text-foreground">
        {value}
      </div>
    </div>
  );
}

function MythicPlusKeyPill({
  level,
  upgradeCount,
  compact = false,
}: {
  level?: number | null;
  upgradeCount?: number | null;
  compact?: boolean;
}) {
  if (level === undefined || level === null) {
    return <span className="text-muted-foreground">-</span>;
  }

  const normalizedUpgradeCount = Math.max(1, Math.min(3, upgradeCount ?? 1));

  return (
    <span
      className={`inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 font-semibold tabular-nums text-emerald-200 ${
        compact ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
      }`}
      title={normalizedUpgradeCount > 1 ? `Timed for +${normalizedUpgradeCount}` : "Timed"}
    >
      {formatTimedKeyLevel(level, normalizedUpgradeCount)}
    </span>
  );
}

function getRunPlayedAt(run: MythicPlusRun) {
  if (run.playedAt !== undefined) {
    return run.playedAt;
  }
  if (run.sortTimestamp !== undefined) {
    return run.sortTimestamp;
  }

  return run.observedAt;
}

function getRecentRunRowKey(run: MythicPlusRun) {
  if (typeof run.rowKey === "string" && run.rowKey.trim() !== "") {
    return run.rowKey;
  }

  if (typeof run._id === "string" && run._id.trim() !== "") {
    return run._id;
  }

  const identityTokens: string[] = [];
  const explicitAttemptId = run.attemptId?.trim();
  if (explicitAttemptId) {
    identityTokens.push(`aid:${explicitAttemptId}`);
  }

  const explicitCanonicalKey = run.canonicalKey?.trim();
  if (explicitCanonicalKey) {
    identityTokens.push(`ck:${explicitCanonicalKey}`);
  }

  const normalizedFingerprint = run.fingerprint?.trim();
  if (normalizedFingerprint) {
    identityTokens.push(`fp:${normalizedFingerprint}`);
  }

  const identityKey = identityTokens.length > 0 ? identityTokens.join("|") : "run";
  return `${identityKey}|${getRunPlayedAt(run) ?? 0}`;
}

function formatRunMemberName(member: MythicPlusRunMember, characterRealm: string) {
  if (!member.realm || member.realm.trim().toLowerCase() === characterRealm.trim().toLowerCase()) {
    return member.name;
  }

  return `${member.name}-${member.realm}`;
}

function getRunMemberRoleSortOrder(member: MythicPlusRunMember) {
  const normalizedRole = member.role?.trim().toLowerCase();
  if (normalizedRole === "tank") return 0;
  if (normalizedRole === "dps") return 1;
  if (normalizedRole === "healer") return 2;
  return 3;
}

function getDisplayedRunMembers(members: MythicPlusRunMember[] | undefined) {
  if (!members || members.length === 0) {
    return [];
  }

  const displayedMembers: MythicPlusRunMember[] = [];
  const seenMembers = new Set<string>();

  for (const member of members) {
    const normalizedName = member.name.trim();
    if (normalizedName === "") {
      continue;
    }

    const normalizedRealm = member.realm?.trim();
    const memberKey = `${normalizedName.toLowerCase()}|${normalizedRealm?.toLowerCase() ?? ""}`;
    if (seenMembers.has(memberKey)) {
      continue;
    }

    seenMembers.add(memberKey);
    displayedMembers.push({
      ...member,
      name: normalizedName,
      realm: normalizedRealm || undefined,
    });
  }

  return displayedMembers
    .map((member, index) => ({
      member,
      index,
      roleSortOrder: getRunMemberRoleSortOrder(member),
    }))
    .sort((a, b) => {
      if (a.roleSortOrder !== b.roleSortOrder) {
        return a.roleSortOrder - b.roleSortOrder;
      }
      return a.index - b.index;
    })
    .slice(0, 5)
    .map(({ member }) => member);
}

// ── Hidden-player helpers ────────────────────────────────────────────────────

const HIDDEN_PLAYERS_KEY = "wow-hidden-run-players";
const HIDE_ALL_PLAYER_NAMES_KEY = "wow-hide-all-run-player-names";

function getMemberKey(member: MythicPlusRunMember, characterRealm: string): string {
  const realm = member.realm?.trim() || characterRealm.trim();
  return `${member.name.toLowerCase()}|${realm.toLowerCase()}`;
}

function buildMemberRaiderIoUrl(
  member: MythicPlusRunMember,
  characterRealm: string,
  characterRegion: string,
): string {
  const realm = member.realm?.trim() || characterRealm.trim();
  const region = characterRegion.toLowerCase();
  return `https://raider.io/characters/${region}/${encodeURIComponent(realm)}/${encodeURIComponent(member.name)}`;
}

function readHiddenPlayers(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_PLAYERS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function writeHiddenPlayers(keys: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_PLAYERS_KEY, JSON.stringify([...keys]));
  } catch {
    /* ignore */
  }
}

function readHideAllPlayerNames(): boolean {
  try {
    return localStorage.getItem(HIDE_ALL_PLAYER_NAMES_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHideAllPlayerNames(enabled: boolean) {
  try {
    if (enabled) {
      localStorage.setItem(HIDE_ALL_PLAYER_NAMES_KEY, "1");
      return;
    }
    localStorage.removeItem(HIDE_ALL_PLAYER_NAMES_KEY);
  } catch {
    /* ignore */
  }
}

function useHiddenPlayers() {
  const [hidden, setHidden] = useState<Set<string>>(() => readHiddenPlayers());
  const [hideAllNames, setHideAllNames] = useState<boolean>(() => readHideAllPlayerNames());

  const hide = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.add(key);
      writeHiddenPlayers(next);
      return next;
    });
  }, []);

  const unhide = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.delete(key);
      writeHiddenPlayers(next);
      return next;
    });
  }, []);

  const unhideAll = useCallback(() => {
    setHidden(new Set());
    writeHiddenPlayers(new Set());
  }, []);

  const toggleHideAllNames = useCallback(() => {
    setHideAllNames((prev) => {
      const next = !prev;
      writeHideAllPlayerNames(next);
      return next;
    });
  }, []);

  return { hidden, hide, unhide, unhideAll, hideAllNames, toggleHideAllNames };
}

function RecentRunPlayedAt({ run }: { run: MythicPlusRun }) {
  const playedAt = getRunPlayedAt(run);

  return (
    <div className="space-y-0.5" title={formatRunDateTime(playedAt)}>
      <div>{formatRunDate(playedAt)}</div>
      <div className="text-xs text-muted-foreground/70">{formatRunTime(playedAt)}</div>
    </div>
  );
}

function RecentRunKeyCell({ run }: { run: MythicPlusRun }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className="font-medium tabular-nums">{formatKeyLevel(run.level)}</span>
    </div>
  );
}

function RecentRunPartyMembers({
  run,
  characterRealm,
  characterRegion,
  hiddenKeys,
  hideAllNames,
  onHide,
}: {
  run: MythicPlusRun;
  characterRealm: string;
  characterRegion: string;
  hiddenKeys: Set<string>;
  hideAllNames: boolean;
  onHide: (key: string) => void;
}) {
  const allMembers = getDisplayedRunMembers(run.members);
  if (allMembers.length === 0) return null;
  if (hideAllNames) return null;

  return (
    <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-x-0.5 overflow-visible whitespace-nowrap text-[11px] leading-tight">
      {allMembers.map((member, index) => {
        const key = getMemberKey(member, characterRealm);
        const isHidden = hiddenKeys.has(key);

        if (isHidden) {
          return (
            <span key={key} className="inline-flex shrink-0 items-center whitespace-nowrap">
              {index > 0 && <span className="shrink-0 px-0.5 text-muted-foreground/25">/</span>}
              <span
                className="inline-block h-[0.65em] w-10 shrink-0 rounded-sm bg-muted-foreground/25 blur-[5px]"
                aria-hidden="true"
              />
            </span>
          );
        }

        const url = buildMemberRaiderIoUrl(member, characterRealm, characterRegion);
        return (
          <span
            key={key}
            className="group/member relative inline-flex shrink-0 items-center whitespace-nowrap after:absolute after:left-0 after:right-0 after:top-full after:h-2 after:content-['']"
          >
            {index > 0 && <span className="shrink-0 px-0.5 text-muted-foreground/25">/</span>}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex shrink-0 whitespace-nowrap font-medium hover:underline decoration-current/40 underline-offset-2 ${classColor(member.classTag ?? "")}`}
              title={`View ${member.name} on Raider.IO`}
            >
              {formatRunMemberName(member, characterRealm)}
            </a>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onHide(key);
              }}
              className="pointer-events-none absolute left-1/2 top-[calc(100%+1px)] z-10 -translate-x-1/2 rounded-sm border border-border/70 bg-background/95 p-1 text-muted-foreground/55 opacity-0 shadow-sm transition-opacity duration-150 group-hover/member:pointer-events-auto group-hover/member:opacity-100 group-focus-within/member:pointer-events-auto group-focus-within/member:opacity-100 hover:text-foreground"
              title={`Hide ${member.name}`}
              aria-label={`Hide ${member.name}`}
            >
              <EyeOff size={9} className="shrink-0" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

function HiddenPlayersControl({
  hiddenKeys,
  hideAllNames,
  onToggleHideAllNames,
  onUnhide,
  onUnhideAll,
}: {
  hiddenKeys: Set<string>;
  hideAllNames: boolean;
  onToggleHideAllNames: () => void;
  onUnhide: (key: string) => void;
  onUnhideAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const keys = [...hiddenKeys].sort((a, b) => a.localeCompare(b));
  const isActive = hideAllNames || keys.length > 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
          isActive
            ? "border-border/70 bg-muted/45 text-foreground hover:bg-muted/60"
            : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        }`}
      >
        {hideAllNames ? <EyeOff size={11} /> : <Eye size={11} />}
        Names
        {hideAllNames ? (
          <span className="rounded bg-foreground/8 px-1 py-0.5 text-[10px] uppercase tracking-wider text-foreground/80">
            Off
          </span>
        ) : keys.length > 0 ? (
          <span className="rounded bg-foreground/8 px-1 py-0.5 text-[10px] uppercase tracking-wider text-foreground/80">
            {keys.length} hidden
          </span>
        ) : null}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[220px] rounded-md border border-border/60 bg-card p-2 shadow-lg">
          <button
            type="button"
            onClick={onToggleHideAllNames}
            className="flex w-full items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-2 py-2 text-left text-xs transition-colors hover:bg-muted/35"
          >
            <span className="flex items-center gap-2 text-foreground/90">
              {hideAllNames ? <Eye size={12} /> : <EyeOff size={12} />}
              Hide all names
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {hideAllNames ? "On" : "Off"}
            </span>
          </button>

          <div className="mt-2 border-t border-border/50 pt-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Hidden players
              </span>
              {keys.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onUnhideAll();
                    setOpen(false);
                  }}
                  className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Show all
                </button>
              )}
            </div>
            {keys.length === 0 ? (
              <div className="rounded px-1.5 py-1 text-xs text-muted-foreground">
                No individually hidden players.
              </div>
            ) : (
              <div className="space-y-0.5">
                {keys.map((key) => {
                  const [name] = key.split("|");
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/30"
                    >
                      <span className="truncate text-foreground/80">{name}</span>
                      <button
                        type="button"
                        onClick={() => onUnhide(key)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
                        title="Show player"
                      >
                        <Eye size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
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

function RaiderIoScoreText({ score, className }: { score?: number | null; className?: string }) {
  return (
    <span className={className} style={{ color: getRaiderIoScoreColor(score) }}>
      {formatRunScore(score)}
    </span>
  );
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
  return [
    { label: "Speed", value: snapshot.stats.speedPercent ?? 0 },
    { label: "Leech", value: snapshot.stats.leechPercent ?? 0 },
    { label: "Avoidance", value: snapshot.stats.avoidancePercent ?? 0 },
  ].filter((stat) => stat.value > 0);
}

function MythicPlusResultBadge({ run }: { run: MythicPlusRun }) {
  const status = getMythicPlusRunStatus(run);
  const timedState = getMythicPlusRunTimedState(run);
  const normalizedUpgradeCount =
    run.upgradeCount !== undefined && run.upgradeCount !== null
      ? Math.max(1, Math.min(3, run.upgradeCount))
      : null;

  if (status === "active") {
    return (
      <Badge className="rounded-md border-sky-400/35 bg-sky-500/16 px-1.5 py-0.5 text-[11px] font-semibold tracking-[0.08em] text-sky-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        Active
      </Badge>
    );
  }
  if (status === "abandoned") {
    return (
      <Badge className="rounded-md border-rose-400/35 bg-rose-500/16 px-1.5 py-0.5 text-[11px] font-semibold tracking-[0.08em] text-rose-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        Abandoned
      </Badge>
    );
  }
  if (timedState === true) {
    return (
      <Badge className="rounded-md border-emerald-400/40 bg-emerald-500/18 px-1.5 py-0.5 text-[11px] font-semibold tracking-[0.08em] text-emerald-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        {normalizedUpgradeCount !== null ? `+${normalizedUpgradeCount}` : "Timed"}
      </Badge>
    );
  }
  if (timedState === false) {
    return (
      <Badge className="rounded-md border-amber-400/35 bg-amber-500/16 px-1.5 py-0.5 text-[11px] font-semibold tracking-[0.08em] text-amber-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        Deplete
      </Badge>
    );
  }
  if (isCompletedMythicPlusRun(run)) {
    return (
      <Badge className="rounded-md border-slate-400/35 bg-slate-500/12 px-1.5 py-0.5 text-[11px] font-semibold tracking-[0.08em] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        Completed
      </Badge>
    );
  }
  return null;
}

function MythicPlusSection({
  data,
  characterId,
  characterName,
  characterRealm,
  characterRegion,
  currentScore,
}: {
  data: MythicPlusData | null | undefined;
  characterId: string;
  characterName: string;
  characterRealm: string;
  characterRegion: string;
  currentScore: number | null;
}) {
  const [visibleRecentRunCount, setVisibleRecentRunCount] = useState(INITIAL_RECENT_RUN_COUNT);
  const {
    hidden: hiddenPlayerKeys,
    hide: hidePlayer,
    unhide: unhidePlayer,
    unhideAll: unhideAllPlayers,
    hideAllNames,
    toggleHideAllNames,
  } = useHiddenPlayers();
  const [summaryCardHeight, setSummaryCardHeight] = useState<number | null>(null);
  const summaryCardRef = useRef<HTMLDivElement | null>(null);
  const latestRunResetKey = data?.runs[0] ? getRecentRunRowKey(data.runs[0]) : "";
  const recentRunsResetKey = `${data?.runs.length ?? 0}:${latestRunResetKey}`;
  const totalRunCount = data?.runs.length ?? 0;
  const hasMoreRecentRuns = visibleRecentRunCount < totalRunCount;

  useEffect(() => {
    setVisibleRecentRunCount(INITIAL_RECENT_RUN_COUNT);
  }, [recentRunsResetKey]);

  useEffect(() => {
    const summaryElement = summaryCardRef.current;
    if (!summaryElement || typeof ResizeObserver === "undefined") return;

    const updateHeight = () => {
      setSummaryCardHeight(Math.ceil(summaryElement.getBoundingClientRect().height));
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(() => {
      updateHeight();
    });

    resizeObserver.observe(summaryElement);
    return () => resizeObserver.disconnect();
  }, [recentRunsResetKey]);

  if (data === undefined) {
    return null;
  }

  if (!data) {
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
  if (runs.length === 0) {
    return (
      <div className="space-y-4">
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

        <MythicPlannerPanel
          characterId={characterId}
          characterName={characterName}
          currentScore={currentScore}
          dungeons={summary.currentSeasonDungeons}
        />
      </div>
    );
  }

  const currentSeason = summary.currentSeason;
  const visibleRecentRuns = runs.slice(0, visibleRecentRunCount);
  const nextRecentRunCount = Math.min(
    RECENT_RUN_LOAD_INCREMENT,
    runs.length - visibleRecentRunCount,
  );

  function loadMoreRecentRuns() {
    setVisibleRecentRunCount((currentValue) =>
      Math.min(currentValue + RECENT_RUN_LOAD_INCREMENT, runs.length),
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div ref={summaryCardRef}>
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
                  <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                    <StatGrid
                      compact
                      label="Current Score"
                      value={
                        <RaiderIoScoreText score={summary.currentScore} className="tabular-nums" />
                      }
                    />
                    <StatGrid
                      compact
                      label="Best Timed"
                      value={
                        <MythicPlusKeyPill
                          level={currentSeason.bestTimedLevel}
                          upgradeCount={currentSeason.bestTimedUpgradeCount}
                          compact
                        />
                      }
                    />
                    <StatGrid
                      compact
                      label="Total Runs"
                      value={(currentSeason.totalAttempts ?? currentSeason.totalRuns).toLocaleString()}
                    />
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                    <StatGrid compact label="Timed" value={currentSeason.timedRuns.toLocaleString()} />
                    <StatGrid
                      compact
                      label="Depleted"
                      value={Math.max(
                        0,
                        currentSeason.completedRuns - currentSeason.timedRuns,
                      ).toLocaleString()}
                    />
                    <StatGrid
                      compact
                      label="Abandoned"
                      value={(currentSeason.abandonedRuns ?? 0).toLocaleString()}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    <StatGrid compact label="2+ Timed" value={currentSeason.timed2To9.toLocaleString()} />
                    <StatGrid
                      compact
                      label="10+ Timed"
                      value={currentSeason.timed10To11.toLocaleString()}
                    />
                    <StatGrid
                      compact
                      label="12+ Timed"
                      value={currentSeason.timed12To13.toLocaleString()}
                    />
                    <StatGrid compact label="14+ Timed" value={currentSeason.timed14Plus.toLocaleString()} />
                  </div>
                </div>
              )}

              {summary.currentSeasonDungeons.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Sword size={14} className="text-muted-foreground" />
                      <h3 className="text-sm font-semibold">Dungeon Bests</h3>
                    </div>
                    {summary.currentScore !== null && (
                      <div className="text-xs text-muted-foreground">
                        Score{" "}
                        <RaiderIoScoreText
                          score={summary.currentScore}
                          className="font-semibold tabular-nums"
                        />
                      </div>
                    )}
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full min-w-[560px] text-sm leading-tight">
                      <thead className="bg-muted/40 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Dungeon</th>
                          <th className="px-3 py-2 text-right font-medium">Timed</th>
                          <th className="px-3 py-2 text-right font-medium">Level</th>
                          <th className="px-3 py-2 text-right font-medium">Score</th>
                          <th className="px-3 py-2 text-right font-medium">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {summary.currentSeasonDungeons.map((dungeon) => (
                          <tr
                            key={`${dungeon.mapChallengeModeID ?? "map"}-${dungeon.mapName}`}
                            className="bg-background/20 transition-colors hover:bg-muted/20"
                          >
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <DungeonIcon
                                  mapChallengeModeID={dungeon.mapChallengeModeID}
                                  mapName={dungeon.mapName}
                                />
                                <div className="font-medium text-foreground">{dungeon.mapName}</div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                              {dungeon.timedRuns}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <MythicPlusKeyPill
                                level={dungeon.bestTimedLevel}
                                upgradeCount={dungeon.bestTimedUpgradeCount}
                                compact
                              />
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              <RaiderIoScoreText
                                score={dungeon.bestTimedScore}
                                className="tabular-nums"
                              />
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              {formatRunDuration(dungeon.bestTimedDurationMs)}
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
        </div>

        <Card
          className="flex flex-col"
          style={summaryCardHeight === null ? undefined : { height: `${summaryCardHeight}px` }}
        >
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock size={16} className="text-muted-foreground" />
                Recent Runs
              </CardTitle>
              <HiddenPlayersControl
                hiddenKeys={hiddenPlayerKeys}
                hideAllNames={hideAllNames}
                onToggleHideAllNames={toggleHideAllNames}
                onUnhide={unhidePlayer}
                onUnhideAll={unhideAllPlayers}
              />
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col pt-4">
            <div className="dark-scrollbar min-h-0 flex-1 overflow-auto rounded-md border border-border/60">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/30 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Played</th>
                    <th className="px-3 py-2 text-left font-medium">Dungeon</th>
                    <th className="px-3 py-2 text-right font-medium">Key</th>
                    <th className="px-3 py-2 text-left font-medium">Result</th>
                    <th className="px-3 py-2 text-right font-medium">Score</th>
                    <th className="w-[7rem] whitespace-nowrap px-3 py-2 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {visibleRecentRuns.map((run) => (
                    <tr key={getRecentRunRowKey(run)} className="transition-colors hover:bg-muted/15">
                      <td className="px-3 py-2.5 text-muted-foreground align-top">
                        <RecentRunPlayedAt run={run} />
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex items-center gap-2">
                          <DungeonIcon
                            mapChallengeModeID={run.mapChallengeModeID}
                            mapName={run.mapName}
                          />
                          <div className="font-medium leading-tight text-foreground">
                            {getRunLabel(run)}
                          </div>
                        </div>
                        <RecentRunPartyMembers
                          run={run}
                          characterRealm={characterRealm}
                          characterRegion={characterRegion}
                          hiddenKeys={hiddenPlayerKeys}
                          hideAllNames={hideAllNames}
                          onHide={hidePlayer}
                        />
                      </td>
                      <td className="px-3 py-2.5 align-top text-right">
                        <RecentRunKeyCell run={run} />
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <MythicPlusResultBadge run={run} />
                      </td>
                      <td className="px-3 py-2.5 align-top text-right">
                        <div className="flex items-center justify-end gap-1.5 tabular-nums">
                          <span>{formatRunScore(run.runScore)}</span>
                          {formatRunScoreIncrease(run.scoreIncrease) && (
                            <span className="text-xs font-medium text-emerald-300">
                              (+{formatRunScoreIncrease(run.scoreIncrease)})
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="w-[7rem] whitespace-nowrap px-3 py-2.5 align-top text-right tabular-nums text-muted-foreground">
                        {formatRunTimeComparison(run)}
                      </td>
                    </tr>
                  ))}
                  {hasMoreRecentRuns && (
                    <tr className="bg-muted/10">
                      <td colSpan={6} className="px-3 py-3 text-center">
                        <Button size="sm" variant="outline" onClick={loadMoreRecentRuns}>
                          Load {nextRecentRunCount} More
                        </Button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <MythicPlannerPanel
        characterId={characterId}
        characterName={characterName}
        currentScore={currentScore}
        dungeons={summary.currentSeasonDungeons}
      />
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
    critPercent: number;
    hastePercent: number;
    masteryPercent: number;
    versatilityPercent: number;
    speedPercent?: number;
    leechPercent?: number;
    avoidancePercent?: number;
  };
};

type LayoutProps = {
  latest: Snapshot;
  chartSnapshots: Snapshot[];
  filteredSnapshots: Snapshot[];
  mythicPlus?: MythicPlusData | null;
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
  _id?: Id<"mythicPlusRuns">;
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
  blue: "oklch(0.72 0.20 245)",
  red: "oklch(0.72 0.22 20)",
  gold: "oklch(0.84 0.18 80)",
  purple: "oklch(0.73 0.20 295)",
  teal: "oklch(0.75 0.18 190)",
  green: "oklch(0.76 0.18 155)",
  pink: "oklch(0.75 0.18 330)",
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
  minSpan: 4,
  minPadding: 0.5,
  padRatio: 0.18,
  stepFloor: 0.5,
};
const MPLUS_AUTO_SCALE: YScaleOptions = {
  minSpan: 150,
  minPadding: 40,
  padRatio: 0.16,
  stepFloor: 25,
};
const GOLD_SCALE: YScaleOptions = {
  minSpan: 20,
  minPadding: 2,
  padRatio: 0.2,
  stepFloor: 1,
};
const SECONDARY_STATS_SCALE: YScaleOptions = {
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

  if (options.includeZero && minValue >= 0 && domainMin < 0) {
    domainMin = 0;
  }
  if (options.includeZero && maxValue <= 0 && domainMax > 0) {
    domainMax = 0;
  }

  if (domainMin === domainMax) {
    return [domainMin - step, domainMax + step];
  }

  return [domainMin, domainMax];
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
}) {
  if (data.length < 2) {
    return (
      <p className="text-muted-foreground text-sm py-6 text-center">Not enough data points yet.</p>
    );
  }

  const xAxisInterval = data.length > 10 ? Math.ceil(data.length / 10) - 1 : 0;
  const latestDatum = data[data.length - 1];
  const hasPrimaryEmphasis = lineEmphasis === "primary" && lines.length > 1;
  const primaryLineKey = hasPrimaryEmphasis ? getPrimaryLineKey(lines, latestDatum) : undefined;
  const shouldShowLatestValue = showLatestValue ?? lines.length === 1;

  const allValues = data
    .flatMap((d) => lines.map((l) => d[l.key]))
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  const yDomain: [number, number] =
    yDomainOverride ?? getAdaptiveYDomain(allValues, data.length, yScaleOptions);

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
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number(value)
            : Number.NaN;
      const label =
        showLabel && Number.isFinite(numericValue)
          ? valueFormatter?.(numericValue) ?? numericValue.toLocaleString()
          : null;
      const showLabelBelow = cy < 28;
      const markerOpacity = variant === "primary" ? 1 : variant === "equal" ? 0.9 : 0.65;
      const markerRadius = variant === "primary" ? 4.5 : variant === "equal" ? 3.5 : 3;
      const markerStrokeWidth = variant === "primary" ? 2.5 : 2;

      return (
        <g opacity={markerOpacity}>
          <circle
            cx={cx}
            cy={cy}
            r={markerRadius}
            fill={color}
            stroke="var(--card)"
            strokeWidth={markerStrokeWidth}
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
              strokeWidth={4}
            >
              {label}
            </text>
          ) : null}
        </g>
      );
    };

  return (
    <ChartContainer config={config} className={`w-full ${className ?? "h-[200px]"}`}>
      <LineChart data={data} margin={{ top: 16, right: 12, left: 4, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.14} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tick={{
            fontSize: 10,
            fill: "var(--muted-foreground)",
            fillOpacity: 0.7,
          }}
          interval={xAxisInterval}
          tickFormatter={(ts: number) => xAxisTickFormatter(ts, timeFrame ?? "all")}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          tick={{
            fontSize: 10,
            fill: "var(--muted-foreground)",
            fillOpacity: 0.7,
          }}
          tickFormatter={valueFormatter}
          width={52}
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
              indicator="dot"
            />
          }
        />
        {showLegend && (
          <ChartLegend
            content={<ChartLegendContent className="text-muted-foreground/85" />}
          />
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
              type="monotone"
              dataKey={key}
              stroke={color}
              strokeWidth={lineVariant === "primary" ? 3.2 : lineVariant === "equal" ? 2.45 : 2}
              strokeOpacity={lineVariant === "primary" ? 1 : lineVariant === "equal" ? 0.96 : 0.58}
              strokeLinecap="round"
              style={{
                filter:
                  lineVariant === "primary"
                    ? `drop-shadow(0 0 3px ${color})`
                    : lineVariant === "equal"
                      ? `drop-shadow(0 0 2px ${color})`
                      : `drop-shadow(0 0 1.5px ${color})`,
              }}
              dot={renderEndpointMarker({
                color,
                variant: lineVariant,
                showLabel: shouldShowLatestValue && isPrimaryLine,
              })}
              activeDot={{
                r: lineVariant === "primary" ? 5.5 : lineVariant === "equal" ? 5 : 4.5,
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
  const radarData = [
    { stat: "Crit", value: snapshot.stats.critPercent },
    { stat: "Haste", value: snapshot.stats.hastePercent },
    { stat: "Mastery", value: snapshot.stats.masteryPercent },
    { stat: "Versatility", value: snapshot.stats.versatilityPercent },
  ];
  const tertiaryStats = getTertiaryStats(snapshot);
  const primaryStat = getPrimaryStat(snapshot);

  return (
    <div className="space-y-3">
      <ChartContainer config={radarConfig} className="h-[150px] w-full">
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
      <div className="space-y-1 text-sm">
        <StatRow label="Stamina" value={snapshot.stats.stamina.toLocaleString()} />
        {primaryStat && (
          <StatRow label={primaryStat.label} value={primaryStat.value.toLocaleString()} />
        )}
        <div className="border-t border-border/50 my-1" />
        <StatRow label="Crit" value={`${snapshot.stats.critPercent.toFixed(2)}%`} />
        <StatRow label="Haste" value={`${snapshot.stats.hastePercent.toFixed(2)}%`} />
        <StatRow label="Mastery" value={`${snapshot.stats.masteryPercent.toFixed(2)}%`} />
        <StatRow label="Versatility" value={`${snapshot.stats.versatilityPercent.toFixed(2)}%`} />
        {tertiaryStats.length > 0 && <div className="border-t border-border/50 my-1" />}
        {tertiaryStats.map((stat) => (
          <StatRow key={stat.label} label={stat.label} value={`${stat.value.toFixed(2)}%`} />
        ))}
      </div>
    </div>
  );
}

// Compact horizontal radar for Timeline layout
function RadarStrip({ snapshot }: { snapshot: Snapshot }) {
  const radarData = [
    { stat: "Crit", value: snapshot.stats.critPercent },
    { stat: "Haste", value: snapshot.stats.hastePercent },
    { stat: "Mastery", value: snapshot.stats.masteryPercent },
    { stat: "Versatility", value: snapshot.stats.versatilityPercent },
  ];
  const tertiaryStats = getTertiaryStats(snapshot);
  const primaryStat = getPrimaryStat(snapshot);
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
          <div className="flex-1 space-y-2">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
              <StatRow label="Crit" value={`${snapshot.stats.critPercent.toFixed(2)}%`} />
              <StatRow label="Haste" value={`${snapshot.stats.hastePercent.toFixed(2)}%`} />
              <StatRow label="Mastery" value={`${snapshot.stats.masteryPercent.toFixed(2)}%`} />
              <StatRow
                label="Versatility"
                value={`${snapshot.stats.versatilityPercent.toFixed(2)}%`}
              />
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
                    value={`${stat.value.toFixed(2)}%`}
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

function IlvlChartCard({ snapshots, timeFrame }: { snapshots: Snapshot[]; timeFrame: TimeFrame }) {
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
function MplusChartCard({ snapshots, timeFrame }: { snapshots: Snapshot[]; timeFrame: TimeFrame }) {
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
function GoldChartCard({ snapshots, timeFrame }: { snapshots: Snapshot[]; timeFrame: TimeFrame }) {
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
  snapshots: Snapshot[];
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
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium flex items-center gap-1.5">
          <Zap size={14} className="text-muted-foreground" /> Secondary Stats
        </CardTitle>
      </CardHeader>
      <CardContent>
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
  snapshots: Snapshot[];
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

// ── Snapshot history table ────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// Layout A — Overview
// Left sidebar: radar + current values (sticky)
// Right: time picker + chart grid
// ════════════════════════════════════════════════════════════════════════════

function OverviewLayout({
  latest,
  chartSnapshots,
  mythicPlus,
  characterId,
  characterName,
  characterRealm,
  characterRegion,
  currentMythicPlusScore,
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
              {chartSnapshots.length} point{chartSnapshots.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <IlvlChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
            <MplusChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
            <GoldChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
            <CurrenciesChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
          </div>

          <MythicPlusSection
            data={mythicPlus}
            characterId={characterId}
            characterName={characterName}
            characterRealm={characterRealm}
            characterRegion={characterRegion}
            currentScore={currentMythicPlusScore}
          />
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
          {[
            { l: "Crit", v: snapshot.stats.critPercent },
            { l: "Haste", v: snapshot.stats.hastePercent },
            { l: "Mastery", v: snapshot.stats.masteryPercent },
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
        yScaleOptions={ITEM_LEVEL_AUTO_SCALE}
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
        yScaleOptions={MPLUS_AUTO_SCALE}
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
        yScaleOptions={GOLD_SCALE}
        timeFrame={timeFrame}
      />
    );
  }
  if (metric === "stats") {
    return (
      <SnapshotLineChart
        data={snapshots.map((s) => ({
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
    return (
      <SnapshotLineChart
        data={snapshots.map((s) => ({ date: s.takenAt, ...s.currencies }))}
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
        data={snapshots.map((s) => ({
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
            data={chartSnapshots.map((s) => ({
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
            data={chartSnapshots.map((s) => ({ date: s.takenAt, gold: s.gold }))}
            lines={[{ key: "gold", color: C.gold }]}
            config={goldConfig}
            valueFormatter={(v) => `${goldUnits(v).toLocaleString()}g`}
            className={chartH}
            yScaleOptions={GOLD_SCALE}
            timeFrame={timeFrame}
          />
        </CardContent>
      </Card>

      <SecondaryStatsChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
      <CurrenciesChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
      <PlaytimeChartCard snapshots={chartSnapshots} timeFrame={timeFrame} />
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

function RouteComponent() {
  const { characterId } = Route.useParams();
  const data = useQuery(api.characters.getCharacterSnapshots, {
    characterId: characterId as Id<"characters">,
  });
  const mythicPlus = useQuery(api.characters.getCharacterMythicPlus, {
    characterId: characterId as Id<"characters">,
  });
  const setCharacterBoosterStatus = useMutation((api as any).characters.setCharacterBoosterStatus);
  const setCharacterNonTradeableSlots = useMutation(
    (api as any).characters.setCharacterNonTradeableSlots,
  );
  const setPlayerDiscordUserId = useMutation((api as any).players.setPlayerDiscordUserId);
  const snapshotsCacheRef = useRef(new Map<string, Exclude<typeof data, undefined>>());
  const mythicPlusCacheRef = useRef(new Map<string, Exclude<typeof mythicPlus, undefined>>());
  const resolvedData = data ?? snapshotsCacheRef.current.get(characterId);
  const resolvedMythicPlus = mythicPlus ?? mythicPlusCacheRef.current.get(characterId);

  const [timeFrame, setTimeFrame] = useState<TimeFrame>("30d");
  const { pinnedCharacterIdSet, togglePinnedCharacter } = usePinnedCharacters();
  const [discordUserIdInput, setDiscordUserIdInput] = useState("");
  const [nonTradeableSlotsDraft, setNonTradeableSlotsDraft] = useState<TradeSlotKey[]>([]);
  const [isSavingDiscordUserId, setIsSavingDiscordUserId] = useState(false);
  const [isUpdatingBooster, setIsUpdatingBooster] = useState(false);
  const [isSavingTradeSlots, setIsSavingTradeSlots] = useState(false);
  const [isDiscordSheetOpen, setIsDiscordSheetOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    try {
      return (localStorage.getItem("wow-char-layout") as LayoutMode) ?? "overview";
    } catch {
      return "overview";
    }
  });

  useEffect(() => {
    if (data !== undefined) {
      snapshotsCacheRef.current.set(characterId, data);
    }
  }, [characterId, data]);

  useEffect(() => {
    if (mythicPlus !== undefined) {
      mythicPlusCacheRef.current.set(characterId, mythicPlus);
    }
  }, [characterId, mythicPlus]);

  useEffect(() => {
    setDiscordUserIdInput(resolvedData?.owner?.discordUserId ?? "");
  }, [characterId, resolvedData?.owner?.discordUserId]);

  useEffect(() => {
    setNonTradeableSlotsDraft(
      normalizeTradeSlotKeys((resolvedData?.character.nonTradeableSlots ?? []) as TradeSlotKey[]),
    );
  }, [characterId, resolvedData?.character.nonTradeableSlots]);

  useEffect(() => {
    const appTitle = "WoW Dashboard";
    if (resolvedData === undefined) {
      document.title = `Character | ${appTitle}`;
      return;
    }
    if (!resolvedData) {
      document.title = `Character Not Found | ${appTitle}`;
      return;
    }

    document.title = `${resolvedData.character.name} (${resolvedData.character.realm}) | ${appTitle}`;
  }, [resolvedData]);

  function handleLayoutChange(mode: LayoutMode) {
    setLayoutMode(mode);
    try {
      localStorage.setItem("wow-char-layout", mode);
    } catch {
      /* ignore */
    }
  }

  const resolvedSnapshots = resolvedData?.snapshots;
  const timeFrameFiltered = useMemo(() => {
    if (!resolvedSnapshots) return [] as Snapshot[];
    return filterByTimeFrame(resolvedSnapshots, timeFrame);
  }, [resolvedSnapshots, timeFrame]);
  const chartSnapshots = useMemo(() => groupSnapshotsAuto(timeFrameFiltered), [timeFrameFiltered]);

  if (resolvedData === undefined) {
    return (
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8" />
    );
  }

  if (!resolvedData) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <p className="text-muted-foreground text-sm">Character not found.</p>
      </div>
    );
  }

  const { character, snapshots } = resolvedData;
  const owner = resolvedData.owner;
  const isPinnedToQuickAccess = pinnedCharacterIdSet.has(characterId);
  const isBoosterCharacter = character.isBooster === true;
  const nonTradeableSlots = (character.nonTradeableSlots ?? []) as TradeSlotKey[];
  const mythicPlusData = resolvedMythicPlus as MythicPlusData | null | undefined;
  const normalizedDiscordUserIdInput = discordUserIdInput.trim();
  const hasDiscordUserIdChanges = normalizedDiscordUserIdInput !== (owner?.discordUserId ?? "");
  const hasTradeSlotChanges =
    JSON.stringify(nonTradeableSlotsDraft) !== JSON.stringify(nonTradeableSlots);

  const latest = snapshots[snapshots.length - 1] ?? null;
  const firstSnapshot = snapshots[0] ?? null;
  const lastMythicPlusRunAt = mythicPlusData?.summary.overall.lastRunAt ?? null;

  const layoutProps: LayoutProps = {
    latest: latest!,
    chartSnapshots,
    filteredSnapshots: snapshots,
    mythicPlus: mythicPlusData,
    characterId,
    characterName: character.name,
    characterRealm: character.realm,
    characterRegion: character.region,
    currentMythicPlusScore: mythicPlusData?.summary.currentScore ?? latest?.mythicPlusScore ?? null,
    timeFrame,
    setTimeFrame,
  };

  async function handleBoosterToggle() {
    if (isUpdatingBooster) {
      return;
    }

    setIsUpdatingBooster(true);
    try {
      await setCharacterBoosterStatus({
        characterId: characterId as Id<"characters">,
        isBooster: !isBoosterCharacter,
      });
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
      await setPlayerDiscordUserId({
        playerId: owner.playerId,
        discordUserId: normalizedDiscordUserIdInput === "" ? null : normalizedDiscordUserIdInput,
      });
      setIsDiscordSheetOpen(false);
      toast.success(normalizedDiscordUserIdInput === "" ? "Discord ID cleared." : "Discord ID saved.");
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
      await setCharacterNonTradeableSlots({
        characterId: characterId as Id<"characters">,
        nonTradeableSlots: nonTradeableSlotsDraft,
      });
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
              <CardTitle className={`text-3xl font-bold tracking-tight sm:text-4xl ${classColor(character.class)}`}>
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
                      {nonTradeableSlots.length > 0 ? ` ${getTradeSlotEditorCount(nonTradeableSlots)}` : ""}
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
                              checked={slot.slotKeys.every((slotKey) => nonTradeableSlotsDraft.includes(slotKey))}
                              onCheckedChange={() => toggleNonTradeableSlot(slot.slotKeys)}
                            />
                            <div>
                              <p className="text-sm font-medium text-foreground">{slot.label}</p>
                              <p className="text-xs text-muted-foreground">Drop in this slot stays bound.</p>
                            </div>
                          </label>
                        ))}
                      </div>
                      {nonTradeableSlotsDraft.length === 0 ? (
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                          No locked slots. This character is marked as able to trade all tracked slots.
                        </div>
                      ) : (
                        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3 text-sm text-orange-200">
                          Locked slots: {getTradeSlotExportLabels(nonTradeableSlotsDraft).join(", ")}
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
                value={<span className="tabular-nums">{latest.mythicPlusScore.toLocaleString()}</span>}
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
                  <StatRow label="Since" value={formatDate(firstSnapshot?.takenAt ?? latest.takenAt)} />
                  <StatRow label="Snapshots" value={snapshots.length.toLocaleString()} />
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
      {latest && snapshots.length > 0 && (
        <>
          {layoutMode === "overview" && <OverviewLayout {...layoutProps} />}
          {layoutMode === "focus" && <FocusLayout {...layoutProps} />}
          {layoutMode === "timeline" && <TimelineLayout {...layoutProps} />}
        </>
      )}

      {layoutMode !== "overview" && (
        <MythicPlusSection
          data={mythicPlusData}
          characterId={characterId}
          characterName={character.name}
          characterRealm={character.realm}
          characterRegion={character.region}
          currentScore={mythicPlusData?.summary.currentScore ?? latest?.mythicPlusScore ?? null}
        />
      )}
    </div>
  );
}
