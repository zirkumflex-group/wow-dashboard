import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { Progress } from "@wow-dashboard/ui/components/progress";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@wow-dashboard/ui/components/tabs";
import { useQuery } from "convex/react";
import { Trophy, Users } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/scoreboard")({
  component: RouteComponent,
});

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

function classColor(cls: string) {
  return CLASS_COLORS[cls.toLowerCase()] ?? "text-foreground";
}

const MEDAL: Record<number, string> = { 0: "🥇", 1: "🥈", 2: "🥉" };

function RankBadge({ rank }: { rank: number }) {
  if (rank < 3) {
    return <span className="text-lg leading-none">{MEDAL[rank]}</span>;
  }
  return (
    <span className="text-muted-foreground w-7 text-right text-sm tabular-nums">{rank + 1}</span>
  );
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-right text-sm font-semibold tabular-nums">
        {score.toLocaleString()}
      </span>
      <Progress value={pct} className="flex-1" />
    </div>
  );
}

function StatBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return <Progress value={pct} className="w-full" />;
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

type Tab = "characters" | "players";

type CharSort = "mplus" | "ilvl";

function CharactersTab() {
  const entries = useQuery(api.characters.getScoreboard);
  const [sort, setSort] = useState<CharSort>("mplus");

  if (entries === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading…</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 10 }).map((_, i) => (
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
          <p className="text-muted-foreground">No snapshots yet.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Characters need at least one snapshot to appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sorted = [...entries].sort((a, b) =>
    sort === "ilvl" ? b.itemLevel - a.itemLevel : b.mythicPlusScore - a.mythicPlusScore,
  );
  const maxMplus = Math.max(...sorted.map((e) => e.mythicPlusScore));
  const maxIlvl = Math.max(...sorted.map((e) => e.itemLevel));

  return (
    <Card>
      <CardHeader className="border-b pb-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Sort by</span>
          <button
            onClick={() => setSort("mplus")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${sort === "mplus" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            M+ Score
          </button>
          <button
            onClick={() => setSort("ilvl")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${sort === "ilvl" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            Item Level
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {sorted.map((entry, i) => (
            <Link
              key={entry.characterId}
              to="/character/$characterId"
              params={{ characterId: entry.characterId }}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              {/* Rank */}
              <div className="flex w-7 shrink-0 items-center justify-center">
                <RankBadge rank={i} />
              </div>

              {/* Character info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`font-semibold ${classColor(entry.class)}`}>{entry.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {entry.spec} {entry.class}
                  </span>
                </div>
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <span>
                    {entry.realm}-{entry.region.toUpperCase()}
                  </span>
                  <span>·</span>
                  <span className={entry.faction === "alliance" ? "text-blue-400" : "text-red-400"}>
                    {entry.battleTag}
                  </span>
                </div>
              </div>

              {/* M+ score with bar */}
              <div className="hidden w-40 shrink-0 sm:block">
                <p className="text-muted-foreground mb-0.5 text-xs">M+ Score</p>
                <ScoreBar score={entry.mythicPlusScore} max={maxMplus} />
              </div>

              {/* Item level */}
              <div className="shrink-0 text-right">
                <p
                  className={`text-xs ${sort === "ilvl" ? "text-foreground font-medium" : "text-muted-foreground"}`}
                >
                  iLvl
                </p>
                <p className={`tabular-nums ${sort === "ilvl" ? "font-bold" : "font-semibold"}`}>
                  {entry.itemLevel.toFixed(1)}
                </p>
                {sort === "ilvl" && (
                  <div className="mt-0.5 w-16">
                    <Progress
                      value={maxIlvl > 0 ? (entry.itemLevel / maxIlvl) * 100 : 0}
                      className="h-1"
                    />
                  </div>
                )}
              </div>

              {/* M+ score (mobile only) */}
              <div className="shrink-0 text-right sm:hidden">
                <p className="text-muted-foreground text-xs">M+</p>
                <p className="font-semibold tabular-nums">
                  {entry.mythicPlusScore.toLocaleString()}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type PlayerSort = "playtime" | "gold";

function PlayersTab() {
  const entries = useQuery(api.characters.getPlayerScoreboard);
  const [sort, setSort] = useState<PlayerSort>("playtime");

  if (entries === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading…</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
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

  const sorted = [...entries].sort((a, b) =>
    sort === "gold" ? b.totalGold - a.totalGold : b.totalPlaytimeSeconds - a.totalPlaytimeSeconds,
  );
  const maxPlaytime = Math.max(...sorted.map((e) => e.totalPlaytimeSeconds));
  const maxGold = Math.max(...sorted.map((e) => e.totalGold));

  return (
    <Card>
      <CardHeader className="border-b pb-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">Sort by</span>
          <button
            onClick={() => setSort("playtime")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${sort === "playtime" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            Playtime
          </button>
          <button
            onClick={() => setSort("gold")}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${sort === "gold" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            Gold
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {sorted.map((entry, i) => (
            <div key={entry.battleTag} className="flex items-center gap-3 px-4 py-3">
              {/* Rank */}
              <div className="flex w-7 shrink-0 items-center justify-center">
                <RankBadge rank={i} />
              </div>

              {/* Player info */}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{entry.battleTag}</p>
                <p className="text-muted-foreground text-xs">
                  {entry.characterCount} character{entry.characterCount !== 1 ? "s" : ""}
                </p>
              </div>

              {/* Playtime */}
              <div className="hidden w-44 shrink-0 sm:block">
                <div className="flex items-center justify-between mb-0.5">
                  <p
                    className={`text-xs ${sort === "playtime" ? "text-foreground font-medium" : "text-muted-foreground"}`}
                  >
                    Playtime
                  </p>
                  <p className="text-xs font-semibold tabular-nums">
                    {formatPlaytime(entry.totalPlaytimeSeconds)}
                  </p>
                </div>
                <StatBar value={entry.totalPlaytimeSeconds} max={maxPlaytime} />
              </div>

              {/* Gold */}
              <div className="hidden w-36 shrink-0 sm:block">
                <div className="flex items-center justify-between mb-0.5">
                  <p
                    className={`text-xs ${sort === "gold" ? "text-foreground font-medium" : "text-muted-foreground"}`}
                  >
                    Gold
                  </p>
                  <p className="text-xs font-semibold tabular-nums text-yellow-400">
                    {formatGold(entry.totalGold)}
                  </p>
                </div>
                <StatBar value={entry.totalGold} max={maxGold} />
              </div>

              {/* Mobile: playtime + gold */}
              <div className="shrink-0 text-right sm:hidden">
                <p className="text-muted-foreground text-xs">Playtime</p>
                <p className="font-semibold tabular-nums text-sm">
                  {formatPlaytime(entry.totalPlaytimeSeconds)}
                </p>
              </div>
              <div className="shrink-0 text-right sm:hidden">
                <p className="text-muted-foreground text-xs">Gold</p>
                <p className="font-semibold tabular-nums text-sm text-yellow-400">
                  {formatGold(entry.totalGold)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Scoreboard() {
  const [tab, setTab] = useState<Tab>("characters");

  const subtitle =
    tab === "characters"
      ? "All characters ranked by M+ score, then item level"
      : "All players ranked by total playtime, then gold";

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold flex items-center gap-2">
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
