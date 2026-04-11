import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import type { Id } from "@wow-dashboard/backend/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@wow-dashboard/ui/components/table";
import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { getClassTextColor } from "../lib/class-colors";
import { getMythicPlusDungeonMeta } from "../lib/mythic-plus-static";

export const Route = createFileRoute("/players/$playerId")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: "/" });
  },
  component: RouteComponent,
});

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
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getKeystoneDisplay(
  ownedKeystone:
    | {
        level: number;
        mapChallengeModeID?: number | null;
        mapName?: string | null;
      }
    | null
    | undefined,
) {
  if (!ownedKeystone) {
    return { key: "-", dungeon: "No keystone" };
  }

  const dungeonMeta = getMythicPlusDungeonMeta(
    ownedKeystone.mapChallengeModeID ?? undefined,
    ownedKeystone.mapName ?? undefined,
  );
  return {
    key: `+${ownedKeystone.level}`,
    dungeon:
      dungeonMeta?.shortName ??
      ownedKeystone.mapName ??
      (ownedKeystone.mapChallengeModeID !== undefined &&
      ownedKeystone.mapChallengeModeID !== null
        ? `Dungeon ${ownedKeystone.mapChallengeModeID}`
        : "Unknown"),
  };
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
        {helper && <p className="mt-1 text-xs text-muted-foreground">{helper}</p>}
      </CardContent>
    </Card>
  );
}

function RouteComponent() {
  const { playerId } = Route.useParams();
  const data = useQuery(api.characters.getPlayerCharacters, {
    playerId: playerId as Id<"players">,
  });

  if (data === undefined) {
    return (
      <div className="w-full space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <Card className="border-dashed">
          <CardContent className="space-y-2 py-12 text-center">
            <p className="text-muted-foreground">Player not found.</p>
            <Link to="/scoreboard" className="text-sm text-primary hover:underline">
              Back to scoreboard
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const playerName = data.player.battleTag ? data.player.battleTag.split("#")[0] : "Player";
  const bestKey = getKeystoneDisplay(data.summary.bestKeystone);

  return (
    <div className="w-full space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div className="space-y-3">
        <Link
          to="/scoreboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to scoreboard
        </Link>
        <div>
          <h1 className="text-3xl font-bold">{playerName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.player.battleTag || "No BattleTag"} - Character roster and current snapshot stats
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Tracked" value={data.summary.trackedCharacters.toLocaleString()} />
        <StatCard
          label="Total M+"
          value={Math.round(data.summary.totalMythicPlusScore).toLocaleString()}
        />
        <StatCard
          label="Avg iLvl"
          value={
            data.summary.averageItemLevel === null ? "-" : data.summary.averageItemLevel.toFixed(1)
          }
        />
        <StatCard label="Total Playtime" value={formatPlaytime(data.summary.totalPlaytimeSeconds)} />
        <StatCard label="Total Gold" value={formatGold(data.summary.totalGold)} />
        <StatCard
          label="Best Key"
          value={bestKey.key}
          helper={bestKey.dungeon === "No keystone" ? undefined : bestKey.dungeon}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Characters ({data.characters.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Character</TableHead>
                <TableHead className="hidden md:table-cell">Spec</TableHead>
                <TableHead className="text-right">iLvl</TableHead>
                <TableHead className="hidden text-right sm:table-cell">M+ Score</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Keystone</TableHead>
                <TableHead className="hidden text-right xl:table-cell">Playtime</TableHead>
                <TableHead className="text-right">Gold</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Snapshot</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.characters.map((character) => {
                const snapshot = character.snapshot;
                const keystone = getKeystoneDisplay(snapshot?.ownedKeystone);

                return (
                  <TableRow key={character._id}>
                    <TableCell>
                      <div className="space-y-0.5">
                        <Link
                          to="/character/$characterId"
                          params={{ characterId: character._id }}
                          className={`font-semibold hover:underline ${classColor(character.class)}`}
                        >
                          {character.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {character.realm}-{character.region.toUpperCase()} - {character.race}{" "}
                          {character.class}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {snapshot ? (
                        <div className="leading-tight">
                          <p className="text-sm">
                            {snapshot.spec} - Lvl {snapshot.level}
                          </p>
                          <p className="text-xs text-muted-foreground capitalize">{snapshot.role}</p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No snapshot</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {snapshot ? snapshot.itemLevel.toFixed(1) : "-"}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {snapshot ? snapshot.mythicPlusScore.toLocaleString() : "-"}
                    </TableCell>
                    <TableCell className="hidden text-right lg:table-cell">
                      <div className="flex flex-col items-end leading-tight">
                        <span className="font-semibold tabular-nums">{keystone.key}</span>
                        <span className="text-[11px] text-muted-foreground">{keystone.dungeon}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums xl:table-cell">
                      {snapshot ? formatPlaytime(snapshot.playtimeSeconds) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {snapshot ? formatGold(snapshot.gold) : "-"}
                    </TableCell>
                    <TableCell className="hidden text-right text-xs text-muted-foreground lg:table-cell">
                      {snapshot ? formatSnapshotDate(snapshot.takenAt) : "-"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
