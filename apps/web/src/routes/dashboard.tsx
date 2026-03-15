import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import { Button } from "@wow-dashboard/ui/components/button";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

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

function classColor(cls: string) {
  return CLASS_COLORS[cls.toLowerCase()] ?? "text-foreground";
}

function formatPlaytime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

function CharacterCard({
  char,
}: {
  char: {
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
}) {
  const { snapshot } = char;
  const factionColor = char.faction === "alliance" ? "text-blue-400" : "text-red-400";

  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <span className={`text-lg font-bold ${classColor(char.class)}`}>{char.name}</span>
          <span className="text-muted-foreground ml-2 text-sm">
            {char.realm}-{char.region.toUpperCase()}
          </span>
        </div>
        <span className={`text-xs font-medium uppercase ${factionColor}`}>{char.faction}</span>
      </div>

      <div className="text-muted-foreground mb-3 text-sm">
        {char.race} {char.class}
      </div>

      {snapshot ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          <Stat label="Level" value={snapshot.level} />
          <Stat label="Spec" value={`${snapshot.spec} (${snapshot.role})`} />
          <Stat label="Item Level" value={snapshot.itemLevel.toFixed(1)} />
          <Stat label="M+ Score" value={snapshot.mythicPlusScore.toLocaleString()} />
          <Stat label="Gold" value={`${Math.floor(snapshot.gold / 10000).toLocaleString()}g`} />
          <Stat label="Playtime" value={formatPlaytime(snapshot.playtimeSeconds)} />
          <div className="text-muted-foreground col-span-2 mt-1 text-xs sm:col-span-3">
            Snapshot: {new Date(snapshot.takenAt).toLocaleDateString()}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No snapshot yet</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Dashboard() {
  const characters = useQuery(api.characters.getMyCharactersWithSnapshot);
  const resync = useMutation(api.characters.resyncCharacters);
  const [syncing, setSyncing] = useState(false);

  async function handleResync() {
    setSyncing(true);
    try {
      await resync();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Characters</h1>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
            onClick={handleResync}
            disabled={syncing}
          >
            {syncing ? "Syncing…" : "Resync"}
          </Button>
          <UserMenu />
        </div>
      </div>

      {characters === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="bg-card h-36 animate-pulse rounded-lg border" />
          ))}
        </div>
      ) : characters === null || characters.length === 0 ? (
        <p className="text-muted-foreground text-sm">No characters found.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {characters.map((char) => (
            <CharacterCard key={char._id} char={char} />
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
