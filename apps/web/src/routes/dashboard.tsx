import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import { Button } from "@wow-dashboard/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@wow-dashboard/ui/components/card";
import { Skeleton } from "@wow-dashboard/ui/components/skeleton";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

import UserMenu from "@/components/user-menu";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
});

function RedirectToHome() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: "/" });
  }, [navigate]);
  return null;
}

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

const CLASS_BG_COLORS: Record<string, string> = {
  warrior: "bg-amber-500/10 border-amber-500/20",
  paladin: "bg-pink-400/10 border-pink-400/20",
  hunter: "bg-green-500/10 border-green-500/20",
  rogue: "bg-yellow-400/10 border-yellow-400/20",
  priest: "bg-gray-100/10 border-gray-100/20",
  "death knight": "bg-red-500/10 border-red-500/20",
  shaman: "bg-blue-400/10 border-blue-400/20",
  mage: "bg-cyan-400/10 border-cyan-400/20",
  warlock: "bg-purple-400/10 border-purple-400/20",
  monk: "bg-emerald-400/10 border-emerald-400/20",
  druid: "bg-orange-400/10 border-orange-400/20",
  "demon hunter": "bg-violet-500/10 border-violet-500/20",
  evoker: "bg-teal-400/10 border-teal-400/20",
};

function classColor(cls: string) {
  return CLASS_COLORS[cls.toLowerCase()] ?? "text-foreground";
}

function classBg(cls: string) {
  return CLASS_BG_COLORS[cls.toLowerCase()] ?? "bg-card border-border";
}

function formatPlaytime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
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

const FAVORITES_KEY = "wow_dashboard_favorites";

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

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_KEY = "resync_cooldown_until";

function useResyncCooldown() {
  const [cooldownUntil, setCooldownUntil] = useState<number>(() => {
    const stored = localStorage.getItem(COOLDOWN_KEY);
    return stored ? parseInt(stored, 10) : 0;
  });
  const [now, setNow] = useState(() => Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (cooldownUntil > Date.now()) {
      intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [cooldownUntil]);

  const remaining = Math.max(0, cooldownUntil - now);
  const isCoolingDown = remaining > 0;

  function startCooldown() {
    const until = Date.now() + COOLDOWN_MS;
    localStorage.setItem(COOLDOWN_KEY, String(until));
    setCooldownUntil(until);
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

  return { isCoolingDown, remaining, startCooldown, formatRemaining };
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

const ROLE_ICONS: Record<string, string> = {
  Tank: "🛡️",
  Healer: "💚",
  DPS: "⚔️",
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
    <Link to="/character/$characterId" params={{ characterId: char._id }} className="block">
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
          className={`absolute right-3 top-3 z-10 rounded-full p-1 transition-colors hover:bg-white/10 ${
            isFavorite ? "text-yellow-400" : "text-muted-foreground hover:text-yellow-400"
          }`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill={isFavorite ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-4 w-4"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
            />
          </svg>
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
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${
                char.faction === "alliance"
                  ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                  : "border-red-500/30 bg-red-500/10 text-red-400"
              }`}
            >
              {char.faction}
            </span>
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
                <StatCell label="Playtime" value={formatPlaytime(snapshot.playtimeSeconds)} />
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

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
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
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-base" aria-hidden="true">
          {ROLE_ICONS[role]}
        </span>
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
  const characters = useQuery(api.characters.getMyCharactersWithSnapshot);
  const resync = useMutation(api.characters.resyncCharacters);
  const [syncing, setSyncing] = useState(false);
  const { isCoolingDown, remaining, startCooldown, formatRemaining } = useResyncCooldown();
  const { favorites, toggle: toggleFavorite } = useFavorites();

  async function handleResync() {
    if (isCoolingDown || syncing) return;
    setSyncing(true);
    try {
      await resync();
      startCooldown();
    } finally {
      setSyncing(false);
    }
  }

  const grouped = characters
    ? ROLE_ORDER.reduce<Record<string, Character[]>>((acc, role) => {
        const chars = characters.filter((c) =>
          c.snapshot ? normalizeRole(c.snapshot.role) === role : role === "DPS",
        );
        if (chars.length > 0) acc[role] = chars;
        return acc;
      }, {})
    : {};

  const favoriteChars = characters?.filter((c) => favorites.has(c._id)) ?? [];
  const isDisabled = syncing || isCoolingDown;

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Characters</h1>
          {characters !== undefined && characters !== null && characters.length > 0 && (
            <p className="text-muted-foreground text-sm mt-1">
              {characters.length} character{characters.length !== 1 ? "s" : ""} across{" "}
              {Object.keys(grouped).length} role{Object.keys(grouped).length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/scoreboard"
            className="inline-flex items-center gap-1.5 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-1.5 text-sm font-medium text-yellow-400 transition-colors hover:bg-yellow-500/20 hover:text-yellow-300"
          >
            🏆 Scoreboard
          </Link>
          <Button
            size="sm"
            variant="outline"
            className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300 min-w-[100px]"
            onClick={handleResync}
            disabled={isDisabled}
          >
            {syncing ? "Syncing…" : isCoolingDown ? formatRemaining(remaining) : "Resync"}
          </Button>
          <UserMenu />
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
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-5 w-5 text-yellow-400"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
                  />
                </svg>
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
  return (
    <>
      <Authenticated>
        <Dashboard />
      </Authenticated>
      <Unauthenticated>
        <RedirectToHome />
      </Unauthenticated>
      <AuthLoading>
        <div className="flex h-full items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading...</p>
        </div>
      </AuthLoading>
    </>
  );
}
