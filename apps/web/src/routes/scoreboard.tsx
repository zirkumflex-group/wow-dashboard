import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import { Card, CardContent } from "@wow-dashboard/ui/components/card";
import { Checkbox } from "@wow-dashboard/ui/components/checkbox";
import { Input } from "@wow-dashboard/ui/components/input";
import { Progress } from "@wow-dashboard/ui/components/progress";
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

const HIDE_BELOW_90_KEY = "wow_dashboard_hide_below_90";
const MIN_ILVL_KEY = "wow_dashboard_min_ilvl";
const DEFAULT_MIN_ILVL = 200;

function readHideBelow90() {
  try {
    return localStorage.getItem(HIDE_BELOW_90_KEY) === "true";
  } catch {
    return false;
  }
}

function readMinIlvl() {
  try {
    const v = localStorage.getItem(MIN_ILVL_KEY);
    return v !== null ? Number(v) : DEFAULT_MIN_ILVL;
  } catch {
    return DEFAULT_MIN_ILVL;
  }
}

export const Route = createFileRoute("/scoreboard")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: "/" });
  },
  component: RouteComponent,
});

function classColor(cls: string) {
  return getClassTextColor(cls);
}

const MEDAL: Record<number, string> = { 0: "🥇", 1: "🥈", 2: "🥉" };

function RankCell({ rank }: { rank: number }) {
  if (rank < 3) {
    return <span className="text-base leading-none">{MEDAL[rank]}</span>;
  }
  return <span className="text-muted-foreground text-sm tabular-nums">{rank + 1}</span>;
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
  return gold.toLocaleString();
}

type CharSort = "mplus" | "ilvl";
type SortDir = "asc" | "desc";

function CharactersTab() {
  const entries = useQuery(api.characters.getScoreboard);
  const [sort, setSort] = useState<CharSort>("mplus");
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

  if (entries === undefined) {
    return (
      <Card>
        <CardContent className="space-y-3 py-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">No snapshots yet.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Characters need at least one snapshot to appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const filtered = entries.filter((e) => {
    if (e.spec === "Unknown") return false;
    if (hideBelow90 && e.level < 90) return false;
    if (minIlvl > 0 && e.itemLevel < minIlvl) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const diff =
      sort === "ilvl" ? a.itemLevel - b.itemLevel : a.mythicPlusScore - b.mythicPlusScore;
    return dir === "desc" ? -diff : diff;
  });

  const maxMplus = Math.max(...filtered.map((e) => e.mythicPlusScore));
  const maxIlvl = Math.max(...filtered.map((e) => e.itemLevel));

  function handleSort(col: CharSort) {
    if (sort === col) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSort(col);
      setDir("desc");
    }
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={hideBelow90}
            onCheckedChange={(v) => toggleHideBelow90(!!v)}
            id="scoreboard-hide-below-90"
          />
          <span className="text-muted-foreground select-none">Hide below Lvl 90</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground select-none">Min iLvl</span>
          <Input
            type="number"
            min={0}
            value={minIlvlInput}
            onChange={(e) => handleMinIlvlChange(e.target.value)}
            className="h-7 w-20 text-sm"
          />
        </label>
        {(hideBelow90 || minIlvl > 0) && entries && (
          <span className="text-muted-foreground text-xs">
            {filtered.length} / {entries.filter((e) => e.spec !== "Unknown").length} shown
          </span>
        )}
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">#</TableHead>
                <TableHead>Character</TableHead>
                <TableHead
                  className="hidden cursor-pointer select-none sm:table-cell"
                  onClick={() => handleSort("mplus")}
                >
                  M+ Score
                  <SortIcon column="mplus" sort={sort} direction={dir} />
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none text-right"
                  onClick={() => handleSort("ilvl")}
                >
                  Item Level
                  <SortIcon column="ilvl" sort={sort} direction={dir} />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((entry, i) => (
                <TableRow key={entry.characterId} className="group">
                  <TableCell className="w-10">
                    <RankCell rank={i} />
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/character/$characterId"
                      params={{ characterId: entry.characterId }}
                      className="block"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className={`font-semibold ${classColor(entry.class)}`}>
                          {entry.name}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {entry.spec} {entry.class}
                        </span>
                      </div>
                      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <span>
                          {entry.realm}-{entry.region.toUpperCase()}
                        </span>
                        <span>·</span>
                        <span
                          className={
                            entry.faction === "alliance" ? "text-blue-400" : "text-red-400"
                          }
                        >
                          {entry.faction}
                        </span>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-2">
                      <span className="w-14 text-right text-sm font-semibold tabular-nums">
                        {entry.mythicPlusScore.toLocaleString()}
                      </span>
                      <Progress
                        value={maxMplus > 0 ? (entry.mythicPlusScore / maxMplus) * 100 : 0}
                        className="w-24"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <span
                      className={`tabular-nums font-semibold ${sort === "ilvl" ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      {entry.itemLevel.toFixed(1)}
                    </span>
                    {sort === "ilvl" && (
                      <Progress
                        value={maxIlvl > 0 ? (entry.itemLevel / maxIlvl) * 100 : 0}
                        className="mt-0.5 h-1 w-16 ml-auto"
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

type PlayerSort = "playtime" | "gold";

function PlayersTab() {
  const entries = useQuery(api.characters.getPlayerScoreboard);
  const [sort, setSort] = useState<PlayerSort>("playtime");
  const [dir, setDir] = useState<SortDir>("desc");

  if (entries === undefined) {
    return (
      <Card>
        <CardContent className="space-y-3 py-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">No player data yet.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Players need at least one scanned character to appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...entries].sort((a, b) => {
    const diff =
      sort === "gold" ? a.totalGold - b.totalGold : a.totalPlaytimeSeconds - b.totalPlaytimeSeconds;
    return dir === "desc" ? -diff : diff;
  });

  const maxPlaytime = Math.max(...entries.map((e) => e.totalPlaytimeSeconds));
  const maxGold = Math.max(...entries.map((e) => e.totalGold));

  function handleSort(col: PlayerSort) {
    if (sort === col) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSort(col);
      setDir("desc");
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">#</TableHead>
              <TableHead>Player</TableHead>
              <TableHead
                className="hidden cursor-pointer select-none sm:table-cell"
                onClick={() => handleSort("playtime")}
              >
                Playtime
                <SortIcon column="playtime" sort={sort} direction={dir} />
              </TableHead>
              <TableHead
                className="hidden cursor-pointer select-none sm:table-cell"
                onClick={() => handleSort("gold")}
              >
                Gold
                <SortIcon column="gold" sort={sort} direction={dir} />
              </TableHead>
              {/* Mobile: show both in one column header */}
              <TableHead
                className="cursor-pointer select-none text-right sm:hidden"
                onClick={() => handleSort(sort === "playtime" ? "gold" : "playtime")}
              >
                {sort === "playtime" ? "Playtime" : "Gold"}
                <ArrowDown className="ml-1 inline h-3 w-3 opacity-50" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((entry, i) => (
              <TableRow key={i}>
                <TableCell className="w-10">
                  <RankCell rank={i} />
                </TableCell>
                <TableCell>
                  <p className="font-semibold">
                    {entry.battleTag ? entry.battleTag.split("#")[0] : `Player ${i + 1}`}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {entry.characterCount} character{entry.characterCount !== 1 ? "s" : ""}
                  </p>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-16 text-right text-sm tabular-nums font-semibold ${sort === "playtime" ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      {formatPlaytime(entry.totalPlaytimeSeconds)}
                    </span>
                    <Progress
                      value={maxPlaytime > 0 ? (entry.totalPlaytimeSeconds / maxPlaytime) * 100 : 0}
                      className="w-24"
                    />
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-16 text-right text-sm tabular-nums font-semibold ${sort === "gold" ? "text-yellow-400" : "text-muted-foreground"}`}
                    >
                      {formatGold(entry.totalGold)}
                    </span>
                    <Progress
                      value={maxGold > 0 ? (entry.totalGold / maxGold) * 100 : 0}
                      className="w-24"
                    />
                  </div>
                </TableCell>
                {/* Mobile */}
                <TableCell className="text-right sm:hidden">
                  <p className="text-sm font-semibold tabular-nums">
                    {formatPlaytime(entry.totalPlaytimeSeconds)}
                  </p>
                  <p className="text-xs font-semibold tabular-nums text-yellow-400">
                    {formatGold(entry.totalGold)}
                  </p>
                </TableCell>
              </TableRow>
            ))}
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
      ? "All characters ranked by M+ score, then item level"
      : "All players ranked by total playtime, then gold";

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Trophy className="h-7 w-7 text-yellow-400 transition-transform duration-200 hover:scale-110" />
          Scoreboard
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab((v ?? "characters") as Tab)}>
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
