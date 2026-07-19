import { DISPLAY_LOCALE } from "@/lib/format";

export type CompareStatKey = "mythicPlusScore" | "itemLevel" | "keystoneLevel" | "playtimeHours";

export type CompareTimeFrame = "7d" | "30d" | "90d" | "all";

export type CompareSnapshot = {
  takenAt: number;
  itemLevel: number;
  mythicPlusScore: number;
  playtimeSeconds: number;
  ownedKeystone?: {
    level: number;
    mapChallengeModeID?: number;
    mapName?: string;
  };
};

export type CharacterTimeline = {
  key: string;
  name: string;
  snapshots: CompareSnapshot[];
};

export type TimelineRow = { date: number } & Record<string, number | null>;

export const COMPARE_STAT_OPTIONS: readonly {
  key: CompareStatKey;
  label: string;
  format: (value: number) => string;
}[] = [
  {
    key: "mythicPlusScore",
    label: "M+ Score",
    format: (value) => Math.round(value).toLocaleString(DISPLAY_LOCALE),
  },
  { key: "itemLevel", label: "Item Level", format: (value) => value.toFixed(1) },
  { key: "keystoneLevel", label: "Keystone Level", format: (value) => `+${Math.round(value)}` },
  {
    key: "playtimeHours",
    label: "Playtime",
    format: (value) => {
      const totalHours = Math.round(value);
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
    },
  },
];

export const COMPARE_TIME_FRAME_OPTIONS: readonly {
  value: CompareTimeFrame;
  label: string;
}[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

const TIME_FRAME_DAYS: Record<Exclude<CompareTimeFrame, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function isCompareStatKey(value: unknown): value is CompareStatKey {
  return COMPARE_STAT_OPTIONS.some((option) => option.key === value);
}

export function isCompareTimeFrame(value: unknown): value is CompareTimeFrame {
  return COMPARE_TIME_FRAME_OPTIONS.some((option) => option.value === value);
}

export function getCompareStatOption(stat: CompareStatKey) {
  return COMPARE_STAT_OPTIONS.find((option) => option.key === stat) ?? COMPARE_STAT_OPTIONS[0]!;
}

function dayKeyFromSeconds(seconds: number) {
  const date = new Date(seconds * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayStartSeconds(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, day!, 0, 0, 0, 0) / 1000);
}

function getSnapshotStat(snapshot: CompareSnapshot, stat: CompareStatKey): number | null {
  switch (stat) {
    case "itemLevel":
      return snapshot.itemLevel;
    case "mythicPlusScore":
      return snapshot.mythicPlusScore;
    case "keystoneLevel":
      return snapshot.ownedKeystone?.level ?? null;
    case "playtimeHours":
      return snapshot.playtimeSeconds / 3600;
  }
}

export function buildTimelineData(
  characterTimelines: CharacterTimeline[],
  stat: CompareStatKey,
  timeFrame: CompareTimeFrame,
  nowSeconds = Math.floor(Date.now() / 1000),
): TimelineRow[] {
  if (characterTimelines.length === 0) return [];

  const cutoffSeconds =
    timeFrame === "all" ? null : nowSeconds - TIME_FRAME_DAYS[timeFrame] * 86400;

  const dayKeys = new Set<string>();
  for (const timeline of characterTimelines) {
    for (const snapshot of timeline.snapshots) {
      if (cutoffSeconds !== null && snapshot.takenAt < cutoffSeconds) continue;
      dayKeys.add(dayKeyFromSeconds(snapshot.takenAt));
    }
  }

  if (cutoffSeconds !== null) {
    dayKeys.add(dayKeyFromSeconds(cutoffSeconds));
    dayKeys.add(dayKeyFromSeconds(nowSeconds));
  }

  const sortedDayKeys = [...dayKeys].sort();
  if (sortedDayKeys.length === 0) return [];

  const rows: TimelineRow[] = sortedDayKeys.map((dayKey) => ({
    date: dayStartSeconds(dayKey),
  }));

  for (const timeline of characterTimelines) {
    const sortedSnapshots = [...timeline.snapshots].sort((a, b) => a.takenAt - b.takenAt);
    let snapshotIndex = 0;
    let latestValue: number | null = null;

    for (const row of rows) {
      const dayEndSeconds = row.date + 86399;
      while (
        snapshotIndex < sortedSnapshots.length &&
        sortedSnapshots[snapshotIndex]!.takenAt <= dayEndSeconds
      ) {
        latestValue = getSnapshotStat(sortedSnapshots[snapshotIndex]!, stat);
        snapshotIndex += 1;
      }
      row[timeline.key] = latestValue;
    }
  }

  return rows;
}
