import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import { Badge } from "@wow-dashboard/ui/components/badge";
import { Card, CardContent } from "@wow-dashboard/ui/components/card";
import { Checkbox } from "@wow-dashboard/ui/components/checkbox";
import { Input } from "@wow-dashboard/ui/components/input";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@wow-dashboard/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@wow-dashboard/ui/components/tabs";
import { useQuery } from "convex/react";
import { ArrowDown, ArrowUp, ArrowUpDown, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { getClassTextColor } from "../lib/class-colors";
import { getMythicPlusDungeonMeta, getRaiderIoScoreColor } from "../lib/mythic-plus-static";

const HIDE_BELOW_90_KEY = "wow_dashboard_hide_below_90";
const MIN_ILVL_KEY = "wow_dashboard_min_ilvl";
const DEFAULT_MIN_ILVL = 200;

export const Route = createFileRoute("/scoreboard")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: "/" });
  },
  component: RouteComponent,
});

function readHideBelow90() {
  try {
    return localStorage.getItem(HIDE_BELOW_90_KEY) === "true";
  } catch {
    return false;
  }
}

function readMinIlvl() {
  try {
    const value = localStorage.getItem(MIN_ILVL_KEY);
    return value !== null ? Number(value) : DEFAULT_MIN_ILVL;
  } catch {
    return DEFAULT_MIN_ILVL;
  }
}

function classColor(className: string) {
  return getClassTextColor(className);
}

function formatPlaytime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatGold(gold: number) {
  if (gold >= 1_000_000) return `${(gold / 1_000_000).toFixed(1)}M`;
  if (gold >= 1_000) return `${(gold / 1_000).toFixed(1)}k`;
  return Math.floor(gold).toLocaleString();
}

function formatSnapshotDate(takenAt: number) {
  return new Date(takenAt * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getDisplayNameFromBattleTag(battleTag: string, fallbackRank: number) {
  if (!battleTag) return `Player ${fallbackRank}`;
  return battleTag.split("#")[0] ?? battleTag;
}

function getKeystoneDisplay(
  ownedKeystone:
    | {
        level: number;
        mapChallengeModeID?: number;
        mapName?: string;
      }
    | null
    | undefined,
) {
  if (!ownedKeystone) {
    return { key: "-", dungeon: "No keystone" };
  }

  const dungeonMeta = getMythicPlusDungeonMeta(
    ownedKeystone.mapChallengeModeID,
    ownedKeystone.mapName,
  );
  return {
    key: `+${ownedKeystone.level}`,
    dungeon:
      dungeonMeta?.shortName ??
      ownedKeystone.mapName ??
      (ownedKeystone.mapChallengeModeID !== undefined
        ? `Dungeon ${ownedKeystone.mapChallengeModeID}`
        : "Unknown"),
  };
}

function RankBadge({ rank }: { rank: number }) {
  const isTopThree = rank < 3;
  const tone =
    rank === 0
      ? "border-amber-400/50 bg-amber-500/15 text-amber-300"
      : rank === 1
        ? "border-slate-300/50 bg-slate-400/15 text-slate-200"
        : rank === 2
          ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
          : "border-border bg-muted/40 text-muted-foreground";

  return (
    <div
      className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold tabular-nums ${tone} ${isTopThree ? "shadow-sm" : ""}`}
    >
      {rank + 1}
    </div>
  );
}

function SortIcon({
  column,
  sort,
  direction,
}: {
  column: string;
  sort: string;
  direction: "asc" | "desc";
}) {
  if (sort !== column) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-50" />;
  return direction === "desc" ? (
    <ArrowDown className="ml-1 inline h-3 w-3" />
  ) : (
    <ArrowUp className="ml-1 inline h-3 w-3" />
  );
}

function MetricTile({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold leading-none">{value}</p>
      {helper && <p className="mt-1 truncate text-[11px] text-muted-foreground">{helper}</p>}
    </div>
  );
}

type SortDir = "asc" | "desc";
type CharacterSort = "mplus" | "ilvl" | "key" | "playtime";
type PlayerSort = "mplus" | "playtime" | "gold";

function CharactersTab() {
  const entries = useQuery(api.characters.getScoreboard);
  const [sort, setSort] = useState<CharacterSort>("mplus");
  const [dir, setDir] = useState<SortDir>("desc");
  const [hideBelow90, setHideBelow90] = useState<boolean>(() => readHideBelow90());
  const [minIlvlInput, setMinIlvlInput] = useState<string>(() => String(readMinIlvl()));

  const minIlvl = Number(minIlvlInput) || 0;

  function toggleHideBelow90(checked: boolean) {
    setHideBelow90(checked);
    try {
      localStorage.setItem(HIDE_BELOW_90_KEY, String(checked));
    } catch {}
  }

  function handleMinIlvlChange(value: string) {
    setMinIlvlInput(value);
    try {
      localStorage.setItem(MIN_ILVL_KEY, value);
    } catch {}
  }

  function handleSort(nextSort: CharacterSort) {
    if (sort === nextSort) {
      setDir((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSort(nextSort);
    setDir("desc");
  }

  if (entries === undefined) {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, index) => (
          <Skeleton key={index} className="h-52 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">No snapshots yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Characters need at least one snapshot to appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const filtered = entries.filter((entry) => {
    if (hideBelow90 && entry.level < 90) return false;
    if (minIlvl > 0 && entry.itemLevel < minIlvl) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const valueA =
      sort === "ilvl"
        ? a.itemLevel
        : sort === "key"
          ? (a.ownedKeystone?.level ?? -1)
          : sort === "playtime"
            ? a.playtimeSeconds
            : a.mythicPlusScore;
    const valueB =
      sort === "ilvl"
        ? b.itemLevel
        : sort === "key"
          ? (b.ownedKeystone?.level ?? -1)
          : sort === "playtime"
            ? b.playtimeSeconds
            : b.mythicPlusScore;

    const diff = valueA - valueB;
    if (diff !== 0) {
      return dir === "desc" ? -diff : diff;
    }

    return b.mythicPlusScore - a.mythicPlusScore || b.itemLevel - a.itemLevel;
  });

  const averageIlvl =
    filtered.length > 0 ? filtered.reduce((sum, entry) => sum + entry.itemLevel, 0) / filtered.length : 0;
  const averageMythicPlus =
    filtered.length > 0
      ? filtered.reduce((sum, entry) => sum + entry.mythicPlusScore, 0) / filtered.length
      : 0;
  const keyedCharacters = filtered.filter((entry) => entry.ownedKeystone).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={hideBelow90}
            onCheckedChange={(value) => toggleHideBelow90(!!value)}
            id="scoreboard-hide-below-90"
          />
          <span className="select-none text-muted-foreground">Hide below Lvl 90</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="select-none text-muted-foreground">Min iLvl</span>
          <Input
            type="number"
            min={0}
            value={minIlvlInput}
            onChange={(event) => handleMinIlvlChange(event.target.value)}
            className="h-8 w-24 text-sm"
          />
        </label>
        <span className="text-xs text-muted-foreground">
          {filtered.length} / {entries.length} shown
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          { id: "mplus", label: "M+ Score" },
          { id: "ilvl", label: "Item Level" },
          { id: "key", label: "Keystone" },
          { id: "playtime", label: "Playtime" },
        ] as const).map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => handleSort(option.id)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              sort === option.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {option.label}
            <SortIcon column={option.id} sort={sort} direction={dir} />
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile label="Characters" value={filtered.length.toLocaleString()} />
        <MetricTile label="Avg iLvl" value={averageIlvl.toFixed(1)} />
        <MetricTile
          label="Avg M+ Score"
          value={Math.round(averageMythicPlus).toLocaleString()}
          helper={`${keyedCharacters} with active keystone`}
        />
      </div>

      {sorted.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No characters match the active filters.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((entry, index) => {
            const keystone = getKeystoneDisplay(entry.ownedKeystone);
            const scoreColor = getRaiderIoScoreColor(entry.mythicPlusScore) ?? "#f8fafc";

            return (
              <Card key={entry.characterId} className="border-border/70">
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <RankBadge rank={index} />
                      <div>
                        <Link
                          to="/character/$characterId"
                          params={{ characterId: entry.characterId }}
                          className={`text-base font-semibold hover:underline ${classColor(entry.class)}`}
                        >
                          {entry.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {entry.spec} {entry.class} - Lvl {entry.level}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {entry.realm}-{entry.region.toUpperCase()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-muted-foreground">M+ Score</p>
                      <p className="text-lg font-semibold tabular-nums" style={{ color: scoreColor }}>
                        {entry.mythicPlusScore.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <MetricTile label="Item Level" value={entry.itemLevel.toFixed(1)} />
                    <MetricTile label="Keystone" value={keystone.key} helper={keystone.dungeon} />
                    <MetricTile label="Playtime" value={formatPlaytime(entry.playtimeSeconds)} />
                    <MetricTile label="Gold" value={formatGold(entry.gold)} />
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <Badge
                      variant="outline"
                      className={
                        entry.faction === "alliance"
                          ? "border-blue-500/40 bg-blue-500/10 text-blue-400 uppercase"
                          : "border-red-500/40 bg-red-500/10 text-red-400 uppercase"
                      }
                    >
                      {entry.faction}
                    </Badge>
                    <span>Snapshot {formatSnapshotDate(entry.takenAt)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlayersTab() {
  const entries = useQuery(api.characters.getPlayerScoreboard);
  const [sort, setSort] = useState<PlayerSort>("mplus");
  const [dir, setDir] = useState<SortDir>("desc");

  function handleSort(nextSort: PlayerSort) {
    if (sort === nextSort) {
      setDir((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSort(nextSort);
    setDir("desc");
  }

  if (entries === undefined) {
    return (
      <Card>
        <CardContent className="space-y-3 py-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">No player data yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Players need at least one scanned character to appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...entries].sort((a, b) => {
    const valueA =
      sort === "playtime"
        ? a.totalPlaytimeSeconds
        : sort === "gold"
          ? a.totalGold
          : a.totalMythicPlusScore;
    const valueB =
      sort === "playtime"
        ? b.totalPlaytimeSeconds
        : sort === "gold"
          ? b.totalGold
          : b.totalMythicPlusScore;
    const diff = valueA - valueB;
    if (diff !== 0) {
      return dir === "desc" ? -diff : diff;
    }

    return b.totalMythicPlusScore - a.totalMythicPlusScore;
  });

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">#</TableHead>
              <TableHead>Player</TableHead>
              <TableHead
                className="cursor-pointer select-none text-right"
                onClick={() => handleSort("mplus")}
              >
                Total M+ Score
                <SortIcon column="mplus" sort={sort} direction={dir} />
              </TableHead>
              <TableHead className="hidden text-right sm:table-cell">Avg iLvl</TableHead>
              <TableHead className="hidden text-right md:table-cell">Best Key</TableHead>
              <TableHead
                className="hidden cursor-pointer select-none text-right lg:table-cell"
                onClick={() => handleSort("playtime")}
              >
                Playtime
                <SortIcon column="playtime" sort={sort} direction={dir} />
              </TableHead>
              <TableHead
                className="cursor-pointer select-none text-right"
                onClick={() => handleSort("gold")}
              >
                Gold
                <SortIcon column="gold" sort={sort} direction={dir} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((entry, index) => {
              const displayName = getDisplayNameFromBattleTag(entry.battleTag, index + 1);
              const keystone = getKeystoneDisplay(
                entry.bestKeystoneLevel === null
                  ? null
                  : {
                      level: entry.bestKeystoneLevel,
                      mapChallengeModeID: entry.bestKeystoneMapChallengeModeID ?? undefined,
                      mapName: entry.bestKeystoneMapName ?? undefined,
                    },
              );

              return (
                <TableRow key={entry.playerId}>
                  <TableCell className="w-10">
                    <RankBadge rank={index} />
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/players/$playerId"
                      params={{ playerId: entry.playerId }}
                      className="font-semibold hover:underline"
                    >
                      {displayName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {entry.characterCount} character{entry.characterCount !== 1 ? "s" : ""}
                    </p>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {Math.round(entry.totalMythicPlusScore).toLocaleString()}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {entry.averageItemLevel.toFixed(1)}
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    <div className="flex flex-col items-end leading-tight">
                      <span className="font-semibold tabular-nums">{keystone.key}</span>
                      <span className="text-[11px] text-muted-foreground">{keystone.dungeon}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">
                    {formatPlaytime(entry.totalPlaytimeSeconds)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatGold(entry.totalGold)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

type Tab = "characters" | "players";

function Scoreboard() {
  const [tab, setTab] = useState<Tab>("characters");

  const subtitle =
    tab === "characters"
      ? "Character ranking with keystones, progression, and activity."
      : "Player aggregates with click-through character rosters.";

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Trophy className="h-7 w-7 text-yellow-400" />
          Scoreboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab((value ?? "characters") as Tab)}>
        <TabsList className="mb-4">
          <TabsTrigger value="characters" className="flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5" />
            Characters
          </TabsTrigger>
          <TabsTrigger value="players" className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            Players
          </TabsTrigger>
        </TabsList>
        <TabsContent value="characters">
          <CharactersTab />
        </TabsContent>
        <TabsContent value="players">
          <PlayersTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RouteComponent() {
  return <Scoreboard />;
}
