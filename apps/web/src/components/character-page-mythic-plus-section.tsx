import { Badge } from "@wow-dashboard/ui/components/badge";
import { Button } from "@wow-dashboard/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { Clock, Eye, EyeOff, Flame, History, Sword } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  getRaiderIoDungeonScoreColor,
  getMythicPlusDungeonMeta,
  getMythicPlusDungeonTimerMs,
  getRaiderIoScoreColor,
} from "../lib/mythic-plus-static";
import { getClassTextColor } from "../lib/class-colors";

const INITIAL_RECENT_RUN_COUNT = 12;
const RECENT_RUN_LOAD_INCREMENT = 10;
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
const MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS = 4 * 60 * 60 * 1000;

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

function classColor(cls: string) {
  return getClassTextColor(cls);
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

function getRunDurationMs(run: MythicPlusRun): number | undefined {
  if (
    run.durationMs !== undefined &&
    run.durationMs > 0 &&
    run.durationMs <= MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS
  ) {
    return run.durationMs;
  }

  const runEndAt = run.endedAt ?? run.abandonedAt ?? run.completedAt;
  if (run.startDate !== undefined && runEndAt !== undefined && runEndAt >= run.startDate) {
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

function formatRunTimeComparison(run: MythicPlusRun) {
  if (getMythicPlusRunStatus(run) === "active") {
    return "In progress";
  }

  const actualTime = formatRunDuration(getRunDurationMs(run));
  const timerMs = getMythicPlusDungeonTimerMs(run.mapChallengeModeID, run.mapName);
  if (timerMs === null || timerMs === undefined) {
    return actualTime;
  }

  return `${actualTime} / ${formatRunDuration(timerMs)}`;
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

function StatGrid({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-md border border-border/50 bg-muted/20 text-center ${
        compact ? "px-2 py-2" : "p-3"
      }`}
    >
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
          compact ? "mt-1 text-sm font-semibold leading-none" : "mt-1 text-sm font-semibold"
        }
      >
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
    const next = new Set<string>();
    setHidden(next);
    writeHiddenPlayers(next);
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
  if (allMembers.length === 0 || hideAllNames) {
    return null;
  }

  return (
    <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-x-0.5 overflow-visible whitespace-nowrap text-[11px] leading-tight">
      {allMembers.map((member, index) => {
        const key = getMemberKey(member, characterRealm);
        const isHidden = hiddenKeys.has(key);

        if (isHidden) {
          return (
            <span key={key} className="inline-flex shrink-0 items-center whitespace-nowrap">
              {index > 0 ? (
                <span className="shrink-0 px-0.5 text-muted-foreground/25">/</span>
              ) : null}
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
            {index > 0 ? <span className="shrink-0 px-0.5 text-muted-foreground/25">/</span> : null}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex shrink-0 whitespace-nowrap font-medium decoration-current/40 underline-offset-2 hover:underline ${classColor(member.classTag ?? "")}`}
              title={`View ${member.name} on Raider.IO`}
            >
              {formatRunMemberName(member, characterRealm)}
            </a>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
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
        onClick={() => setOpen((current) => !current)}
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
      {open ? (
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
              {keys.length > 0 ? (
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
              ) : null}
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
      ) : null}
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

function RaiderIoScoreText({
  score,
  className,
  scoreKind = "overall",
}: {
  score?: number | null;
  className?: string;
  scoreKind?: "overall" | "dungeon";
}) {
  const color =
    scoreKind === "dungeon" ? getRaiderIoDungeonScoreColor(score) : getRaiderIoScoreColor(score);

  return (
    <span className={className} style={{ color }}>
      {formatRunScore(score)}
    </span>
  );
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

function MythicPlusSeasonHero({
  summary,
  currentSeason,
}: {
  summary: MythicPlusSummary;
  currentSeason: MythicPlusBucketSummary;
}) {
  const totalAttempts = currentSeason.totalAttempts ?? currentSeason.totalRuns;
  const timedRate =
    currentSeason.completedRuns > 0
      ? Math.round((currentSeason.timedRuns / currentSeason.completedRuns) * 100)
      : null;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)]">
      <div className="rounded-md border border-violet-400/25 bg-violet-400/10 p-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Current Score
        </div>
        <div className="mt-2 text-4xl font-bold leading-none tracking-tight">
          <RaiderIoScoreText score={summary.currentScore} className="tabular-nums" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Best timed</span>
          <MythicPlusKeyPill
            level={currentSeason.bestTimedLevel}
            upgradeCount={currentSeason.bestTimedUpgradeCount}
            compact
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatGrid compact label="Runs" value={totalAttempts.toLocaleString()} />
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
        <StatGrid compact label="Timed Rate" value={timedRate === null ? "-" : `${timedRate}%`} />
        <StatGrid
          compact
          label="Best Score"
          value={
            <RaiderIoScoreText
              score={currentSeason.bestTimedScore}
              className="tabular-nums"
              scoreKind="dungeon"
            />
          }
        />
      </div>
    </div>
  );
}

function MythicPlusKeyProfile({ currentSeason }: { currentSeason: MythicPlusBucketSummary }) {
  const buckets = [
    { label: "2-9", value: currentSeason.timed2To9 },
    { label: "10-11", value: currentSeason.timed10To11 },
    { label: "12-13", value: currentSeason.timed12To13 },
    { label: "14+", value: currentSeason.timed14Plus },
  ];
  const maxValue = Math.max(1, ...buckets.map((bucket) => bucket.value));

  return (
    <div className="rounded-md border border-border/60 bg-muted/10 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-foreground">Timed Key Profile</div>
        <div className="text-[11px] text-muted-foreground">
          {currentSeason.timedRuns.toLocaleString()} timed
        </div>
      </div>
      <div className="grid gap-2">
        {buckets.map((bucket) => {
          const percent = Math.max(4, Math.min(100, (bucket.value / maxValue) * 100));
          return (
            <div
              key={bucket.label}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)_2rem] items-center gap-2"
            >
              <div className="text-[11px] font-medium text-muted-foreground">+{bucket.label}</div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-400/80"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="text-right text-[11px] font-semibold tabular-nums text-foreground">
                {bucket.value.toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MythicPlusDungeonBestList({
  dungeons,
  currentScore,
}: {
  dungeons: MythicPlusDungeonSummary[];
  currentScore: number | null;
}) {
  if (dungeons.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border/60">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <Sword size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Dungeon Bests</h3>
        </div>
        {currentScore !== null ? (
          <div className="text-xs text-muted-foreground">
            Score <RaiderIoScoreText score={currentScore} className="font-semibold tabular-nums" />
          </div>
        ) : null}
      </div>
      <div className="divide-y divide-border/60">
        {dungeons.map((dungeon) => (
          <div
            key={`${dungeon.mapChallengeModeID ?? "map"}-${dungeon.mapName}`}
            className="grid grid-cols-[minmax(0,1fr)_3rem_4.5rem_4rem] items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/15"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <DungeonIcon
                mapChallengeModeID={dungeon.mapChallengeModeID}
                mapName={dungeon.mapName}
              />
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{dungeon.mapName}</div>
                <div className="text-[11px] text-muted-foreground">
                  {formatRunDuration(dungeon.bestTimedDurationMs)}
                </div>
              </div>
            </div>
            <div className="text-right text-xs tabular-nums text-muted-foreground">
              {dungeon.timedRuns}
            </div>
            <div className="text-right">
              <MythicPlusKeyPill
                level={dungeon.bestTimedLevel}
                upgradeCount={dungeon.bestTimedUpgradeCount}
                compact
              />
            </div>
            <div className="text-right text-sm font-semibold tabular-nums">
              <RaiderIoScoreText score={dungeon.bestTimedScore} scoreKind="dungeon" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MythicPlusSection({
  data,
  isLoadingAllRuns,
  onRequestAllRuns,
  characterRealm,
  characterRegion,
}: {
  data: MythicPlusData | null | undefined;
  isLoadingAllRuns: boolean;
  onRequestAllRuns: () => void;
  characterRealm: string;
  characterRegion: string;
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
  const recentRunsResetKey = `${data?.totalRunCount ?? 0}:${latestRunResetKey}`;
  const totalRunCount = data?.totalRunCount ?? 0;
  const hasMoreRecentRuns = visibleRecentRunCount < totalRunCount;

  useEffect(() => {
    setVisibleRecentRunCount(INITIAL_RECENT_RUN_COUNT);
  }, [recentRunsResetKey]);

  useEffect(() => {
    const summaryElement = summaryCardRef.current;
    if (!summaryElement || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateHeight = () => {
      setSummaryCardHeight(Math.ceil(summaryElement.getBoundingClientRect().height));
    };

    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
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
      <div className="space-y-4 [contain-intrinsic-size:720px] [content-visibility:auto]">
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
      </div>
    );
  }

  const currentSeason = summary.currentSeason;
  const visibleRecentRuns = runs.slice(0, Math.min(visibleRecentRunCount, runs.length));
  const nextRecentRunCount = Math.min(
    RECENT_RUN_LOAD_INCREMENT,
    totalRunCount - visibleRecentRunCount,
  );
  const shouldRequestAllRuns = data.isPreview;

  function loadMoreRecentRuns() {
    setVisibleRecentRunCount((currentValue) => {
      const nextVisibleCount = Math.min(currentValue + RECENT_RUN_LOAD_INCREMENT, totalRunCount);
      if (nextVisibleCount > runs.length && shouldRequestAllRuns) {
        onRequestAllRuns();
      }
      return nextVisibleCount;
    });
  }

  return (
    <div className="space-y-4 [contain-intrinsic-size:1200px] [content-visibility:auto]">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <div ref={summaryCardRef}>
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/10 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <History size={16} className="text-muted-foreground" />
                  Mythic+ Summary
                </CardTitle>
                {formatSeasonLabel(summary.latestSeasonID) ? (
                  <Badge variant="outline">{formatSeasonLabel(summary.latestSeasonID)}</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 px-4 py-4">
              {currentSeason ? (
                <>
                  <div className="flex items-center gap-2">
                    <Flame size={14} className="text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Current Season</h3>
                  </div>
                  <MythicPlusSeasonHero summary={summary} currentSeason={currentSeason} />
                  <MythicPlusKeyProfile currentSeason={currentSeason} />
                </>
              ) : null}
              <MythicPlusDungeonBestList
                dungeons={summary.currentSeasonDungeons}
                currentScore={summary.currentScore}
              />
            </CardContent>
          </Card>
        </div>

        <Card
          className="flex flex-col overflow-hidden"
          style={summaryCardHeight === null ? undefined : { height: `${summaryCardHeight}px` }}
        >
          <CardHeader className="border-b bg-muted/10 px-4 py-3">
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
          <CardContent className="flex min-h-0 flex-1 flex-col p-4">
            <div className="dark-scrollbar min-h-0 flex-1 overflow-auto rounded-md border border-border/60">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="sticky top-0 z-10 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Played</th>
                    <th className="px-3 py-2 text-left font-medium">Dungeon</th>
                    <th className="px-3 py-2 text-right font-medium">Key</th>
                    <th className="px-3 py-2 text-left font-medium">Result</th>
                    <th className="px-3 py-2 text-right font-medium">Score</th>
                    <th className="w-[7rem] whitespace-nowrap px-3 py-2 text-right font-medium">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {visibleRecentRuns.map((run) => (
                    <tr
                      key={getRecentRunRowKey(run)}
                      className="transition-colors hover:bg-muted/15"
                    >
                      <td className="px-3 py-2 align-top text-muted-foreground">
                        <RecentRunPlayedAt run={run} />
                      </td>
                      <td className="px-3 py-2 align-top">
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
                      <td className="px-3 py-2 align-top text-right">
                        <RecentRunKeyCell run={run} />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <MythicPlusResultBadge run={run} />
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <div className="flex items-center justify-end gap-1.5 tabular-nums">
                          <span>{formatRunScore(run.runScore)}</span>
                          {formatRunScoreIncrease(run.scoreIncrease) ? (
                            <span className="text-xs font-medium text-emerald-300">
                              (+{formatRunScoreIncrease(run.scoreIncrease)})
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="w-[7rem] whitespace-nowrap px-3 py-2 align-top text-right tabular-nums text-muted-foreground">
                        {formatRunTimeComparison(run)}
                      </td>
                    </tr>
                  ))}
                  {hasMoreRecentRuns ? (
                    <tr className="bg-muted/10">
                      <td colSpan={6} className="px-3 py-3 text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={loadMoreRecentRuns}
                          disabled={isLoadingAllRuns}
                        >
                          {isLoadingAllRuns ? "Loading more..." : `Load ${nextRecentRunCount} More`}
                        </Button>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
