import { createFileRoute, Link } from "@tanstack/react-router";
import { api } from "@wow-dashboard/backend/convex/_generated/api";
import type { Id } from "@wow-dashboard/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";

export const Route = createFileRoute("/character/$characterId")({
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

function LineChart({
  data,
  label,
  getValue,
  format,
}: {
  data: { takenAt: number; [key: string]: number | string }[];
  label: string;
  getValue: (d: { takenAt: number; [key: string]: number | string }) => number;
  format?: (v: number) => string;
}) {
  if (data.length < 2) {
    return <p className="text-muted-foreground text-sm">Not enough data points yet.</p>;
  }

  const W = 480;
  const H = 120;
  const PAD = { top: 10, right: 10, bottom: 30, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const xs = data.map((d) => d.takenAt as number);
  const ys = data.map(getValue);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeY = maxY - minY || 1;

  const px = (x: number) => PAD.left + ((x - minX) / (maxX - minX || 1)) * innerW;
  const py = (y: number) => PAD.top + innerH - ((y - minY) / rangeY) * innerH;

  const points = data.map((d) => `${px(d.takenAt as number)},${py(getValue(d))}`).join(" ");

  const fmt = format ?? ((v: number) => v.toFixed(0));

  return (
    <div>
      <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
        {label}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full overflow-visible" style={{ maxHeight: 140 }}>
        {/* Y axis labels */}
        <text
          x={PAD.left - 4}
          y={PAD.top + 4}
          textAnchor="end"
          fontSize={10}
          className="fill-muted-foreground"
        >
          {fmt(maxY)}
        </text>
        <text
          x={PAD.left - 4}
          y={PAD.top + innerH}
          textAnchor="end"
          fontSize={10}
          className="fill-muted-foreground"
        >
          {fmt(minY)}
        </text>

        {/* X axis date labels */}
        <text
          x={PAD.left}
          y={H - 4}
          textAnchor="middle"
          fontSize={9}
          className="fill-muted-foreground"
        >
          {new Date(minX).toLocaleDateString()}
        </text>
        <text
          x={PAD.left + innerW}
          y={H - 4}
          textAnchor="middle"
          fontSize={9}
          className="fill-muted-foreground"
        >
          {new Date(maxX).toLocaleDateString()}
        </text>

        {/* Baseline */}
        <line
          x1={PAD.left}
          y1={PAD.top + innerH}
          x2={PAD.left + innerW}
          y2={PAD.top + innerH}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={1}
        />

        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke="#60a5fa"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dots */}
        {data.map((d, i) => (
          <circle key={i} cx={px(d.takenAt as number)} cy={py(getValue(d))} r={3} fill="#60a5fa" />
        ))}
      </svg>
    </div>
  );
}

function RouteComponent() {
  const { characterId } = Route.useParams();
  const data = useQuery(api.characters.getCharacterSnapshots, {
    characterId: characterId as Id<"characters">,
  });

  if (data === undefined) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-6">
        <div className="bg-card h-64 animate-pulse rounded-lg border" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-6">
        <p className="text-muted-foreground text-sm">Character not found.</p>
        <Link to="/dashboard" className="text-blue-400 text-sm hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  const { character, snapshots } = data;
  const latest = snapshots[snapshots.length - 1] ?? null;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4">
        <Link to="/dashboard" className="text-muted-foreground text-sm hover:text-foreground">
          ← Back
        </Link>
      </div>

      <div className="bg-card rounded-lg border p-4 mb-6">
        <div className="flex items-baseline justify-between mb-1">
          <span className={`text-xl font-bold ${classColor(character.class)}`}>
            {character.name}
          </span>
          <span
            className={`text-xs font-medium uppercase ${character.faction === "alliance" ? "text-blue-400" : "text-red-400"}`}
          >
            {character.faction}
          </span>
        </div>
        <p className="text-muted-foreground text-sm">
          {character.race} {character.class} — {character.realm}-{character.region.toUpperCase()}
        </p>
        {latest && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Level </span>
              <span className="font-medium">{latest.level}</span>
            </div>
            <div>
              <span className="text-muted-foreground">iLvl </span>
              <span className="font-medium">{latest.itemLevel.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">M+ </span>
              <span className="font-medium">{latest.mythicPlusScore.toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>

      <div className="bg-card rounded-lg border p-4 space-y-6">
        <h2 className="font-semibold">Over Time</h2>
        {snapshots.length === 0 ? (
          <p className="text-muted-foreground text-sm">No snapshots yet.</p>
        ) : (
          <>
            <LineChart
              data={snapshots}
              label="Item Level"
              getValue={(d) => (d as (typeof snapshots)[0]).itemLevel}
              format={(v) => v.toFixed(1)}
            />
            <LineChart
              data={snapshots}
              label="M+ Score"
              getValue={(d) => (d as (typeof snapshots)[0]).mythicPlusScore}
            />
            <LineChart
              data={snapshots}
              label="Gold"
              getValue={(d) => Math.floor((d as (typeof snapshots)[0]).gold / 10000)}
              format={(v) => `${v.toLocaleString()}g`}
            />
          </>
        )}
      </div>
    </div>
  );
}
