import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import type { SearchSchemaInput } from "@tanstack/react-router";
import { Button } from "@wow-dashboard/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@wow-dashboard/ui/components/toggle-group";
import Scale from "lucide-react/dist/esm/icons/scale.mjs";
import { lazy, Suspense, useEffect, useMemo } from "react";

import { apiQueryOptions } from "@/lib/api-client";
import {
  COMPARE_STAT_OPTIONS,
  COMPARE_TIME_FRAME_OPTIONS,
  isCompareStatKey,
  isCompareTimeFrame,
  type CharacterTimeline,
  type CompareSnapshot,
  type CompareStatKey,
  type CompareTimeFrame,
} from "@/lib/compare";
import { getClassTextColor } from "../lib/class-colors";

const LazyCompareChart = lazy(() =>
  import("@/components/compare-chart").then((module) => ({ default: module.CompareChart })),
);

const DEFAULT_STAT = "mythicPlusScore" satisfies CompareStatKey;
const DEFAULT_TIME_FRAME = "30d" satisfies CompareTimeFrame;

type CompareSearch = {
  characters: string;
  stat: CompareStatKey;
  timeFrame: CompareTimeFrame;
};

type CompareSearchInput = SearchSchemaInput & Partial<CompareSearch>;

function normalizeCharacterIds(value: unknown) {
  if (typeof value !== "string") return "";
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => /^[a-zA-Z0-9_-]{1,128}$/.test(item)),
    ),
  ]
    .slice(0, 4)
    .join(",");
}

function validateCompareSearch(search: CompareSearchInput): CompareSearch {
  return {
    characters: normalizeCharacterIds(search.characters),
    stat: isCompareStatKey(search.stat) ? search.stat : DEFAULT_STAT,
    timeFrame: isCompareTimeFrame(search.timeFrame) ? search.timeFrame : DEFAULT_TIME_FRAME,
  };
}

export const Route = createFileRoute("/compare")({
  validateSearch: validateCompareSearch,
  search: {
    middlewares: [
      stripSearchParams({
        characters: "",
        stat: DEFAULT_STAT,
        timeFrame: DEFAULT_TIME_FRAME,
      }),
    ],
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(apiQueryOptions.scoreboardCharacters());
    return { nowSeconds: Math.floor(Date.now() / 1000) };
  },
  component: RouteComponent,
});

function classColor(className: string) {
  return getClassTextColor(className);
}

function RouteComponent() {
  const { nowSeconds } = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const scoreboardQuery = useQuery(apiQueryOptions.scoreboardCharacters());
  const scoreboardEntries = scoreboardQuery.data ?? [];

  const availableCharacterIds = useMemo(
    () => new Set(scoreboardEntries.map((entry) => entry.characterId)),
    [scoreboardEntries],
  );
  const selectedCharacterIds = useMemo(
    () =>
      search.characters
        .split(",")
        .filter((characterId) => availableCharacterIds.has(characterId))
        .slice(0, 4),
    [availableCharacterIds, search.characters],
  );
  const timelineCharacterIds = selectedCharacterIds.length >= 2 ? selectedCharacterIds : [];

  const snapshotQueries = useQueries({
    queries: timelineCharacterIds.map((characterId) =>
      apiQueryOptions.characterSnapshotTimeline(characterId, { timeFrame: search.timeFrame }),
    ),
  });

  function updateSearch(patch: Partial<CompareSearch>) {
    void navigate({
      replace: true,
      search: (current) => ({ ...current, ...patch }),
    });
  }

  function toggleCharacter(characterId: string) {
    const nextCharacterIds = selectedCharacterIds.includes(characterId)
      ? selectedCharacterIds.filter((id) => id !== characterId)
      : [...selectedCharacterIds, characterId].slice(0, 4);
    updateSearch({ characters: nextCharacterIds.join(",") });
  }

  const characterTimelines = useMemo(
    () =>
      timelineCharacterIds
        .map((characterId, index) => {
          const result = snapshotQueries[index]?.data;
          if (!result) return null;

          const entry = scoreboardEntries.find(
            (candidate) => candidate.characterId === characterId,
          );
          return {
            key: `char_${index}`,
            name: entry?.name ?? characterId,
            snapshots: result.snapshots as CompareSnapshot[],
          };
        })
        .filter((timeline): timeline is CharacterTimeline => timeline !== null),
    [scoreboardEntries, snapshotQueries, timelineCharacterIds],
  );

  const selectedLabels = selectedCharacterIds
    .map(
      (characterId) =>
        scoreboardEntries.find((entry) => entry.characterId === characterId)?.name ?? characterId,
    )
    .join(", ");

  useEffect(() => {
    const appTitle = "WoW Dashboard";
    if (selectedCharacterIds.length === 0) {
      document.title = `Compare | ${appTitle}`;
      return;
    }

    const selectedNames = selectedCharacterIds.map(
      (characterId) =>
        scoreboardEntries.find((entry) => entry.characterId === characterId)?.name ?? characterId,
    );
    const compactLabel = selectedNames.slice(0, 2).join(" vs ");
    const overflowLabel = selectedNames.length > 2 ? ` +${selectedNames.length - 2}` : "";
    document.title = `${compactLabel}${overflowLabel} | Compare | ${appTitle}`;
  }, [scoreboardEntries, selectedCharacterIds]);

  const isLoadingSnapshots = snapshotQueries.some((query) => query.isPending);
  const snapshotError = snapshotQueries.find((query) => query.isError)?.error;
  const hasEnoughCharacters = characterTimelines.length >= 2;
  const statLabel =
    COMPARE_STAT_OPTIONS.find((option) => option.key === search.stat)?.label ?? search.stat;

  return (
    <div className="analytics-shell w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <p className="analytics-kicker text-primary">Cross-Character / Timeline</p>
        <h1 className="mt-2 flex items-center gap-2 text-3xl font-bold tracking-tight">
          <Scale aria-hidden="true" className="h-7 w-7 text-muted-foreground" />
          Compare
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compare core progression metrics with stable UTC day alignment.
        </p>
      </div>

      <Card className="analytics-panel">
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-sm font-medium">
            Characters{" "}
            <span className="font-normal text-muted-foreground">
              ({selectedCharacterIds.length}/4 selected)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {scoreboardQuery.isPending ? (
            <div className="flex flex-wrap gap-2" aria-label="Loading characters" role="status">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-28" />
              ))}
            </div>
          ) : scoreboardQuery.isError ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">Characters could not be loaded.</p>
              <Button variant="outline" size="sm" onClick={() => void scoreboardQuery.refetch()}>
                Try Again
              </Button>
            </div>
          ) : scoreboardEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No characters found.</p>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Characters to compare">
              {scoreboardEntries.map((entry) => {
                const isSelected = selectedCharacterIds.includes(entry.characterId);
                const isDisabled = !isSelected && selectedCharacterIds.length >= 4;
                return (
                  <button
                    key={entry.characterId}
                    type="button"
                    disabled={isDisabled}
                    aria-pressed={isSelected}
                    onClick={() => toggleCharacter(entry.characterId)}
                    className={[
                      "flex min-h-9 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isSelected
                        ? "border-primary bg-primary/10"
                        : isDisabled
                          ? "cursor-not-allowed border-border/40 opacity-40"
                          : "border-border hover:border-primary/40 hover:bg-muted/40",
                    ].join(" ")}
                  >
                    <span className={classColor(entry.class)}>{entry.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {entry.spec} {entry.class}
                    </span>
                    {isSelected ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        x{selectedCharacterIds.indexOf(entry.characterId) + 1}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="analytics-panel">
          <CardHeader className="pb-2">
            <p className="analytics-kicker">Metric</p>
          </CardHeader>
          <CardContent className="pt-0">
            <ToggleGroup
              type="single"
              value={search.stat}
              onValueChange={(value) => {
                if (isCompareStatKey(value)) updateSearch({ stat: value });
              }}
              variant="outline"
              size="sm"
              aria-label="Comparison metric"
              className="flex-wrap justify-start"
            >
              {COMPARE_STAT_OPTIONS.map((option) => (
                <ToggleGroupItem key={option.key} value={option.key} className="text-xs">
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </CardContent>
        </Card>

        <Card className="analytics-panel">
          <CardHeader className="pb-2">
            <p className="analytics-kicker">Time Range</p>
          </CardHeader>
          <CardContent className="pt-0">
            <ToggleGroup
              type="single"
              value={search.timeFrame}
              onValueChange={(value) => {
                if (isCompareTimeFrame(value)) updateSearch({ timeFrame: value });
              }}
              variant="outline"
              size="sm"
              aria-label="Comparison time range"
              className="flex-wrap justify-start"
            >
              {COMPARE_TIME_FRAME_OPTIONS.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value} className="text-xs">
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </CardContent>
        </Card>
      </div>

      <Card className="analytics-panel">
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-sm font-medium">
            {statLabel}
            {selectedLabels ? (
              <span className="ml-2 font-normal text-muted-foreground">— {selectedLabels}</span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {selectedCharacterIds.length === 0 ? (
            <div className="flex h-[320px] flex-col items-center justify-center text-center">
              <Scale aria-hidden="true" className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Select at least 2 characters above.</p>
            </div>
          ) : selectedCharacterIds.length === 1 ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
              Select one more character to compare.
            </div>
          ) : isLoadingSnapshots ? (
            <div className="flex h-[320px] items-center justify-center" role="status">
              <span className="sr-only">Loading comparison data…</span>
              <Skeleton className="h-[280px] w-full" />
            </div>
          ) : snapshotError ? (
            <div className="flex h-[320px] flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">Comparison data could not be loaded.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => snapshotQueries.forEach((query) => void query.refetch())}
              >
                Try Again
              </Button>
            </div>
          ) : !hasEnoughCharacters ? (
            <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
              No comparable snapshot data is available.
            </div>
          ) : (
            <Suspense fallback={<Skeleton className="h-[320px] w-full" />}>
              <LazyCompareChart
                characterTimelines={characterTimelines}
                nowSeconds={nowSeconds}
                stat={search.stat}
                timeFrame={search.timeFrame}
              />
            </Suspense>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
