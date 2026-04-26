import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { Badge } from "@wow-dashboard/ui/components/badge";
import { Button } from "@wow-dashboard/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { Checkbox } from "@wow-dashboard/ui/components/checkbox";
import { Input } from "@wow-dashboard/ui/components/input";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
import { HeartPulse, RefreshCw, Shield, Star, Swords } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createCharacterRouteSlug } from "@wow-dashboard/api-schema";
import { apiClient, apiQueryOptions } from "@/lib/api-client";
import { PlaytimeBreakdown } from "../components/playtime-breakdown";
import { getClassBgColor, getClassTextColor } from "../lib/class-colors";

const HIDE_BELOW_90_KEY = "wow_dashboard_hide_below_90";
const MIN_ILVL_KEY = "wow_dashboard_min_ilvl";
const HIDE_NO_SNAPSHOT_KEY = "wow_dashboard_hide_no_snapshot";
const DEFAULT_MIN_ILVL = 200;
const FAVORITES_KEY = "wow_dashboard_favorites";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) throw redirect({ to: "/" });
  },
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
  if (g > 0) parts.push(`${g.toLocaleString()}g`);
  if (s > 0) parts.push(`${s}s`);
  if (c > 0 || parts.length === 0) parts.push(`${c}c`);
  return parts.join(" ");
}

function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY);
      return stored ? new Set<string>(JSON.parse(stored) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  const toggle = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  return { favorites, toggle };
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
    <Link
      to="/character/$characterId"
      params={{ characterId: createCharacterRouteSlug(char) }}
      className="block"
    >
      <Card
        className={`relative h-full transition-all hover:scale-[1.01] hover:shadow-lg border ${classBg(cls)}`}
      >
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleFavorite(char._id);
          }}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          className={`absolute right-3 top-3 z-10 rounded-full p-1 transition-colors hover:bg-white/10 ${
            isFavorite ? "text-yellow-400" : "text-muted-foreground hover:text-yellow-400"
          }`}
        >
          <Star
            className={`h-4 w-4 transition-transform duration-200 hover:scale-125 ${isFavorite ? "fill-current" : ""}`}
          />
        </button>
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
                <StatCell label="M+ Score" value={snapshot.mythicPlusScore.toLocaleString()} />
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
                {new Date(snapshot.takenAt * 1000).toLocaleDateString(undefined, {
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
      </Card>
    </Link>
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
  const { favorites, toggle: toggleFavorite } = useFavorites();

  const [hideBelow90, setHideBelow90] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HIDE_BELOW_90_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [minIlvlInput, setMinIlvlInput] = useState<string>(() => {
    try {
      const v = localStorage.getItem(MIN_ILVL_KEY);
      return v !== null ? v : String(DEFAULT_MIN_ILVL);
    } catch {
      return String(DEFAULT_MIN_ILVL);
    }
  });
  const [hideNoSnapshot, setHideNoSnapshot] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HIDE_NO_SNAPSHOT_KEY) === "true";
    } catch {
      return false;
    }
  });
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

  function toggleHideNoSnapshot(checked: boolean) {
    setHideNoSnapshot(checked);
    try {
      localStorage.setItem(HIDE_NO_SNAPSHOT_KEY, String(checked));
    } catch {}
  }

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
      if (result?.nextAllowedAt) {
        setCooldown(result.nextAllowedAt);
        toast.error("Too many requests — please wait before trying again.");
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
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">My Characters</h1>
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
              onCheckedChange={(v) => toggleHideBelow90(!!v)}
              id="dashboard-hide-below-90"
            />
            <span className="text-muted-foreground select-none">Hide below Lvl 90</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground select-none">Min iLvl</span>
            <Input
              type="number"
              min={0}
              value={minIlvlInput}
              onChange={(e) => handleMinIlvlChange(e.target.value)}
              className="h-7 w-20 text-sm"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={hideNoSnapshot}
              onCheckedChange={(v) => toggleHideNoSnapshot(!!v)}
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
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : isCoolingDown ? formatRemaining(remaining) : "Resync"}
          </Button>
        </div>
      </div>

      {characters === undefined ? (
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
        <Card className="border-dashed">
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
                <h2 className="text-lg font-semibold">Favorites</h2>
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
