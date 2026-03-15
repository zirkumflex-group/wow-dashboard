import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
import { useQuery } from "convex/react";

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

function Scoreboard() {
  const entries = useQuery(api.characters.getScoreboard);

  const maxMplus = entries?.[0]?.mythicPlusScore ?? 0;

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Scoreboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            All characters ranked by M+ score, then item level
          </p>
        </div>
        <Link
          to="/dashboard"
          className="text-muted-foreground hover:text-foreground shrink-0 text-sm transition-colors mt-1"
        >
          ← Dashboard
        </Link>
      </div>

      {entries === undefined ? (
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
      ) : entries.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">No snapshots yet.</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Characters need at least one snapshot to appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
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
                      <span className={`font-semibold ${classColor(entry.class)}`}>
                        {entry.name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {entry.spec} {entry.class}
                      </span>
                    </div>
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                      <span>
                        {entry.realm}-{entry.region.toUpperCase()}
                      </span>
                      <span>·</span>
                      <span
                        className={entry.faction === "alliance" ? "text-blue-400" : "text-red-400"}
                      >
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
      )}
    </div>
  );
}

function RouteComponent() {
  return <Scoreboard />;
}
