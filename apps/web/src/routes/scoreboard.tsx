import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
import { useQuery } from "convex/react";
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
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatBar({
  value,
  max,
  color = "bg-blue-500",
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
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

type Tab = "characters" | "players";

function TabSwitch({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted p-1 text-sm">
      <button
        onClick={() => onChange("characters")}
        className={`rounded-md px-3 py-1 transition-colors ${
          tab === "characters"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Characters
      </button>
      <button
        onClick={() => onChange("players")}
        className={`rounded-md px-3 py-1 transition-colors ${
          tab === "players"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Players
      </button>
    </div>
  );
}

function CharactersTab() {
  const entries = useQuery(api.characters.getScoreboard);
  const maxMplus = entries?.[0]?.mythicPlusScore ?? 0;

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

  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {entries.map((entry, i) => (
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
                <p className="text-muted-foreground text-xs">iLvl</p>
                <p className="font-semibold tabular-nums">{entry.itemLevel.toFixed(1)}</p>
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

function PlayersTab() {
  const entries = useQuery(api.characters.getPlayerScoreboard);

  const maxPlaytime = entries?.[0]?.totalPlaytimeSeconds ?? 0;
  const maxGold = Math.max(...(entries?.map((e) => e.totalGold) ?? [0]));

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

  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {entries.map((entry, i) => (
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
                  <p className="text-muted-foreground text-xs">Playtime</p>
                  <p className="text-xs font-semibold tabular-nums">
                    {formatPlaytime(entry.totalPlaytimeSeconds)}
                  </p>
                </div>
                <StatBar
                  value={entry.totalPlaytimeSeconds}
                  max={maxPlaytime}
                  color="bg-violet-500"
                />
              </div>

              {/* Gold */}
              <div className="hidden w-36 shrink-0 sm:block">
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-muted-foreground text-xs">Gold</p>
                  <p className="text-xs font-semibold tabular-nums text-yellow-400">
                    {formatGold(entry.totalGold)}
                  </p>
                </div>
                <StatBar value={entry.totalGold} max={maxGold} color="bg-yellow-500" />
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
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Scoreboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
        </div>
        <Link
          to="/dashboard"
          className="text-muted-foreground hover:text-foreground shrink-0 text-sm transition-colors mt-1"
        >
          ← Dashboard
        </Link>
      </div>

      <div className="mb-4">
        <TabSwitch tab={tab} onChange={setTab} />
      </div>

      {tab === "characters" ? <CharactersTab /> : <PlayersTab />}
    </div>
  );
}

function RouteComponent() {
  return <Scoreboard />;
}
