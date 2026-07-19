import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { Badge } from "@wow-dashboard/ui/components/badge";
import { Button } from "@wow-dashboard/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { Checkbox } from "@wow-dashboard/ui/components/checkbox";
import { Input } from "@wow-dashboard/ui/components/input";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
import HeartPulse from "lucide-react/dist/esm/icons/heart-pulse.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import Shield from "lucide-react/dist/esm/icons/shield.mjs";
import Star from "lucide-react/dist/esm/icons/star.mjs";
import Swords from "lucide-react/dist/esm/icons/swords.mjs";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createCharacterRouteId } from "@wow-dashboard/api-schema";
import { apiClient, apiQueryOptions } from "@/lib/api-client";
import { useDashboardPreferences } from "@/lib/dashboard-preferences";
import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from "@/lib/format";
import { usePinnedCharacters } from "@/lib/pinned-characters";
import { PlaytimeBreakdown } from "../components/playtime-breakdown";
import { getClassBgColor, getClassTextColor } from "../lib/class-colors";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: "/" });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(apiQueryOptions.myCharacters()),
  component: RouteComponent,
});

function classColor(cls: string) {
  return getClassTextColor(cls);
}

function classBg(cls: string) {
  return getClassBgColor(cls);
}

/** Parse gold stored as GGGGG.SSCC decimal (e.g. 366492.2707) */
function formatGold(value: number) {
  const totalCopper = Math.round(value * 10000);
  const g = Math.floor(totalCopper / 10000);
  const s = Math.floor((totalCopper % 10000) / 100);
  const c = totalCopper % 100;
  const parts: string[] = [];
  if (g > 0) parts.push(`${g.toLocaleString(DISPLAY_LOCALE)}g`);
  if (s > 0) parts.push(`${s}s`);
  if (c > 0 || parts.length === 0) parts.push(`${c}c`);
  return parts.join(" ");
}

function useResyncCooldown() {
  const [nextAllowedAt, setNextAllowedAt] = useState<number>(0);
  const [now, setNow] = useState(() => Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (nextAllowedAt > Date.now()) {
      intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [nextAllowedAt]);

  const remaining = Math.max(0, nextAllowedAt - now);
  const isCoolingDown = remaining > 0;

  function setCooldown(until: number) {
    setNextAllowedAt(until);
    setNow(Date.now());
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
  }

  function formatRemaining(ms: number) {
    const totalSeconds = Math.ceil(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  return { isCoolingDown, remaining, setCooldown, formatRemaining };
}

type Character = {
  _id: string;
  name: string;
  realm: string;
  region: string;
  class: string;
  race: string;
  faction: "alliance" | "horde";
  visibility: "public" | "unlisted" | "private";
  snapshot: {
    level: number;
    spec: string;
    role: string;
    itemLevel: number;
    mythicPlusScore: number;
    gold: number;
    playtimeSeconds: number;
    playtimeThisLevelSeconds?: number;
    takenAt: number;
  } | null;
};

function normalizeRole(role: string): string {
  const r = role.toUpperCase();
  if (r === "TANK") return "Tank";
  if (r === "HEALER" || r === "HEALING") return "Healer";
  return "DPS";
}

const ROLE_ORDER = ["Tank", "Healer", "DPS"];

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Tank: Shield,
  Healer: HeartPulse,
  DPS: Swords,
};

function CharacterCard({
  char,
  isFavorite,
  onToggleFavorite,
}: {
  char: Character;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  const { snapshot } = char;
  const cls = char.class.toLowerCase();

  return (
    <Card
      className={`analytics-panel group relative h-full border ${classBg(cls)} motion-safe:transition-[transform,box-shadow] motion-safe:hover:-translate-y-0.5 hover:shadow-lg`}
    >
      <Link
        to="/character/$characterId"
        params={{ characterId: createCharacterRouteId(char) }}
        className="block h-full rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <CardHeader className="pb-2 pr-9">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className={`text-lg leading-tight ${classColor(cls)}`}>
                {char.name}
              </CardTitle>
              <p className="text-muted-foreground text-xs mt-0.5">
                {char.realm}-{char.region.toUpperCase()}
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                char.faction === "alliance"
                  ? "shrink-0 border-blue-500/30 bg-blue-500/10 text-blue-400 uppercase"
                  : "shrink-0 border-red-500/30 bg-red-500/10 text-red-400 uppercase"
              }
            >
              {char.faction}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {char.race} {char.class}
          </p>
        </CardHeader>

        <CardContent className="pt-0">
          {snapshot ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-sm">
                <StatCell label="Level" value={snapshot.level} />
                <StatCell label="Spec" value={snapshot.spec} />
                <StatCell label="iLvl" value={snapshot.itemLevel.toFixed(1)} />
                <StatCell
                  label="M+ Score"
                  value={snapshot.mythicPlusScore.toLocaleString(DISPLAY_LOCALE)}
                />
                <StatCell label="Gold" value={formatGold(snapshot.gold)} />
                <StatCell
                  label="Playtime"
                  value={
                    <PlaytimeBreakdown
                      totalSeconds={snapshot.playtimeSeconds}
                      thisLevelSeconds={snapshot.playtimeThisLevelSeconds}
                      variant="compact"
                    />
                  }
                />
              </div>
              <p className="text-muted-foreground text-xs border-t border-border/50 pt-2">
                Snapshot:{" "}
                {new Date(snapshot.takenAt * 1000).toLocaleDateString(DISPLAY_LOCALE, {
                  timeZone: DISPLAY_TIME_ZONE,
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No snapshot yet</p>
          )}
        </CardContent>
      </Link>
      <button
        type="button"
        onClick={() => onToggleFavorite(char._id)}
        aria-label={isFavorite ? `Unpin ${char.name}` : `Pin ${char.name}`}
        aria-pressed={isFavorite}
        title={isFavorite ? "Remove from quick access" : "Add to quick access"}
        className={`absolute right-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isFavorite ? "text-yellow-400" : "text-muted-foreground hover:text-yellow-400"
        }`}
      >
        <Star
          aria-hidden="true"
          className={`h-4 w-4 motion-safe:transition-transform motion-safe:hover:scale-110 ${isFavorite ? "fill-current" : ""}`}
        />
      </button>
    </Card>
  );
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium text-sm leading-tight">{value}</span>
    </div>
  );
}

function CharacterGrid({
  characters,
  favorites,
  onToggleFavorite,
}: {
  characters: Character[];
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {characters.map((char) => (
        <CharacterCard
          key={char._id}
          char={char}
          isFavorite={favorites.has(char._id)}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );
}

function RoleSection({
  role,
  characters,
  favorites,
  onToggleFavorite,
}: {
  role: string;
  characters: Character[];
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
}) {
  const RoleIcon = ROLE_ICONS[role];
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        {RoleIcon && <RoleIcon className="h-4 w-4 text-muted-foreground" />}
        <h2 className="text-lg font-semibold">{role}</h2>
        <span className="text-muted-foreground rounded-full bg-muted px-2 py-0.5 text-xs">
          {characters.length}
        </span>
      </div>
      <CharacterGrid
        characters={characters}
        favorites={favorites}
        onToggleFavorite={onToggleFavorite}
      />
    </section>
  );
}

function Dashboard() {
  const charactersQuery = useQuery(apiQueryOptions.myCharacters());
  const characters = charactersQuery.data;
  const resync = useMutation({
    mutationFn: () => apiClient.resyncCharacters(),
  });
  const [syncing, setSyncing] = useState(false);
  const { isCoolingDown, remaining, setCooldown, formatRemaining } = useResyncCooldown();
  const { pinnedCharacterIdSet: favorites, togglePinnedCharacter: toggleFavorite } =
    usePinnedCharacters();
  const { preferences, updatePreferences } = useDashboardPreferences();
  const { hideBelow90, hideNoSnapshot } = preferences;
  const [minIlvlInput, setMinIlvlInput] = useState(() => String(preferences.minItemLevel));
  const minIlvl = Number(minIlvlInput) || 0;

  useEffect(() => {
    setMinIlvlInput(String(preferences.minItemLevel));
  }, [preferences.minItemLevel]);

  function applyFilters(chars: Character[]): Character[] {
    return chars.filter((c) => {
      if (!c.snapshot) return !hideNoSnapshot;
      if (hideBelow90 && c.snapshot.level < 90) return false;
      if (minIlvl > 0 && c.snapshot.itemLevel < minIlvl) return false;
      return true;
    });
  }

  async function handleResync() {
    if (isCoolingDown || syncing) return;
    setSyncing(true);
    try {
      const result = await resync.mutateAsync();
      if (result.ok) {
        toast.success("Battle.net sync queued. New characters will appear when it finishes.");
      } else if (result.nextAllowedAt) {
        setCooldown(result.nextAllowedAt);
        toast.error("Too many requests — please wait before trying again.");
      } else {
        toast.error("Battle.net access is unavailable. Sign in again, then retry the sync.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg || "Resync failed — please try again.");
    } finally {
      setSyncing(false);
    }
  }

  const filteredCharacters = characters ? applyFilters(characters) : null;

  const grouped = filteredCharacters
    ? ROLE_ORDER.reduce<Record<string, Character[]>>((acc, role) => {
        const chars = filteredCharacters.filter((c) =>
          c.snapshot ? normalizeRole(c.snapshot.role) === role : role === "DPS",
        );
        if (chars.length > 0) acc[role] = chars;
        return acc;
      }, {})
    : {};

  const favoriteChars = filteredCharacters?.filter((c) => favorites.has(c._id)) ?? [];
  const isDisabled = syncing || isCoolingDown;

  return (
    <div className="analytics-shell w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="analytics-kicker text-primary">Roster / Live Snapshots</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">My Characters</h1>
          {characters !== undefined && characters !== null && characters.length > 0 && (
            <p className="text-muted-foreground text-sm mt-1">
              {filteredCharacters?.length ?? 0} of {characters.length} character
              {characters.length !== 1 ? "s" : ""} across {Object.keys(grouped).length} role
              {Object.keys(grouped).length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={hideBelow90}
              onCheckedChange={(value) => updatePreferences({ hideBelow90: !!value })}
              id="dashboard-hide-below-90"
            />
            <span className="text-muted-foreground select-none">Hide below Lvl 90</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground select-none">Min iLvl</span>
            <Input
              type="number"
              min={0}
              max={1000}
              step={0.1}
              value={minIlvlInput}
              onChange={(event) => setMinIlvlInput(event.target.value)}
              onBlur={() => updatePreferences({ minItemLevel: minIlvl })}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="h-7 w-20 text-sm"
              aria-label="Minimum item level"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={hideNoSnapshot}
              onCheckedChange={(value) => updatePreferences({ hideNoSnapshot: !!value })}
              id="dashboard-hide-no-snapshot"
            />
            <span className="text-muted-foreground select-none">Hide no snapshot</span>
          </label>
          <Button
            size="sm"
            variant="outline"
            className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300 min-w-[100px] gap-1.5"
            onClick={handleResync}
            disabled={isDisabled}
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-3.5 w-3.5 ${syncing ? "animate-spin motion-reduce:animate-none" : ""}`}
            />
            {syncing ? "Syncing…" : isCoolingDown ? formatRemaining(remaining) : "Resync"}
          </Button>
        </div>
      </div>

      {charactersQuery.isError && characters === undefined ? (
        <Card className="analytics-panel border-destructive/40">
          <CardContent className="flex flex-col items-start gap-3 py-8">
            <p className="font-medium">Your characters could not be loaded.</p>
            <p className="text-sm text-muted-foreground">{charactersQuery.error.message}</p>
            <Button variant="outline" size="sm" onClick={() => void charactersQuery.refetch()}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      ) : characters === undefined ? (
        <div className="space-y-8">
          {["Favorites", "Tank", "Healer", "DPS"].map((role) => (
            <section key={role}>
              <div className="mb-3 flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded" />
                <Skeleton className="h-6 w-20 rounded" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-48 rounded-lg" />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : characters === null || characters.length === 0 ? (
        <Card className="analytics-panel border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">No characters found.</p>
            <p className="text-muted-foreground text-sm mt-1">
              Try syncing your Battle.net account.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-10">
          {favoriteChars.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Star className="h-5 w-5 fill-current text-yellow-400" />
                <h2 className="text-lg font-semibold">Pinned</h2>
                <span className="text-muted-foreground rounded-full bg-muted px-2 py-0.5 text-xs">
                  {favoriteChars.length}
                </span>
              </div>
              <CharacterGrid
                characters={favoriteChars}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
              />
            </section>
          )}
          {ROLE_ORDER.filter((role) => grouped[role]).map((role) => (
            <RoleSection
              key={role}
              role={role}
              characters={grouped[role]}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RouteComponent() {
  return <Dashboard />;
}
